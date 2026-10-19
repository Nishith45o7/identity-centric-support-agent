# CONTEXTIS — SECURITY ARCHITECTURE & POLICIES

**Version:** 1.0.0  
**Scope:** Multi-Tenant Isolation, Cryptographic Storage, Threat Modeling & Defense-in-Depth

---

## 1. THREAT MODEL & DEFENSE-IN-DEPTH

Contextis enforces security across four distinct layers:

### Layer 1: Network & Origin Protection
- **Helmet Headers:** Sets strict HTTP headers including CSP on docs, disabling `X-Powered-By`.
- **Cross-Origin Resource Policy (CORP):** Set to `cross-origin` on public widget assets, enabling embedding while isolating authenticated endpoints.
- **CSRF & Origin Verification:** Sensitive workspace operations enforce `requireSameOrigin`, rejecting cross-site requests (`sec-fetch-site === 'cross-site'`) and verifying origin host matches.

### Layer 2: Multi-Tenant Cryptographic Isolation
- **Tenant Key Hierarchy:** `Organization` $\to$ `Project` $\to$ `Environment` $\to$ `Customer Identity`.
- **Hindsight Memory Isolation:** Bank IDs are cryptographically hashed using SHA-256 over `[organization_id, project_id, environment, user_id]`. Memory cannot leak across customers, projects, or tenants.
- **SQL / IDOR Protection:** All queries are parameterized (`?` or `$1`). Ownership is verified against the authenticated user/project on every read and write.

### Layer 3: API Key & Secret Management
- **Key Hashing:** Secret keys (`sk_*`) are hashed using HMAC-SHA256 with an environment-level pepper (`API_KEY_PEPPER`).
- **Zero Secret Exposure:** Secret keys are never returned in frontend HTML, client bundles, or log outputs.
- **Partitioned Public Keys:** Public keys (`pk_*`) are restricted to chat and widget initialization endpoints.

### Layer 4: AI & Tool Safety
- **No Direct Shell / SQL Access:** LLM inference models cannot execute arbitrary queries, system commands, or filesystem operations.
- **Zero Credential Policy:** Support engines never request or process customer passwords.
- **Rate Limiting & Abuse Prevention:** Sliding-window rate limiters protect support chat, authentication, and tool execution endpoints.

---

## 2. VULNERABILITY HANDLING & AUDIT COMPLIANCE

- All error outputs return structured JSON without stack traces or internal paths.
- Security audit logs record all administrative actions, key rotations, and revocations in `audit_logs`.
