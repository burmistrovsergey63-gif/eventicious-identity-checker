const state = {
  initialized: false,
  lastProfile: null,
  lastVisitorPayload: null,
  lastVisitResponse: null,
  shopConfig: null,
  purchaseInFlight: null,
};

function getSDK() {
  return window.EventiciousSDK || null;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value ?? "-";
  }
}

function setWorkerResponse(value) {
  const node = document.getElementById("worker-response");
  node.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setProfilePreview(value) {
  const node = document.getElementById("profile-preview");
  if (!value) {
    node.classList.add("hidden");
    node.textContent = "";
    return;
  }

  node.classList.remove("hidden");
  node.textContent = JSON.stringify(value, null, 2);
}

function setShopNote(value) {
  setText("shop-note", value);
}

function normalizeEnvironment(code) {
  switch (code) {
    case 0:
      return "backstack";
    case 1:
      return "modal";
    case 2:
      return "menu";
    default:
      return String(code ?? "unknown");
  }
}

function readFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractIdentity(profile) {
  const nested = [
    profile,
    profile?.user,
    profile?.attendee,
    profile?.profile,
    profile?.data,
  ].filter(Boolean);

  const firstName = readFirstString(...nested.map((item) => item.firstName));
  const lastName = readFirstString(...nested.map((item) => item.lastName));
  const fullName = readFirstString(
    ...nested.map((item) => item.fullName),
    ...nested.map((item) => item.name),
    [firstName, lastName].filter(Boolean).join(" ")
  );
  const email = readFirstString(...nested.map((item) => item.email));
  const company = readFirstString(
    ...nested.map((item) => item.company),
    ...nested.map((item) => item.organization),
    ...nested.map((item) => item.organisation)
  );

  return {
    fullName: fullName || "Profile name not found",
    email: email || "Email not found",
    company: company || null,
  };
}

function updateSdkStatus(title, hint) {
  setText("sdk-status", title);
  setText("sdk-hint", hint);
}

function configureSdkChrome(sdk) {
  if (sdk.Buttons?.Left) {
    sdk.Buttons.Left.setVisible(true);
    sdk.Buttons.Left.setText("Back");
    sdk.Buttons.Left.onClick(() => sdk.close());
  }

  if (sdk.Buttons?.Right) {
    sdk.Buttons.Right.setVisible(true);
    sdk.Buttons.Right.setText("Refresh");
    sdk.Buttons.Right.onClick(() => identifyCurrentVisitor());
  }

  if (typeof sdk.setTitle === "function") {
    sdk.setTitle("Reward Shop");
  }
}

function buildPayloadFromSdk(sdk) {
  const conferenceId = typeof sdk.getCurrentConferenceId === "function"
    ? String(sdk.getCurrentConferenceId())
    : null;
  const userGuid = typeof sdk.getUserGUID === "function"
    ? sdk.getUserGUID()
    : null;
  const locale = typeof sdk.locale === "function"
    ? sdk.locale()
    : null;
  const environment = typeof sdk.getEnv === "function"
    ? normalizeEnvironment(sdk.getEnv())
    : null;
  const profile = conferenceId && sdk.profilesManager?.getProfile
    ? sdk.profilesManager.getProfile(Number(conferenceId))
    : null;
  const identity = extractIdentity(profile || {});

  state.lastProfile = profile;

  return {
    source: "eventicious-sdk",
    sdkAvailable: true,
    conferenceId,
    userGuid,
    locale,
    environment,
    openedAt: new Date().toISOString(),
    profile,
    identity,
  };
}

function buildFallbackPayload() {
  state.lastProfile = null;

  return {
    source: "regular-browser",
    sdkAvailable: false,
    conferenceId: null,
    userGuid: null,
    locale: navigator.language || null,
    environment: "browser",
    openedAt: new Date().toISOString(),
    profile: null,
    identity: {
      fullName: "Opened outside Eventicious",
      email: "SDK unavailable",
      company: null,
    },
  };
}

function updateIdentityCard(payload, visitResponse) {
  setText("identity-name", payload.identity.fullName);
  setText("user-guid", payload.userGuid || "Not available");
  setText("user-email", payload.identity.email);
  setText("event-id", payload.conferenceId || "Not available");
  setText("sdk-env", payload.environment || "Not available");
  setText("sdk-locale", payload.locale || "Not available");
  setText("external-id", visitResponse?.visit?.externalId ?? "Not resolved");
  setText("opened-at", new Date(payload.openedAt).toLocaleString());
}

async function sendIdentity(payload) {
  const response = await fetch("/api/identify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to send visitor data to the Worker.");
  }

  return data;
}

