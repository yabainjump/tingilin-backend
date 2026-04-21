# Production Setup: Load Balancing + Low-Latency

This folder contains a production-ready template to run `tingilin-api` with:

- 2+ Node instances managed by PM2
- Nginx (or HAProxy) reverse proxy and load balancing
- Sticky behavior for Socket.IO traffic
- Health checks for safe failover and zero-downtime reload

## 1. Recommended topology

- Frontend (Ionic web/admin): static hosting + CDN cache
- Backend API: dedicated Linux VM/VPS (not classic cPanel Passenger)
- MongoDB: Atlas or managed Mongo with private peering when possible

For a shared cPanel Node environment, horizontal scaling is very limited.  
Use this setup on a VM where you control Nginx/HAProxy + PM2.

## cPanel + Passenger note

If you deploy on cPanel with Passenger instead of PM2:

- configure the application startup file to `app.js`
- keep your real environment in `.env`
- rebuild the app, then restart Passenger with `touch tmp/restart.txt`
- use `deploy/scripts/deploy-cpanel-passenger.sh` as a safer deployment base

Important:

- Passenger startup failures usually come from a crashing Node app, not from `curl`
- if your `.env` still contains placeholder secrets like `CHANGE_ME_*`, the backend now refuses to start on purpose
- under Nginx + Passenger, `.htaccess` is generally not the source of truth for the Node app startup

## 2. Backend environment (minimum)

Set these variables on the backend server:

```bash
NODE_ENV=production
APP_PORT=3001
PM2_INSTANCES=3
TRUST_PROXY=1
HTTP_KEEP_ALIVE_TIMEOUT_MS=65000
HTTP_HEADERS_TIMEOUT_MS=66000
HTTP_REQUEST_TIMEOUT_MS=120000

# CORS: all frontends that call the API
CORS_ORIGINS=https://tinguilin.yaba-in.com,https://admin.tinguilin.yaba-in.com,https://app.digikuntz.com
```

`APP_PORT=3001` is the base port. PM2 increments ports automatically:
`3001`, `3002`, `3003`, etc.

## 3. PM2 startup

From the backend directory:

```bash
chmod +x deploy/scripts/deploy.sh deploy/scripts/healthcheck.sh
./deploy/scripts/deploy.sh
```

This script:

1. installs production dependencies
2. builds NestJS
3. starts/reloads PM2 app
4. saves PM2 process list
5. checks `/health/ready`

## 4. Nginx setup (recommended)

Copy:

- `deploy/nginx/backend.tinguilin.yaba-in.com.conf`
  -> `/etc/nginx/conf.d/backend.tinguilin.yaba-in.com.conf`

Then:

```bash
nginx -t
systemctl reload nginx
```

The provided config includes:

- sticky-ish balancing (`hash $remote_addr consistent`) for Socket.IO stability
- dedicated `/socket.io/` upgrade block (WebSocket)
- tuned timeouts for mobile/slow networks
- probes on `/health` and `/health/ready`

## 5. HAProxy alternative

If you prefer HAProxy, use:

- `deploy/haproxy/haproxy.cfg`

It includes:

- backend health checks (`GET /health/ready`)
- source-based balancing for Socket.IO backend
- server cookies for HTTP backend stickiness

## 6. Verification checklist

```bash
curl -i https://backend.tinguilin.yaba-in.com/health
curl -i https://backend.tinguilin.yaba-in.com/health/ready
curl -i https://backend.tinguilin.yaba-in.com/api/v1/raffles/home
```

Expected:

- `/health` => `200`
- `/health/ready` => `200` when Mongo is connected
- API route works through proxy with correct CORS headers

## 7. Latency hardening extras

- Enable Cloudflare (or another CDN) for frontend static assets.
- Keep API uncached except static `/uploads` where appropriate.
- Use MongoDB region close to your users.
- Keep TLS termination at Nginx/HAProxy and keep backend private (`127.0.0.1`).
