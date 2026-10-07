# CONTEXTIS — DEPLOYMENT RUNBOOK

**Document ID:** DRB-2026-PHASE-15  
**Version:** 1.0.0  
**Scope:** Standard Operating Procedure for Staging & Production Deployments

---

## 1. PRE-DEPLOYMENT CHECKLIST

Before deploying any build to staging or production, verify:
- [ ] Working branch is clean and merged into `staging` or `main`.
- [ ] All 16 automated test suites pass cleanly (`npm test`).
- [ ] Runtime configuration validation passes (`npm run validate:config`).
- [ ] No plaintext secrets or passwords exist in source files or git history.
- [ ] Staging database instance is provisioned and reachable via `DATABASE_URL`.
- [ ] Staging environment variables are configured in the hosting provider dashboard.

---

## 2. REPEATABLE DEPLOYMENT PIPELINE

The deployment workflow follows a strict sequential pipeline:

```text
1. Code Merge
      ↓
2. Automated Test Suite (189 tests)
      ↓
3. Container Image Build
      ↓
4. Database Migrations (node src/db/migrate.js)
      ↓
5. Container Launch & Traffic Switch
      ↓
6. Readiness & Health Verification (/ready)
      ↓
7. Synthetic Smoke Test Execution
```

---

## 3. DEPLOYMENT PROCEDURES BY PLATFORM

### Procedure A: Docker Compose Deployment (Self-Hosted / VPS / Staging VM)

```bash
# Step 1: Pull latest repository code
git checkout staging
git pull origin staging

# Step 2: Build container image with non-root security
docker compose -f docker-compose.staging.yml build

# Step 3: Launch staging services in background
docker compose -f docker-compose.staging.yml up -d

# Step 4: Monitor entrypoint migration logs
docker compose -f docker-compose.staging.yml logs -f staging-app

# Step 5: Verify readiness
curl -f http://localhost:3001/ready || {
  echo "Deployment failed readiness probe!"
  exit 1
}

echo "Staging deployment successful."
```

### Procedure B: Cloud PaaS Deployment (Render / Railway / Fly.io / Neon)

1. **Database:**
   - Provision a PostgreSQL branch (e.g. Neon branch `staging` off root).
   - Set `DATABASE_URL` in environment secrets.
2. **Build & Release Phase:**
   - Build Command: `npm ci --omit=dev`
   - Pre-Deploy / Release Command: `npm run db:migrate`
3. **Start Command:**
   - `node src/server.js`
4. **Health Probe:**
   - Configure HTTP healthcheck path to `/ready`.
   - Timeout: 5s, Interval: 15s.

---

## 4. POST-DEPLOYMENT VERIFICATION STEPS

1. **Probe Health & Readiness:**
   ```bash
   curl -i https://<staging-domain>/ready
   # Expected: HTTP 200 OK with {"ready":true,"database":"connected"}
   ```
2. **Test Staging Playground:**
   - Navigate to `https://<staging-domain>/staging`.
   - Verify banner states `STAGING ENVIRONMENT — NOT FOR PRODUCTION USE`.
   - Click **Mount Chat Widget** and send a test message as `customer_demo_001`.
   - Confirm support agent reply is received with latency < 500ms.
3. **Verify Isolated Staging Memory:**
   - In staging playground, click **Inspect Staging Memory** for `customer_returning_001`.
   - Confirm returned facts are scoped to staging without production cross-contamination.
