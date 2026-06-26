# Eventicious Reward Shop

Small Eventicious project: a page opens inside the app, identifies the current visitor through `EventiciousSDK`, shows a small reward store, and writes off points through a server backend.

## Features

- safely loads Eventicious SDK and still works in a normal browser
- reads `user GUID`, `event ID`, `locale`, and `environment`
- tries to read the current profile through `EventiciousSDK.profilesManager.getProfile(eventId)`
- resolves an `externalId` candidate from the profile
- shows a small reward catalog
- sends purchases to `/api/purchase`
- uses the Eventicious external API to write off points by sending negative `scores`
- supports the original Cloudflare Worker deployment
- includes a Layero-compatible Flask runtime backend
- includes a fallback `npm run build` for Layero generic/static builds

## Project Structure

- `public/index.html` - reward shop UI
- `public/app.js` - SDK initialization, identity collection, and purchase flow
- `public/styles.css` - styling
- `src/index.js` - Cloudflare Worker API, Eventicious API bridge, and static asset handler
- `src/shop-catalog.js` - default shop items
- `app.py` - Layero/Flask backend that serves the UI and API routes
- `requirements.txt` - Python dependencies for the Layero runtime
- `scripts/build-static.mjs` - static fallback build for generic platforms
- `wrangler.jsonc` - Cloudflare Workers config
- `.dev.vars.example` - example local development secrets

## SDK Methods Used

- `EventiciousSDK.getUserGUID()`
- `EventiciousSDK.getCurrentConferenceId()`
- `EventiciousSDK.locale()`
- `EventiciousSDK.getEnv()`
- `EventiciousSDK.profilesManager.getProfile(eventId)`

If the page is opened outside Eventicious, the site falls back to browser-only mode and does not crash.

## Important Constraints

- The provided Eventicious API docs expose point write-off through `POST /api/external/v2/gamification/add-manual-charge`.
- The `scores` field may be negative, which enables point deduction.
- In the provided docs there is no endpoint for reading the current points balance, so the shop cannot reliably pre-check the remaining balance.
- Identity is collected from the Eventicious SDK running in the client. This is workable for an MVP, but it is not a cryptographically verified checkout flow.
- The Layero Flask runtime keeps order history only in memory by default. If you need durable storage there, add an external database or storage service.

## Layero Deploy

For a full working Layero deploy, use the Flask/runtime mode rather than a pure static generic build. Static hosting can show the UI, but the purchase flow needs server-side secrets and API routes.

Required environment variables for Layero:

```text
EVENTICIOUS_CLIENT_ID
EVENTICIOUS_CLIENT_SECRET
```

Optional:

```text
EVENTICIOUS_BASE_URL=https://api-integration.eventicious.ru
EVENTICIOUS_ALLOW_PROFILE_ID_FALLBACK=false
SHOP_DEBUG_MODE=false
SHOP_ITEMS_JSON=[...]
```

If the Layero project is still configured as a generic/static app, the repository now also contains:

- `npm run build` - copies `public/` into `dist/`

That removes the previous `Missing script: build` error, but the full reward shop still needs the Flask runtime to execute `/api/*`.

## Cloudflare Secrets

Set these before enabling purchases:

```powershell
npx wrangler secret put EVENTICIOUS_CLIENT_ID
npx wrangler secret put EVENTICIOUS_CLIENT_SECRET
```

Optional:

```powershell
npx wrangler secret put EVENTICIOUS_BASE_URL
```

Default `EVENTICIOUS_BASE_URL`:

```text
https://api-integration.eventicious.ru
```

Optional local dev file:

```text
.dev.vars
```

with the same keys as in `.dev.vars.example`.

Temporary UI testing mode:

```text
SHOP_DEBUG_MODE=true
```

When enabled, the `Buy Item` buttons are unlocked and `/api/purchase` returns a mocked successful order without calling the real Eventicious write-off API.

## Cloudflare KV

Create at least one KV namespace for orders:

```powershell
npx wrangler kv namespace create ORDERS_KV
```

Optional second KV namespace for visitor logs:

```powershell
npx wrangler kv namespace create VISITS_KV
```

Then add the bindings to `wrangler.jsonc`:

```json
{
  "kv_namespaces": [
    {
      "binding": "ORDERS_KV",
      "id": "YOUR_ORDERS_NAMESPACE_ID"
    },
    {
      "binding": "VISITS_KV",
      "id": "YOUR_VISITS_NAMESPACE_ID"
    }
  ]
}
```

`ORDERS_KV` is required for purchases. `VISITS_KV` is optional.

## Default Shop Items

The default catalog lives in `src/shop-catalog.js`.

You can also override it through a Worker environment variable:

```json
[
  {
    "id": "coffee-voucher",
    "title": "Coffee Voucher",
    "description": "Redeem a coffee coupon at the event welcome desk.",
    "cost": 50
  }
]
```

and store it in `SHOP_ITEMS_JSON`.

## Local Git

```powershell
git init
git add .
git commit -m "Initial Eventicious reward shop"
```

To connect a remote repository:

```powershell
git remote add origin <YOUR_GIT_REMOTE>
git branch -M main
git push -u origin main
```

## Cloudflare Deploy

1. Install Wrangler:

```powershell
npm install -D wrangler
```

2. Log in:

```powershell
npx wrangler login
```

3. Deploy:

```powershell
npx wrangler deploy
```
