from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request
from uuid import uuid4

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"

app = Flask(__name__, static_folder=str(PUBLIC_DIR), static_url_path="")

DEFAULT_SHOP_ITEMS = [
    {
        "id": "coffee-voucher",
        "title": "Coffee Voucher",
        "description": "Redeem a coffee coupon at the event welcome desk.",
        "cost": 50,
    },
    {
        "id": "vip-lounge-pass",
        "title": "VIP Lounge Pass",
        "description": "One-time access to the partner lounge area.",
        "cost": 120,
    },
    {
        "id": "speaker-meetup",
        "title": "Speaker Meetup Slot",
        "description": "Reserve a small-group meetup slot with a speaker.",
        "cost": 200,
    },
]

ORDER_CACHE: dict[str, dict[str, Any]] = {}


def json_response(data: Any, status: int = 200):
    response = jsonify(data)
    response.status_code = status
    response.headers["Cache-Control"] = "no-store"
    return response


def sanitize_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    trimmed = value.strip()
    return trimmed or None


def sanitize_integer(value: Any) -> int | None:
    if isinstance(value, int):
        return value

    if isinstance(value, str) and value.strip():
        try:
            return int(value.strip(), 10)
        except ValueError:
            return None

    return None


def is_true(value: Any) -> bool:
    return str(value or "").lower() == "true"


def sanitize_identity(identity: Any) -> dict[str, Any]:
    identity = identity or {}
    return {
        "fullName": sanitize_string(identity.get("fullName")) or "Unknown Eventicious user",
        "email": sanitize_string(identity.get("email")),
        "company": sanitize_string(identity.get("company")),
    }


def get_nested_profiles(profile: Any) -> list[dict[str, Any]]:
    if not isinstance(profile, dict):
        return []

    nested = [
        profile,
        profile.get("user"),
        profile.get("attendee"),
        profile.get("profile"),
        profile.get("data"),
    ]

    return [item for item in nested if isinstance(item, dict)]


def resolve_external_id(profile: Any) -> int | None:
    nested = get_nested_profiles(profile)
    candidates: list[Any] = []

    for item in nested:
        candidates.extend(
            [
                item.get("externalId"),
                item.get("externalID"),
                item.get("external_id"),
                item.get("userExternalId"),
                item.get("attendeeExternalId"),
            ]
        )

    if is_true(os.getenv("EVENTICIOUS_ALLOW_PROFILE_ID_FALLBACK")):
        for item in nested:
            candidates.append(item.get("id"))

    for candidate in candidates:
        normalized = sanitize_integer(candidate)
        if normalized is not None:
            return normalized

    return None


def get_shop_items() -> list[dict[str, Any]]:
    raw = sanitize_string(os.getenv("SHOP_ITEMS_JSON"))
    if raw:
      try:
          parsed = json.loads(raw)
          if isinstance(parsed, list):
              items: list[dict[str, Any]] = []
              for item in parsed:
                  if not isinstance(item, dict):
                      continue

                  normalized = {
                      "id": sanitize_string(item.get("id")),
                      "title": sanitize_string(item.get("title")),
                      "description": sanitize_string(item.get("description")),
                      "cost": sanitize_integer(item.get("cost")),
                  }

                  if normalized["id"] and normalized["title"] and normalized["cost"] is not None:
                      items.append(normalized)

              if items:
                  return items
      except json.JSONDecodeError:
          pass

    return DEFAULT_SHOP_ITEMS


def get_purchase_capabilities() -> dict[str, Any]:
    debug_mode = is_true(os.getenv("SHOP_DEBUG_MODE"))
    has_api_credentials = bool(sanitize_string(os.getenv("EVENTICIOUS_CLIENT_ID"))) and bool(
        sanitize_string(os.getenv("EVENTICIOUS_CLIENT_SECRET"))
    )

    return {
        "canPurchase": debug_mode or has_api_credentials,
        "debugMode": debug_mode,
        "hasApiCredentials": has_api_credentials,
        "hasOrdersKv": False,
        "baseUrl": sanitize_string(os.getenv("EVENTICIOUS_BASE_URL")) or "https://api-integration.eventicious.ru",
        "balanceLookupAvailable": False,
        "notes": [
            "Layero generic static deploy can build the frontend, but full point write-off needs the Flask runtime because secrets and API routes must run on the server.",
            "This Layero Flask version keeps order history only in memory unless you connect external storage.",
            "The provided Eventicious API docs expose point write-off through negative scores on add-manual-charge.",
            "The provided docs do not expose a current points balance endpoint, so the shop cannot reliably pre-check remaining points.",
        ],
    }


