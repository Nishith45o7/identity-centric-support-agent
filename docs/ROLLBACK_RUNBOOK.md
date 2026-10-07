# CONTEXTIS — ROLLBACK RUNBOOK

**Document ID:** RRB-2026-PHASE-15  
**Version:** 1.0.0  
**Scope:** Disaster Recovery, Incident Response & Rollback Procedures

---

## 1. ROLLBACK TRIGGERS

Initiate immediate rollback if any of the following occur post-deployment:
1. `GET /ready` returns HTTP 503 or fails to respond for > 60 seconds.
2. Error rate on `/v1/support/chat` or `/widget/config` exceeds 1.0% in 5 minutes.
3. Database migration failure causes transaction abort.
4. Security boundary breach or cross-tenant data leakage detected.
5. Inadvertent cross-environment contamination between staging and production.

---

## 2. ROLLBACK PROCEDURES

### Procedure 1: Application Container Rollback (Docker / Compose)

```bash
# 1. Identify previous working image tag or git commit
PREVIOUS_COMMIT=$(git rev-parse HEAD~1)
echo "Rolling back to previous commit: $PREVIOUS_COMMIT"

# 2. Checkout previous working release
git checkout $PREVIOUS_COMMIT

# 3. Rebuild and restart containers
docker compose -f docker-compose.staging.yml up -d --build

# 4. Verify system restored to healthy state
curl -s http://localhost:3001/ready | grep '"ready":true'
```

### Procedure 2: Database Migration Recovery & Rollback

All migrations (`001` through `008`) in `src/db/migrations/` are non-destructive and backward-compatible (adding columns, tables, or indices with `IF NOT EXISTS`).

If an emergency schema rollback is required:
1. **Schema Check:** Inspect applied versions:
   ```sql
   SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC;
   ```
2. **Neon Database Point-in-Time Restore (Recommended for Cloud):**
   - In Neon console or CLI: Reset staging branch from parent or restore branch state prior to deployment timestamp:
     ```bash
     neon branches restore <staging_branch_id> --to-timestamp <pre_deploy_iso_timestamp>
     ```
3. **Manual Table Removal (if isolated new migration):**
   - Connect to staging database:
     ```bash
     psql $DATABASE_URL
     ```
   - Drop the newly created staging table (e.g., `DROP TABLE IF EXISTS <new_table>;`).
   - Remove the migration version entry:
     ```sql
     DELETE FROM schema_migrations WHERE version = '<failed_migration_filename>';
     ```

### Procedure 3: Broken Environment / Secret Configuration

If incorrect environment variables were injected:
1. Immediately restore the previous environment configuration in the hosting dashboard.
2. Restart the process gracefully:
   ```bash
   docker compose -f docker-compose.staging.yml restart staging-app
   ```
3. Probe `/health` and `/ready` to confirm recovery.

### Procedure 4: External Provider Outage (Groq / Hindsight)

If remote Groq AI or Hindsight vector memory suffers an outage:
1. **Zero Downtime Local Fallback:** Contextis automatically falls back to deterministic local troubleshooting and in-memory fact banks.
2. **Force Local Fallback Mode:**
   - Set `MEMORY_MODE=off` (or remove `GROQ_API_KEY` temporarily).
   - Application continues serving customers with instant deterministic guidance without downtime.
