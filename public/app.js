const state = {
  initialized: false,
  lastProfile: null,
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
    fullName: fullName || "Имя не найдено",
    email: email || "Email не найден",
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
    sdk.setTitle("Identity Checker");
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
      fullName: "Страница открыта вне Eventicious",
      email: "SDK недоступен",
      company: null,
    },
  };
}

function updateIdentityCard(payload) {
  setText("identity-name", payload.identity.fullName);
  setText("user-guid", payload.userGuid || "Не получен");
  setText("user-email", payload.identity.email);
  setText("event-id", payload.conferenceId || "Не получен");
  setText("sdk-env", payload.environment || "Не получен");
  setText("sdk-locale", payload.locale || "Не получен");
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
    throw new Error(data.error || "Не удалось отправить данные на Worker.");
  }

  return data;
}

async function identifyCurrentVisitor() {
  const sdk = getSDK();
  const payload = sdk ? buildPayloadFromSdk(sdk) : buildFallbackPayload();

  updateIdentityCard(payload);
  setProfilePreview(null);

  if (sdk) {
    updateSdkStatus(
      "SDK подключен",
      "Данные пользователя читаются из Eventicious и отправляются на Cloudflare Worker."
    );
  } else {
    updateSdkStatus(
      "SDK не найден",
      "Это ожидаемо в обычном браузере. Страница покажет fallback-результат без данных Eventicious."
    );
  }

  setWorkerResponse("Отправляем данные на Cloudflare Worker...");

  try {
    const result = await sendIdentity(payload);
    setWorkerResponse(result);
  } catch (error) {
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

  identifyCurrentVisitor();
}

window.addEventListener("EventiciousSDKLoaded", initEventiciousPage);
window.addEventListener("load", initEventiciousPage);
