# Tingilin API

Backend NestJS pour authentification, utilisateurs, raffles, tickets, paiements et notifications.

Base URL locale: `http://localhost:3000/api/v1`

## Stack

- NestJS 11
- MongoDB (Mongoose)
- JWT access/refresh
- Throttling global (`20 req / 60s` par IP)

## Prerequis

- Node.js 20+
- npm 10+
- Docker Desktop (recommande pour Mongo local)

## Installation

```powershell
cd d:\personnel\Tinguilin\tingilin-api
npm install
```

## Configuration

1. Copier le template:

```powershell
copy .env.example .env
```

2. Adapter les valeurs sensibles (`JWT_*`, `SETUP_KEY`, SMTP, etc.).

### Variables d'environnement

| Variable | Requis | Defaut code | Usage |
|---|---|---|---|
| `APP_PORT` | Non | `3000` | Port HTTP API |
| `MONGO_URI` | Oui | - | Connexion MongoDB |
| `APP_NAME` | Non | `Tingilin` | Nom app (emails) |
| `APP_WEB_URL` | Non | `http://localhost:8100` | Lien referral genere |
| `PUBLIC_APP_URL` | Non | `http://localhost:8100` | Redirection share page |
| `PUBLIC_API_URL` | Non | `http://localhost:3000` | URL meta/OG share |
| `JWT_ACCESS_SECRET` | Oui (prod) | `CHANGE_ME_ACCESS_SECRET` | Signature access token |
| `JWT_REFRESH_SECRET` | Oui (prod) | `CHANGE_ME_REFRESH_SECRET` | Signature refresh token |
| `JWT_ACCESS_EXPIRES_IN` | Non | `15m` | Expiration access token |
| `JWT_REFRESH_EXPIRES_IN` | Non | `7d` | Expiration refresh token |
| `SETUP_KEY` | Oui (si bootstrap admin) | - | Protection endpoint setup admin |
| `PASSWORD_RESET_RESEND_COOLDOWN_SEC` | Non | `60` | Cooldown resend code reset |
| `PASSWORD_RESET_CODE_TTL_MINUTES` | Non | `15` | Validite code reset |
| `PASSWORD_RESET_MAX_ATTEMPTS` | Non | `5` | Tentatives max reset |
| `PASSWORD_RESET_DEBUG_RESPONSE` | Non | `false` | Retourne le code en reponse (dev) |
| `SMTP_HOST` | Non | vide | SMTP host |
| `SMTP_PORT` | Non | `587` | SMTP port |
| `SMTP_SECURE` | Non | `false` | TLS direct (`true`/`false`) |
| `SMTP_USER` | Non | vide | SMTP username |
| `SMTP_PASS` | Non | vide | SMTP password |
| `MAIL_FROM` | Non | `Tingilin <no-reply@tingilin.local>` | Expediteur emails |
| `DIGIKUNTZ_BASE_URL` | Oui (si provider DIGIKUNTZ) | - | API paiement Digikuntz |
| `DIGIKUNTZ_USER_ID` | Oui (si provider DIGIKUNTZ) | - | Header auth Digikuntz |
| `DIGIKUNTZ_SECRET_KEY` | Oui (si provider DIGIKUNTZ) | - | Header auth Digikuntz |

## MongoDB local

Le repo contient `docker-compose.yml` pour MongoDB.

```powershell
docker compose up -d
```

Mongo expose sur `mongodb://localhost:27017`.

## Lancer l'API

```powershell
npm run start:dev
```

## Build et tests

```powershell
npm run build
npm run lint
npm run test
npm run test:e2e
```

## CORS local

Actuellement, le backend autorise `http://localhost:8100` dans `src/main.ts`.

Si votre frontend tourne sur un autre host/port, adaptez `app.enableCors(...)`.

## Bootstrap admin (onboarding)

Le role par defaut a l'inscription est `USER`.
Pour creer un admin:

1. Creer un compte via `POST /api/v1/auth/register`.
2. Appeler:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/v1/auth/setup/promote-admin" `
  -ContentType "application/json" `
  -Body '{"setupKey":"CHANGE_ME_SETUP_KEY","email":"admin@example.com"}'
```

Reponse attendue:

```json
{ "ok": true, "email": "admin@example.com", "role": "ADMIN" }
```

## Endpoints principaux

Tous les endpoints sont prefixes par `/api/v1`.

### Auth (public + user)

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/refresh`
- `GET /auth/me` (JWT)

### Users

- `GET /users/me` (JWT)
- `PATCH /users/me` (JWT)
- `GET /users/me/stats` (JWT)
- `GET /users/me/history` (JWT)
- `GET /users/me/referral-summary` (JWT)
- `PATCH /admin/users/:id/role` (ADMIN)

### Raffles

- Public:
  - `GET /raffles`
  - `GET /raffles/home`
  - `GET /raffles/live`
  - `GET /raffles/public`
  - `GET /raffles/public/:id`
  - `GET /raffles/winners`
  - `GET /raffles/:id/winner`
- Admin:
  - `POST /raffles/admin/create-with-product` (ADMIN)
  - `GET /admin/raffles` (ADMIN)
  - `POST /admin/raffles` (ADMIN)
  - `PATCH /admin/raffles/:id` (ADMIN)
  - `PATCH /admin/raffles/:id/start` (ADMIN)
  - `PATCH /admin/raffles/:id/close` (ADMIN)
  - `PATCH /admin/raffles/:id/draw` (ADMIN)

### Products

- `GET /products`
- `GET /products/:id`
- `GET /admin/products` (ADMIN)
- `POST /admin/products` (ADMIN)
- `PATCH /admin/products/:id` (ADMIN)
- `DELETE /admin/products/:id` (ADMIN)

### Payments (JWT)

- `POST /payments/intent`
- `POST /payments/mock/confirm`
- `POST /payments/mock/fail`
- `POST /payments/digikuntz/verify`
- `POST /payments/free-ticket`

### Tickets / Notifications / Share

- `GET /tickets/me` (JWT)
- `GET /notifications/me` (JWT)
- `GET /notifications/unread-count` (JWT)
- `PATCH /notifications/:id/read` (JWT)
- `PATCH /notifications/read-all` (JWT)
- `GET /share/raffle/:id` (public, OG + redirect)

## Paiement en local

Pour les tests locaux rapides, utilisez le provider `MOCK`:

1. `POST /payments/intent`
2. `POST /payments/mock/confirm` pour simuler succes
3. `POST /payments/mock/fail` pour simuler echec

## Troubleshooting

- `431 Request Header Fields Too Large`: token JWT invalide/trop gros cote frontend. Vider le localStorage puis se reconnecter.
- `CORS blocked`: verifier que le frontend tourne bien sur `http://localhost:8100` ou mettre a jour `main.ts`.
- `Mongo connection error`: verifier `MONGO_URI` et que le conteneur Mongo tourne.

