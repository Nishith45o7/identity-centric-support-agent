# CONTEXTIS — PRODUCTION DEPLOYMENT GUIDE

**Version:** 1.0.0  
**Scope:** Production Deployment, Database Provisioning, and Cloud Infrastructure

---

## 1. PRODUCTION PREREQUISITES

Before deploying Contextis to production, ensure the following are provisioned:
1. **Managed PostgreSQL:** A hosted PostgreSQL instance (e.g., Lakebase Postgres on Neon, AWS RDS, or Google Cloud SQL).
2. **Custom Secrets:** Strong random values for `API_KEY_PEPPER` (32+ chars), `BILLING_WEBHOOK_SECRET`, and `SUPPORT_API_KEY`.
3. **Frontier AI Credentials:** Active `GROQ_API_KEY` (Llama 3.3 70B) and `HINDSIGHT_API_KEY` (Vector Memory).
4. **Custom Domain & SSL:** HTTPS certificate and domain mapping (e.g. `app.contextis.com` and `api.contextis.com`).

---

## 2. PRODUCTION ENVIRONMENT CONFIGURATION

```ini
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://app.contextis.com,https://contextis.com
DATABASE_URL=postgresql://user:pass@ep-cool-lake-12345.us-east-2.aws.neon.tech/contextis?sslmode=require
API_KEY_PEPPER=prod-pepper-random-secret-64-character-hex-string
BILLING_WEBHOOK_SECRET=whsec_live_production_stripe_secret
SUPPORT_API_KEY=sup_live_production_internal_key
GROQ_API_KEY=gsk_live_production_groq_key
HINDSIGHT_API_KEY=hsk_live_production_hindsight_key
HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io
MEMORY_MODE=on
PLATFORM_ADMIN_EMAILS=security@contextis.com,admin@contextis.com
```

---

## 3. DEPLOYMENT EXECUTION

### Step 1: Execute Database Migrations
```bash
npm run db:migrate
```
Applies idempotent migrations `001` through `008` with transaction safety and updates `schema_migrations`.

### Step 2: Validate Runtime Secrets
```bash
npm run validate:config
```
Ensures no default development pepper or missing secrets exist.

### Step 3: Start Node Server
```bash
node src/server.js
```
The server binds to `PORT` and verifies readiness probes (`GET /ready`).

---

## 4. DOCKER PRODUCTION CONTAINER

```bash
# Build production container
docker build -t contextis:latest .

# Run with secure environment variables
docker run -d \
  --name contextis-production \
  -p 3000:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  contextis:latest
```
Container executes as non-root user `node` and performs automatic pre-flight migrations via `docker-entrypoint.sh`.
