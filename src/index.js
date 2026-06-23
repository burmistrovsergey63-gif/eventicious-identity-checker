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

function sanitizeIdentity(identity) {
  return {
    fullName: sanitizeString(identity?.fullName) || "Unknown Eventicious user",
    email: sanitizeString(identity?.email),
    company: sanitizeString(identity?.company),
  };
}

function buildVisitRecord(payload, request) {
  const identity = sanitizeIdentity(payload.identity);

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
    profile: payload.profile ?? null,
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

  const visit = buildVisitRecord(payload || {}, request);
  const persistence = await maybePersistVisit(env, visit);

  return json({
    ok: true,
    visit,
    persistence,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "eventicious-identity-checker",
        now: new Date().toISOString(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/identify") {
      return handleIdentify(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
