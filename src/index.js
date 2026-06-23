import { DEFAULT_SHOP_ITEMS } from "./shop-catalog.js";

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

function sanitizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function sanitizeInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isTrue(value) {
  return String(value || "").toLowerCase() === "true";
}

function isDebugMode(env) {
  return isTrue(env.SHOP_DEBUG_MODE);
}

function sanitizeIdentity(identity) {
  return {
    fullName: sanitizeString(identity?.fullName) || "Unknown Eventicious user",
    email: sanitizeString(identity?.email),
    company: sanitizeString(identity?.company),
  };
}

function sanitizeShopItem(item) {
  return {
    id: sanitizeString(item?.id),
    title: sanitizeString(item?.title),
    description: sanitizeString(item?.description),
    cost: sanitizeInteger(item?.cost),
  };
}

function getNestedProfiles(profile) {
  return [
    profile,
    profile?.user,
    profile?.attendee,
    profile?.profile,
    profile?.data,
  ].filter(Boolean);
}

function resolveExternalId(profile, env) {
  const nested = getNestedProfiles(profile);
  const candidates = [];

  for (const item of nested) {
    candidates.push(
      item.externalId,
      item.externalID,
      item.external_id,
      item.userExternalId,
      item.attendeeExternalId
    );
  }

  if (isTrue(env.EVENTICIOUS_ALLOW_PROFILE_ID_FALLBACK)) {
    for (const item of nested) {
      candidates.push(item.id);
    }
  }

  for (const candidate of candidates) {
    const normalized = sanitizeInteger(candidate);
    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function getShopItems(env) {
  if (sanitizeString(env.SHOP_ITEMS_JSON)) {
    try {
      const parsed = JSON.parse(env.SHOP_ITEMS_JSON);
      if (Array.isArray(parsed)) {
        const items = parsed
          .map(sanitizeShopItem)
          .filter((item) => item.id && item.title && item.cost !== null);

        if (items.length > 0) {
          return items;
        }
      }
    } catch {
      // Ignore invalid optional JSON and fallback to the default catalog.
    }
  }

  return DEFAULT_SHOP_ITEMS;
}

function getPurchaseCapabilities(env) {
  const debugMode = isDebugMode(env);

  return {
    canPurchase:
      debugMode ||
      Boolean(sanitizeString(env.EVENTICIOUS_CLIENT_ID)) &&
      Boolean(sanitizeString(env.EVENTICIOUS_CLIENT_SECRET)) &&
      Boolean(env.ORDERS_KV && typeof env.ORDERS_KV.put === "function"),
    debugMode,
    hasApiCredentials:
      Boolean(sanitizeString(env.EVENTICIOUS_CLIENT_ID)) &&
      Boolean(sanitizeString(env.EVENTICIOUS_CLIENT_SECRET)),
    hasOrdersKv: Boolean(env.ORDERS_KV && typeof env.ORDERS_KV.put === "function"),
    baseUrl: sanitizeString(env.EVENTICIOUS_BASE_URL) || "https://api-integration.eventicious.ru",
    balanceLookupAvailable: false,
    notes: [
      "The provided Eventicious API docs expose point write-off through negative scores on add-manual-charge.",
      "The provided docs do not expose a current points balance endpoint, so the shop cannot reliably pre-check remaining points.",
      "Identity comes from the Eventicious SDK running in the client. This is suitable for an MVP, but not a cryptographically verified checkout.",
      debugMode ? "SHOP_DEBUG_MODE is enabled, so purchases can be tested without a real point write-off." : "Enable SHOP_DEBUG_MODE only for temporary UI testing.",
    ],
  };
}

function buildVisitRecord(payload, request, env) {
  const identity = sanitizeIdentity(payload.identity);
  const profile = payload.profile ?? null;

  return {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    source: sanitizeString(payload.source) || "unknown",
    sdkAvailable: Boolean(payload.sdkAvailable),
    conferenceId: sanitizeString(payload.conferenceId),
    userGuid: sanitizeString(payload.userGuid),
    locale: sanitizeString(payload.locale),
    environment: sanitizeString(payload.environment),
    openedAt: sanitizeString(payload.openedAt),
    identity,
    externalId: resolveExternalId(profile, env),
    profile,
    requestMeta: {
      ipCountry: request.cf?.country || null,
      colo: request.cf?.colo || null,
      userAgent: sanitizeString(request.headers.get("user-agent")),
      referer: sanitizeString(request.headers.get("referer")),
    },
  };
}

async function maybePersistVisit(env, visit) {
  if (!env.VISITS_KV || typeof env.VISITS_KV.put !== "function") {
    return {
      persisted: false,
      message: "VISITS_KV binding is not configured. Returning the identified visitor without durable storage.",
    };
  }

  const storageKey = `visit:${visit.receivedAt}:${visit.id}`;
  await env.VISITS_KV.put(storageKey, JSON.stringify(visit), {
    expirationTtl: 60 * 60 * 24 * 30,
  });

  return {
    persisted: true,
    storageKey,
    message: "Visit stored in Cloudflare KV.",
  };
}

async function handleIdentify(request, env) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Body must be valid JSON.",
      },
      { status: 400 }
    );
  }

  const visit = buildVisitRecord(payload || {}, request, env);
  const persistence = await maybePersistVisit(env, visit);

  return json({
    ok: true,
    visit,
    persistence,
    capabilities: getPurchaseCapabilities(env),
  });
}

