# CONTEXTIS — STAGING TEST PLAN

**Document ID:** STP-2026-PHASE-15  
**Version:** 1.0.0  
**Environment:** Staging  
**Purpose:** End-to-end verification of staging infrastructure, synthetic persona journeys, security boundaries, and telemetry.

---

## 1. TEST OBJECTIVES

1. Validate that the staging application starts cleanly and passes all health probes.
2. Confirm strict environment separation from production (database, memory banks, API keys, webhooks).
3. Exercise the full multi-tenant customer lifecycle using synthetic personas.
4. Verify safe tool execution, escalation dossier formatting, and analytics telemetry.

---

## 2. SYNTHETIC CUSTOMER PERSONAS

| Persona ID | Description | Role / Scenario |
| :--- | :--- | :--- |
| `customer_demo_001` | First-time visitor | Verifies cold opening context, time-of-day greeting, and empty initial memory state. |
| `customer_returning_001` | Returning customer | Tests multi-turn memory retention (`device: MacBook Pro`, `issue: login error`) across independent sessions. |
| `customer_tool_test_001` | Tool execution customer | Tests authorized read-only tool invocation (`track_order` on order `ORD-8492`) and verifies audit log entry. |
| `customer_handoff_001` | Escalation scenario | Tests intentional failure / locked account and validates human escalation dossier structure. |

---

## 3. ACCEPTANCE TEST SUITES

### Test Suite 1: Runtime Configuration & Secret Isolation
- **Test 1.1:** Attempt to start server in `NODE_ENV=staging` with default development `API_KEY_PEPPER`.  
  *Expected:* Server throws clear fatal error and exits.
- **Test 1.2:** Attempt to start server in `NODE_ENV=staging` with missing `SUPPORT_API_KEY` or `BILLING_WEBHOOK_SECRET`.  
  *Expected:* Server throws clear fatal error listing missing environment values.
- **Test 1.3:** Start with valid staging secrets.  
  *Expected:* `validateRuntimeConfig` passes cleanly.

### Test Suite 2: Health Probes & Connectivity
- **Test 2.1 (`GET /health`):** Returns 200 OK with `status: 'healthy'`, uptime, and configuration flags.
- **Test 2.2 (`GET /live`):** Returns 200 OK with `alive: true`.
- **Test 2.3 (`GET /ready`):** Queries database (`SELECT 1`). Returns 200 OK with `database: 'connected'`.
- **Test 2.4 (Simulated DB failure):** Returns 503 Service Unavailable with `database: 'disconnected'`.

### Test Suite 3: Hindsight Memory Namespace Scoping
- **Test 3.1:** Generate bank ID for customer in `environment: 'staging'`.  
  *Result:* Format `ctx_staging_<hash>`.
- **Test 3.2:** Generate bank ID for same customer in `environment: 'live'`.  
  *Result:* Format `ctx_live_<hash>`.
- **Test 3.3:** Compare bank IDs.  
  *Result:* Strictly unequal. Staging memory writes never collide with production.

### Test Suite 4: End-to-End Persona Verification
- **Test 4.1 (`customer_demo_001`):** Call `/v1/support/opening` $\to$ receives greeting and suggested actions without prior memories.
- **Test 4.2 (`customer_returning_001`):** Send chat stating device and issue $\to$ finalize session $\to$ send return chat $\to$ verify `memoryUsed: true` and recalled context present in reply.
- **Test 4.3 (`customer_tool_test_001`):** Call `POST /v1/projects/:projectId/tools/:toolId/execute` with order payload $\to$ returns shipping status and FedEx carrier summary.
- **Test 4.4 (`customer_handoff_001`):** Call `POST /v1/support/escalate` $\to$ returns escalation ID and complete `CONTEXTIS ESCALATION DOSSIER`.

### Test Suite 5: Webhook & Analytics Verification
- **Test 5.1:** Conversation created $\to$ verifies request counted in `/v1/projects/:projectId/analytics`.
- **Test 5.2:** Escalation generated $\to$ verifies webhook event `conversation.escalated` dispatched asynchronously with HMAC signature header.

---

## 4. EXECUTION MATRIX

```bash
# Execute Phase 15 automated test suite
npx jest tests/phase15-staging-deployment.test.js

# Execute full platform verification
npm test
```
All 189 tests across 16 test suites must pass 100% prior to staging sign-off.