def build_visit_record(payload: dict[str, Any]) -> dict[str, Any]:
    profile = payload.get("profile")

    return {
        "id": str(uuid4()),
        "receivedAt": sanitize_string(payload.get("openedAt")) or payload.get("receivedAt") or None,
        "source": sanitize_string(payload.get("source")) or "unknown",
        "sdkAvailable": bool(payload.get("sdkAvailable")),
        "conferenceId": sanitize_string(payload.get("conferenceId")),
        "userGuid": sanitize_string(payload.get("userGuid")),
        "locale": sanitize_string(payload.get("locale")),
        "environment": sanitize_string(payload.get("environment")),
        "openedAt": sanitize_string(payload.get("openedAt")),
        "identity": sanitize_identity(payload.get("identity")),
        "externalId": resolve_external_id(profile),
        "profile": profile,
        "requestMeta": {
            "remoteAddr": sanitize_string(request.headers.get("x-forwarded-for")) or request.remote_addr,
            "userAgent": sanitize_string(request.headers.get("user-agent")),
            "referer": sanitize_string(request.headers.get("referer")),
        },
    }


def http_json(url: str, method: str, body: dict[str, Any], headers: dict[str, str] | None = None) -> tuple[int, Any]:
    encoded = json.dumps(body).encode("utf-8")
    request_headers = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)

    req = urllib_request.Request(url, data=encoded, method=method, headers=request_headers)
    try:
        with urllib_request.urlopen(req) as response:
            raw = response.read().decode("utf-8")
            return response.status, raw
    except urllib_error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Eventicious request failed ({error.code}): {raw or 'empty response'}") from error


def http_form(url: str, body: dict[str, str]) -> dict[str, Any]:
    encoded = urllib_parse.urlencode(body).encode("utf-8")
    req = urllib_request.Request(
        url,
        data=encoded,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib_request.urlopen(req) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw)
    except urllib_error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"error": raw}
        message = payload.get("error_description") or payload.get("error") or f"HTTP {error.code}"
        raise RuntimeError(f"Failed to fetch Eventicious access token ({error.code}): {message}") from error


def get_access_token() -> tuple[str, str]:
    client_id = sanitize_string(os.getenv("EVENTICIOUS_CLIENT_ID"))
    client_secret = sanitize_string(os.getenv("EVENTICIOUS_CLIENT_SECRET"))
    base_url = sanitize_string(os.getenv("EVENTICIOUS_BASE_URL")) or "https://api-integration.eventicious.ru"

    if not client_id or not client_secret:
        raise RuntimeError("Environment variables EVENTICIOUS_CLIENT_ID and EVENTICIOUS_CLIENT_SECRET are required.")

    token_payload = http_form(
        f"{base_url}/connect/token",
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )

    access_token = token_payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise RuntimeError("Failed to fetch Eventicious access token: access_token is missing.")

    return access_token, base_url


def write_off_points(external_id: int, cost: int, reason: str) -> dict[str, Any]:
    access_token, base_url = get_access_token()
    status_code, raw = http_json(
        f"{base_url}/api/external/v2/gamification/add-manual-charge",
        "POST",
        {
            "externalId": external_id,
            "scores": -cost,
            "reason": reason,
        },
        headers={"Authorization": f"Bearer {access_token}"},
    )

    return {
        "ok": True,
        "status": status_code,
        "rawResponse": raw or None,
    }


@app.get("/api/health")
def api_health():
    return json_response(
        {
            "ok": True,
            "service": "eventicious-reward-shop-layero",
        }
    )


