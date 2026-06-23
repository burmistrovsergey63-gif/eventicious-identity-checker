# Eventicious Identity Checker

Мини-проект для Eventicious: страница открывается внутри приложения, через `EventiciousSDK` определяет пользователя и отправляет результат на Cloudflare Worker.

## Что умеет

- безопасно подключает Eventicious SDK и не ломается в обычном браузере
- читает `user GUID`, `event ID`, `locale`, `environment`
- пытается получить профиль через `EventiciousSDK.profilesManager.getProfile(eventId)`
- показывает данные на странице
- отправляет их в `/api/identify`
- может сохранять визиты в Cloudflare KV, если добавить binding `VISITS_KV`

## Структура

- `public/index.html` - UI для проверки пользователя
- `public/app.js` - инициализация SDK и отправка данных
- `public/styles.css` - стили
- `src/index.js` - Cloudflare Worker API + выдача статики
- `wrangler.jsonc` - конфиг Cloudflare Workers Static Assets

## Как определяется пользователь

Страница использует эти методы SDK:

- `EventiciousSDK.getUserGUID()`
- `EventiciousSDK.getCurrentConferenceId()`
- `EventiciousSDK.locale()`
- `EventiciousSDK.getEnv()`
- `EventiciousSDK.profilesManager.getProfile(eventId)`

Если страница открыта вне Eventicious, сайт показывает fallback-режим и отправляет на Worker только браузерные данные без SDK.

## Локальный git

Внутри папки проекта:

```powershell
git init
git add .
git commit -m "Initial Eventicious identity checker"
```

Если захотите сразу привязать удаленный репозиторий:

```powershell
git remote add origin <YOUR_GIT_REMOTE>
git branch -M main
git push -u origin main
```

## Деплой на Cloudflare

1. Установите Wrangler:

```powershell
npm install -D wrangler
```

2. Авторизуйтесь:

```powershell
npx wrangler login
```

3. Задеплойте проект:

```powershell
npx wrangler deploy
```

## Опционально: сохранять визиты в KV

1. Создайте KV namespace:

```powershell
npx wrangler kv namespace create VISITS_KV
```

2. Добавьте binding в `wrangler.jsonc`:

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

После этого Worker начнет сохранять визиты на 30 дней.
