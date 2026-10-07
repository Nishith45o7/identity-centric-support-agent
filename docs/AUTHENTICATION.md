# CONTEXTIS — AUTHENTICATION & ACCESS CONTROL

**Version:** 1.0.0  
**Scope:** Developer Sessions, API Keys, Permissions & Security Guardrails

---

## 1. DEVELOPER AUTHENTICATION & SESSIONS

Developers and platform admins access the Contextis dashboard via session-based authentication:
- **Signup / Login:** `POST /v1/auth/signup`, `POST /v1/auth/login`.
- **Password Hashing:** Passwords are salted using 16 cryptographically random bytes and hashed using `scrypt` (`crypto.scryptSync(password, salt, 64)`). Plaintext passwords are never stored.
- **Session Tokens:** 256-bit random tokens (`crypto.randomBytes(32).toString('hex')`) with a 7-day time-to-live stored in the database.
- **Cookie Security:** Cookies are transmitted with `HttpOnly`, `SameSite=Lax`, and `Path=/`.
- **CSRF & Origin Enforcement:** All state-changing routes enforce `requireSameOrigin`, rejecting cross-site requests (`sec-fetch-site === 'cross-site'`) and verifying origin headers against `config.corsOrigins`.

---

## 2. API KEY ARCHITECTURE

Contextis implements a partitioned dual-key lifecycle model:

```text
                  API KEYS
                     │
         ┌───────────┴───────────┐
         │                       │
    PUBLIC KEYS             SECRET KEYS
(pk_test_* / pk_live_*)  (sk_test_* / sk_live_*)
         │                       │
         ▼                       ▼
    Web Browsers            Backend Servers
    Chat Widget             Direct Tool Invocation
    Restricted Privileges   Customer Memory Management
```

### Key Storage & Hashing
- API keys are hashed upon creation using HMAC-SHA256 combined with a mandatory server-side pepper (`API_KEY_PEPPER`):
  ```javascript
  crypto.createHmac('sha256', config.apiKeyPepper).update(rawKey).digest('hex')
  ```
- The plaintext secret is displayed to the developer exactly once upon generation and is never returned in any subsequent API response or frontend bundle.
- Every API call records `last_used_at` asynchronously.

### Privilege Boundaries
| Endpoint / Capability | Public Key (`pk_*`) | Secret Key (`sk_*`) |
| :--- | :---: | :---: |
| Widget Configuration (`/widget/config`) | **ALLOWED** | **ALLOWED** |
| Chat Message (`/v1/support/chat`) | **ALLOWED** | **ALLOWED** |
| Dynamic Salutation (`/v1/support/opening`) | **ALLOWED** | **ALLOWED** |
| Feedback Submission (`/v1/support/feedback`) | **ALLOWED** | **ALLOWED** |
| Human Escalation (`/v1/support/escalate`) | **ALLOWED** | **ALLOWED** |
| Direct Tool Execution (`/tools/:id/execute`) | **BLOCKED (403)** | **ALLOWED** |
| Memory Snapshot (`/support/memory/:userId`) | **BLOCKED (403)** | **ALLOWED** |
| Memory Deletion (`DELETE /support/memory/:userId`) | **BLOCKED (403)** | **ALLOWED** |
| Customer Purge / GDPR Deletion | **BLOCKED (403)** | Session Only |

---

## 3. ZERO-PASSWORD SAFETY PRINCIPLE

Contextis strictly enforces that AI agents and tools **never act as password authorities**:
1. Support agents never ask customers for passwords, PINs, or raw API keys.
2. Tool execution requests containing `password`, `new_password`, `secret`, or `auth_token` in their input parameters are immediately rejected with HTTP 400 `SECURITY_VIOLATION`.
3. Password reset workflows (e.g. `send_password_reset` tool) dispatch out-of-band verification links/OTPs to the customer's verified email on record without handling credentials directly.