async function fetchShopConfig() {
  const response = await fetch("/api/shop");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to load store configuration.");
  }

  return data;
}

async function sendPurchase(itemId) {
  const response = await fetch("/api/purchase", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      itemId,
      orderId: crypto.randomUUID(),
      visitor: state.lastVisitorPayload,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const detailedMessage =
      data.error ||
      data.order?.error ||
      "Failed to complete purchase.";
    const error = new Error(detailedMessage);
    error.payload = data;
    throw error;
  }

  return data;
}

function canPurchase() {
  return state.lastVisitorPayload?.source === "eventicious-sdk";
}

function renderShop() {
  const container = document.getElementById("shop-items");
  const items = state.shopConfig?.items || [];

  container.innerHTML = "";

  if (items.length === 0) {
    container.innerHTML = "<article class=\"panel shop-card\"><p>No shop items configured yet.</p></article>";
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "panel shop-card";

    const statusCopy = canPurchase()
      ? "Ready to submit a point write-off request."
      : "Checkout is available only when the page is opened inside Eventicious.";

    card.innerHTML = `
      <p class="label">Reward</p>
      <h3>${item.title}</h3>
      <p>${item.description || ""}</p>
      <div class="shop-meta">
        <span class="price-pill">${item.cost} pts</span>
      </div>
      <button type="button" data-item-id="${item.id}" ${canPurchase() ? "" : "disabled"}>Buy Item</button>
      <div class="status-copy">${statusCopy}</div>
    `;

    container.appendChild(card);
  }

  container.querySelectorAll("button[data-item-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.purchaseInFlight) {
        return;
      }

      state.purchaseInFlight = button.getAttribute("data-item-id");
      button.textContent = "Processing...";
      button.disabled = true;

      try {
        const result = await sendPurchase(state.purchaseInFlight);
        setWorkerResponse(result);
      } catch (error) {
        const payload = error && typeof error === "object" && "payload" in error
          ? error.payload
          : null;

        setWorkerResponse(
          payload || {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      } finally {
        state.purchaseInFlight = null;
        renderShop();
      }
    });
  });
}

async function identifyCurrentVisitor() {
  const sdk = getSDK();
  const payload = sdk ? buildPayloadFromSdk(sdk) : buildFallbackPayload();
  state.lastVisitorPayload = payload;

  setProfilePreview(null);

  if (sdk) {
    updateSdkStatus(
      "SDK connected",
      "Visitor data is being read from Eventicious and sent to the Worker."
    );
  } else {
    updateSdkStatus(
      "SDK not found",
      "This is expected in a normal browser. The page will stay in fallback mode."
    );
  }

  setWorkerResponse("Sending visitor data to the Worker...");

  try {
    const result = await sendIdentity(payload);
    state.lastVisitResponse = result;
    updateIdentityCard(payload, result);
    setWorkerResponse(result);
    renderShop();
  } catch (error) {
    updateIdentityCard(payload, null);
    setWorkerResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function initEventiciousPage() {
  if (state.initialized) {
    return;
  }

  state.initialized = true;

  const sdk = getSDK();
  if (sdk) {
    configureSdkChrome(sdk);
  }

  document.getElementById("identify-button").addEventListener("click", identifyCurrentVisitor);
  document.getElementById("profile-button").addEventListener("click", () => {
    setProfilePreview(state.lastProfile);
  });
  document.getElementById("close-button").addEventListener("click", () => {
    const currentSdk = getSDK();
    if (currentSdk?.close) {
      currentSdk.close();
      return;
    }

    window.close();
  });

  fetchShopConfig()
    .then((result) => {
      state.shopConfig = result;
      const notes = result.capabilities?.notes || [];
      setShopNote(notes[0] || "Shop configuration loaded.");
      renderShop();
    })
    .catch((error) => {
      setShopNote(error instanceof Error ? error.message : String(error));
      setWorkerResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      identifyCurrentVisitor();
    });
}

window.addEventListener("EventiciousSDKLoaded", initEventiciousPage);
window.addEventListener("load", initEventiciousPage);
