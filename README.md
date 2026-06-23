# Eventicious Identity Checker

Small Eventicious project: a page opens inside the app, identifies the current visitor through `EventiciousSDK`, and sends the result to a Cloudflare Worker.

## Features

- safely loads Eventicious SDK and still works in a normal browser
- reads `user GUID`, `event ID`, `locale`, and `environment`
- tries to read the current profile through `EventiciousSDK.profilesManager.getProfile(eventId)`
- shows the detected data on the page
- sends the payload to `/api/identify`
- can optionally store visits in Cloudflare KV through the `VISITS_KV` binding

## Project Structure

- `public/index.html` - page UI
- `public/app.js` - SDK initialization and identity collection
- `public/styles.css` - styling
- `src/index.js` - Cloudflare Worker API and static asset handler
- `wrangler.jsonc` - Cloudflare Workers config

## SDK Methods Used

- `EventiciousSDK.getUserGUID()`
- `EventiciousSDK.getCurrentConferenceId()`
- `EventiciousSDK.locale()`
- `EventiciousSDK.getEnv()`
- `EventiciousSDK.profilesManager.getProfile(eventId)`

If the page is opened outside Eventicious, the site falls back to browser-only mode and does not crash.

## Local Git

```powershell
git init
git add .
git commit -m "Initial Eventicious identity checker"
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

## Optional KV Storage

1. Create a KV namespace:

```powershell
npx wrangler kv namespace create VISITS_KV
```

2. Add the binding to `wrangler.jsonc`:

```json
{
  "kv_namespaces": [
    {
      "binding": "VISITS_KV",
      "id": "YOUR_NAMESPACE_ID"
    }
  ]
}
```

After that, the Worker can store visit records for 30 days.