@app.post("/api/identify")
def api_identify():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return json_response({"ok": False, "error": "Body must be valid JSON."}, status=400)

    visit = build_visit_record(payload)
    persistence = {
        "persisted": False,
        "message": "Layero version does not include durable order/visit storage by default.",
    }

    return json_response(
        {
            "ok": True,
            "visit": visit,
            "persistence": persistence,
            "capabilities": get_purchase_capabilities(),
        }
    )


@app.get("/api/shop")
def api_shop():
    return json_response(
        {
            "ok": True,
            "items": get_shop_items(),
            "capabilities": get_purchase_capabilities(),
        }
    )


@app.post("/api/purchase")
def api_purchase():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return json_response({"ok": False, "error": "Body must be valid JSON."}, status=400)

    item_id = sanitize_string(payload.get("itemId"))
    order_id = sanitize_string(payload.get("orderId"))
    visitor_payload = payload.get("visitor") if isinstance(payload.get("visitor"), dict) else {}
    items = get_shop_items()
    item = next((entry for entry in items if entry["id"] == item_id), None)

    if not item:
        return json_response({"ok": False, "error": "Unknown shop item."}, status=404)

    if not order_id:
        return json_response({"ok": False, "error": "orderId is required."}, status=400)

    existing = ORDER_CACHE.get(order_id)
    if existing:
        return json_response({"ok": True, "order": existing, "duplicate": True})

    visit = build_visit_record(visitor_payload)
    debug_mode = is_true(os.getenv("SHOP_DEBUG_MODE"))

    if visit["source"] != "eventicious-sdk" and not debug_mode:
        return json_response(
            {
                "ok": False,
                "error": "Purchases are allowed only when the page is opened inside Eventicious.",
            },
            status=400,
        )

    if visit["externalId"] is None and not debug_mode:
        return json_response(
            {
                "ok": False,
                "error": "Could not resolve externalId from the Eventicious profile. Inspect the raw profile and map the correct field first.",
                "visit": visit,
            },
            status=400,
        )

    order = {
        "id": order_id,
        "createdAt": __import__("datetime").datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
        "status": "pending",
        "item": {
            "id": item["id"],
            "title": item["title"],
            "cost": item["cost"],
        },
        "visitor": {
            "fullName": visit["identity"]["fullName"],
            "email": visit["identity"]["email"],
            "userGuid": visit["userGuid"],
            "conferenceId": visit["conferenceId"],
            "externalId": visit["externalId"],
        },
        "notes": [
            "Layero runtime keeps order cache in memory unless external persistence is added.",
            "This MVP relies on Eventicious SDK identity from the client.",
        ],
    }

    ORDER_CACHE[order_id] = order

    if debug_mode:
        completed = {
            **order,
            "status": "completed",
            "completedAt": __import__("datetime").datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "eventicious": {
                "ok": True,
                "mocked": True,
                "message": "Debug mode completed a mock purchase without a real Eventicious API call.",
            },
        }
        ORDER_CACHE[order_id] = completed
        return json_response({"ok": True, "order": completed, "duplicate": False})

    try:
        api_result = write_off_points(
            visit["externalId"],
            item["cost"],
            f"Shop purchase: {item['title']}",
        )
        completed = {
            **order,
            "status": "completed",
            "completedAt": __import__("datetime").datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "eventicious": api_result,
        }
        ORDER_CACHE[order_id] = completed
        return json_response({"ok": True, "order": completed, "duplicate": False})
    except Exception as error:
        failed = {
            **order,
            "status": "failed",
            "failedAt": __import__("datetime").datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "error": str(error),
        }
        ORDER_CACHE[order_id] = failed
        return json_response({"ok": False, "order": failed}, status=502)


@app.route("/", defaults={"asset_path": ""})
@app.route("/<path:asset_path>")
def serve_frontend(asset_path: str):
    if asset_path.startswith("api/"):
        return json_response({"ok": False, "error": "Not found."}, status=404)

    file_path = PUBLIC_DIR / asset_path
    if asset_path and file_path.exists() and file_path.is_file():
        return send_from_directory(PUBLIC_DIR, asset_path)

    return send_from_directory(PUBLIC_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "3000")), debug=False)