async function getAccessToken(env) {
  const clientId = sanitizeString(env.EVENTICIOUS_CLIENT_ID);
  const clientSecret = sanitizeString(env.EVENTICIOUS_CLIENT_SECRET);
  const baseUrl = sanitizeString(env.EVENTICIOUS_BASE_URL) || "https://api-integration.eventicious.ru";

  if (!clientId || !clientSecret) {
    throw new Error("Cloudflare secrets EVENTICIOUS_CLIENT_ID and EVENTICIOUS_CLIENT_SECRET are required.");
  }

  const response = await fetch(`${baseUrl}/connect/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const rawText = await response.text();
  let data = null;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Failed to fetch Eventicious access token (${response.status}).`);
  }

  return {
    accessToken: data.access_token,
    baseUrl,
  };
}

async function writeOffPoints(env, purchase) {
  const auth = await getAccessToken(env);
  const response = await fetch(`${auth.baseUrl}/api/external/v2/gamification/add-manual-charge`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      externalId: purchase.externalId,
      scores: -purchase.cost,
      reason: purchase.reason,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Eventicious write-off failed (${response.status}): ${text || "empty response"}`);
  }

  return {
    ok: true,
    status: response.status,
    rawResponse: text || null,
  };
}

async function handleShop(env) {
  return json({
    ok: true,
    items: getShopItems(env),
    capabilities: getPurchaseCapabilities(env),
  });
}

async function handlePurchase(request, env) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Body must be valid JSON." }, { status: 400 });
  }

  const itemId = sanitizeString(payload?.itemId);
  const orderId = sanitizeString(payload?.orderId);
  const visitorPayload = payload?.visitor || {};
  const debugMode = isDebugMode(env);
  const items = getShopItems(env);
  const item = items.find((entry) => entry.id === itemId);

  if (!item) {
    return json({ ok: false, error: "Unknown shop item." }, { status: 404 });
  }

  if (!orderId) {
    return json({ ok: false, error: "orderId is required." }, { status: 400 });
  }

  if (!env.ORDERS_KV || typeof env.ORDERS_KV.put !== "function" || typeof env.ORDERS_KV.get !== "function") {
    return json(
      {
        ok: false,
        error: "ORDERS_KV binding is required before purchases can be enabled safely.",
      },
      { status: 503 }
    );
  }

  const existing = await env.ORDERS_KV.get(`order:${orderId}`, "json");
  if (existing) {
    return json({
      ok: true,
      order: existing,
      duplicate: true,
    });
  }

  const visit = buildVisitRecord(visitorPayload, request, env);

  if (visit.source !== "eventicious-sdk") {
    if (debugMode) {
      const debugOrder = {
        id: orderId,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "completed",
        mode: "debug",
        item: {
          id: item.id,
          title: item.title,
          cost: item.cost,
        },
        visitor: {
          fullName: visit.identity.fullName,
          email: visit.identity.email,
          userGuid: visit.userGuid,
          conferenceId: visit.conferenceId,
          externalId: visit.externalId,
        },
        eventicious: {
          ok: true,
          mocked: true,
          message: "Debug mode completed a mock purchase without a real Eventicious API call.",
        },
      };

      await env.ORDERS_KV.put(`order:${orderId}`, JSON.stringify(debugOrder), {
        expirationTtl: 60 * 60 * 24 * 30,
      });

      return json({
        ok: true,
        order: debugOrder,
        duplicate: false,
      });
    }

    return json(
      {
        ok: false,
        error: "Purchases are allowed only when the page is opened inside Eventicious.",
      },
      { status: 400 }
    );
  }

  if (visit.externalId === null) {
    if (debugMode) {
      const debugOrder = {
        id: orderId,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "completed",
        mode: "debug",
        item: {
          id: item.id,
          title: item.title,
          cost: item.cost,
        },
        visitor: {
          fullName: visit.identity.fullName,
          email: visit.identity.email,
          userGuid: visit.userGuid,
          conferenceId: visit.conferenceId,
          externalId: null,
        },
        eventicious: {
          ok: true,
          mocked: true,
          message: "Debug mode completed a mock purchase without resolving externalId.",
        },
      };

      await env.ORDERS_KV.put(`order:${orderId}`, JSON.stringify(debugOrder), {
        expirationTtl: 60 * 60 * 24 * 30,
      });

      return json({
        ok: true,
        order: debugOrder,
        duplicate: false,
      });
    }

    return json(
      {
        ok: false,
        error: "Could not resolve externalId from the Eventicious profile. Inspect the raw profile and map the correct field first.",
        visit,
      },
      { status: 400 }
    );
  }

  const order = {
    id: orderId,
    createdAt: new Date().toISOString(),
    status: "pending",
    item: {
      id: item.id,
      title: item.title,
      cost: item.cost,
    },
    visitor: {
      fullName: visit.identity.fullName,
      email: visit.identity.email,
      userGuid: visit.userGuid,
      conferenceId: visit.conferenceId,
      externalId: visit.externalId,
    },
    notes: [
      "This MVP relies on Eventicious SDK identity from the client.",
      "The provided API docs do not include a points balance lookup endpoint.",
    ],
  };

  await env.ORDERS_KV.put(`order:${orderId}`, JSON.stringify(order), {
    expirationTtl: 60 * 60 * 24 * 30,
  });

  try {
    const apiResult = await writeOffPoints(env, {
      externalId: visit.externalId,
      cost: item.cost,
      reason: `Shop purchase: ${item.title}`,
    });

    const completed = {
      ...order,
      status: "completed",
      completedAt: new Date().toISOString(),
      eventicious: apiResult,
    };

    await env.ORDERS_KV.put(`order:${orderId}`, JSON.stringify(completed), {
      expirationTtl: 60 * 60 * 24 * 30,
    });

    return json({
      ok: true,
      order: completed,
      duplicate: false,
    });
  } catch (error) {
    const failed = {
      ...order,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };

    await env.ORDERS_KV.put(`order:${orderId}`, JSON.stringify(failed), {
      expirationTtl: 60 * 60 * 24 * 30,
    });

    return json(
      {
        ok: false,
        order: failed,
      },
      { status: 502 }
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "eventicious-reward-shop",
        now: new Date().toISOString(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/identify") {
      return handleIdentify(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/shop") {
      return handleShop(env);
    }

    if (request.method === "POST" && url.pathname === "/api/purchase") {
      return handlePurchase(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
