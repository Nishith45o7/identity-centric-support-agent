# CONTEXTIS — STAGING DEPLOYMENT SPECIFICATION

**Document ID:** CSD-2026-PHASE-15  
**Version:** 1.0.0  
**Environment:** Staging (`NODE_ENV=staging`)  
**Target Topology:** Isolated Multi-Tenant Container Stack with Dedicated Staging PostgreSQL

---

## 1. ARCHITECTURE OVERVIEW

The Contextis Staging Environment mirrors the eventual production topology while maintaining 100% cryptographic and infrastructural isolation from production data, production memories, and live billing systems.

```text
                               STAGING DOMAIN
                         (e.g., staging.contextis.com)
                                      │
                         ┌────────────┴────────────┐
                         │                         │
                   Staging Frontend           Staging API
                   Dashboard & Web App        (/v1/*, /api/*)
                         │                         │
                         └────────────┬────────────┘
                                      │
                             Staging Database
                        (contextis_staging on PG)
                                      │
                         ┌────────────┴────────────┐
                         │                         │
                 Hindsight Memory             Groq AI
                 (ctx_staging_* scope)      (Staging Config)
                         │
                         ▼
               Staging Chat Widget
             (/staging, /widget.js)
```

---

## 2. STRICT ENVIRONMENT SEPARATION MATRIX

| Layer | Staging Environment | Production Environment | Separation Mechanism |
| :--- | :--- | :--- | :--- |
| **Node Runtime** | `NODE_ENV=staging` | `NODE_ENV=production` | Explicit runtime branch in `validateRuntimeConfig`. |
| **Database** | `contextis_staging` on isolated host/port | `contextis_production` on dedicated cluster | Unique `DATABASE_URL` credentials; no cross-network peering. |
| **Hindsight Vector Banks** | `ctx_staging_<hash>` | `ctx_live_<hash>` / `ctx_production_<hash>` | Deterministic prefix generated via `buildBankId(..., 'staging')`. |
| **API Keys** | `pk_test_*`, `sk_test_*` | `pk_live_*`, `sk_live_*` | Environment validation check on every API call. |
| **HMAC Secret Pepper** | Staging 32+ char secret | Production 64+ char secret | Independent values; default development pepper rejected. |
| **Stripe / Billing** | `whsec_staging_...` | Live production secret | Isolated webhook listeners; sandbox payment tokens only. |
| **CORS Origins** | `staging.contextis.com` | `contextis.com`, `app.contextis.com` | Dedicated origin allowlists in `CORS_ORIGIN`. |

---

## 3. CONTAINER TOPOLOGY & DOCKER COMPOSE

The staging environment is deployed via [`docker-compose.staging.yml`](file:///d:/projects/identity-centric-support/docker-compose.staging.yml):

- **`staging-db`**: `postgres:16-alpine` running on internal bridge network `staging-network`, exposing port `5433` externally (internal `5432`). Health checked via `pg_isready`.
- **`staging-app`**: Production-hardened container based on [`Dockerfile`](file:///d:/projects/identity-centric-support/Dockerfile):
  - Base: `node:20-alpine`
  - Non-root user: `USER node`
  - Pre-flight migrations: [`docker-entrypoint.sh`](file:///d:/projects/identity-centric-support/docker-entrypoint.sh) executes `node src/db/migrate.js` before server startup.
  - Health check: Probes `GET /ready` every 10 seconds.

---

## 4. STAGING ENVIRONMENT VARIABLES

```ini
NODE_ENV=staging
PORT=3000
CORS_ORIGIN=http://localhost:3000,http://localhost:3001,https://staging.contextis.com,https://api-staging.contextis.com
DATABASE_URL=postgresql://contextis_staging_user:staging_secure_pass_9988@staging-db:5432/contextis_staging?sslmode=disable
API_KEY_PEPPER=staging-pepper-crypto-hash-998877665544332211
BILLING_WEBHOOK_SECRET=whsec_staging_test_secret_998877
SUPPORT_API_KEY=sup_staging_key_88776655
MEMORY_MODE=on
RUN_MIGRATIONS=true
PLATFORM_ADMIN_EMAILS=admin@contextis.test,staging-admin@contextis.test
```

---

## 5. REPRODUCIBLE DEPLOYMENT STEPS

### 5.1 Local Staging Stack
```bash
# 1. Build and boot staging stack
docker compose -f docker-compose.staging.yml up -d --build

# 2. Monitor startup and automatic migration execution
docker compose -f docker-compose.staging.yml logs -f staging-app

# 3. Verify readiness probe
curl -s http://localhost:3001/ready | grep '"ready":true'

# 4. Access Staging Sandbox Demo
# Open browser to http://localhost:3001/staging
```

### 5.2 Standalone Cloud Deployment (e.g., Render, Railway, AWS ECS, Neon)
1. Provision a staging PostgreSQL branch (e.g. using Neon branching: `neon branches create --name staging`).
2. Set environment variables on the staging service:
   - `NODE_ENV=staging`
   - `DATABASE_URL=<staging_postgres_url>`
   - `API_KEY_PEPPER=<unique_staging_pepper>`
   - `BILLING_WEBHOOK_SECRET=<staging_webhook_secret>`
   - `SUPPORT_API_KEY=<staging_support_key>`
3. Run migrations via build command or release phase:
   ```bash
   npm run db:migrate
   ```
4. Start server:
   ```bash
   node src/server.js
   ```
5. Confirm probes:
   - `GET /health` -> 200 OK
   - `GET /ready` -> 200 OK (`database: 'connected'`)
