# Eventicious Reward Shop

Small Eventicious project: a page opens inside the app, identifies the current visitor through `EventiciousSDK`, shows a small reward store, and writes off points through a Cloudflare Worker.

## Features

- safely loads Eventicious SDK and still works in a normal browser
- reads `user GUID`, `event ID`, `locale`, and `environment`
- tries to read the current profile through `EventiciousSDK.profilesManager.getProfile(eventId)`
- resolves an `externalId` candidate from the profile
- shows a small reward catalog
- sends purchases to `/api/purchase`
- uses the Eventicious external API to write off points by sending negative `scores`
- stores orders in Cloudflare KV through the `ORDERS_KV` binding
- can optionally store visits in Cloudflare KV through the `VISITS_KV` binding

## Project Structure

- `public/index.html` - reward shop UI
- `public/app.js` - SDK initialization, identity collection, and purchase flow
- `public/styles.css` - styling
- `src/index.js` - Cloudflare Worker API, Eventicious API bridge, and static asset handler
- `src/shop-catalog.js` - default shop items
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
