# Contextis — Production Engineering & Operator Manual

> **AI support that remembers every customer.**

---

## 1. Getting Started

### Prerequisites
- Node.js >= 20.0.0
- SQLite (built-in via Node `DatabaseSync`) or PostgreSQL (Neon / Lakebase)
- Optional: Groq API Key (for Llama 3.3 LLM inference)
- Optional: Hindsight Cloud API Key (for persistent semantic vector memory)

### Quickstart
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Initialize environment configuration:
   ```bash
   cp .env.example .env
   ```
3. Run automated test suite:
   ```bash
   npm test
   ```
4. Start the service:
   ```bash
   npm start
   # Server listens on http://localhost:3000
   ```

---

## 2. Architecture & Design Principles

```text
                         ┌───────────────────────┐
                         │       CONTEXTIS       │
                         │      PLATFORM         │
                         └───────────┬───────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                │                    │                    │
                ▼                    ▼                    ▼
          Developer UI          Admin Panel          Documentation
          (/developer)            (/admin)              (/docs)
                │                    │
                ▼                    ▼
             Projects            Organizations
                │                    │
          ┌─────┴─────┐              │
          ▼           ▼              ▼
       API Keys     Widget        Subscriptions
          │           │              │
          └─────┬─────┘              │
                ▼                    ▼
             REST API          Usage / Quotas
          (/v1/support)         (/v1/billing)
                │
                ▼
        ┌──────────────────┐
        │ Contextis Engine │
        └────────┬─────────┘
                 │
       ┌─────────┼──────────┐
       ▼         ▼          ▼
   Identity   Memory      AI
              Hindsight   Groq
       │         │          │
       └─────────┼──────────┘
                 ▼
          Agent Orchestrator
                 │
                 ▼
            Tool Router
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
     Orders   Support    Auth
      API       API       API
```

---

## 3. Authentication & Authorization

### Developer Session Authentication
- **Mechanism**: HttpOnly, SameSite=Strict secure session cookie (`contextis_session`).
- **CSRF Protection**: Origin header validation via `requireSameOrigin` middleware.
- **Roles**:
  - `owner`: Full administrative authority over organization, members, projects, billing.
  - `admin`: Project creation, API key rotation, tool configuration.
  - `member`: Operational usage.
  - `viewer`: Read-only access; restricted from key creation or mutation.

### Platform Administration Control Plane
- **Routes**: `/v1/admin/*`
- **Security**: Explicit server-side verification against configured `PLATFORM_ADMIN_EMAILS` and session authentication. Frontend state flags are strictly disregarded.

---

## 4. API Key Lifecycle Management

Contextis enforces strict cryptographic separation:
- **Prefixes**:
  - `sk_live_...`: Secret Live Key (backend server-to-server operations)
  - `sk_test_...`: Secret Test Key (sandbox/testing)
  - `pk_live_...`: Public Live Key (browser chat widget)
  - `pk_test_...`: Public Test Key (widget staging)
- **Hashing**: Keys are hashed with SHA-256 HMAC and peppered with `API_KEY_PEPPER` before storage. Raw secrets are shown exactly once at creation and never stored.
- **Rotation**: `POST /v1/projects/:projectId/api-keys/:keyId/rotate` immediately revokes the prior key and issues a drop-in replacement with identical scopes.
- **Revocation**: Instant revocation supported via developer dashboard and platform admin.

---

## 5. Support REST API

### Endpoints
- `POST /v1/support/chat` — Core support interaction engine
- `POST /v1/support/end` — Session termination and durable fact extraction
- `GET /v1/support/memory/:userId` — Customer memory inspection (Secret key only)
- `DELETE /v1/support/memory/:userId` — Customer memory purge (Secret key only)

### Request Example (`/v1/support/chat`)
```bash
curl -X POST https://api.contextis.com/v1/support/chat \
  -H "Authorization: Bearer sk_live_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "cust_10492",
    "message": "My MacBook Pro display is not turning on when docked."
  }'
```

### Response Example
```json
{
  "request_id": "req_88f9124a919241ba8a0a9ef8120b6ca9",
  "conversation_id": "conv_a49817bf",
  "user_id": "cust_10492",
  "response": "I see you are using a MacBook Pro. Let's troubleshoot the Thunderbolt dock connection...",
  "memory_used": true
}
```

---

## 6. Embeddable Chat Widget

### Embedding Snippet
```html
<script
  src="https://cdn.contextis.com/widget.js"
  data-project-id="proj_3810f92b"
  data-public-key="pk_live_abc123..."
  data-user-id="cust_optional_external_id">
</script>
```

### Security Boundary
- Public keys (`pk_*`) are restricted to `support:write` and `widget:load`.
- Public keys **cannot** read memory dumps, delete customer data, or manage tools (enforced with `403 FORBIDDEN`).
- Iframe and isolated DOM shadow prevents host application CSS leakage.

---

## 7. Customer Intelligence & Memory

### Memory Flow
```text
Customer Input
     ↓
Sanitization & Redaction (Passkeys, Tokens, Credit Cards Redacted)
     ↓
Hindsight Memory Bank Recall (Namespaced: ctx_{org}_{proj}_{env}_{sha256(userId)})
     ↓
Reasoning with AI Orchestrator (Groq Llama 3.3)
     ↓
Response Formulation
     ↓
Extract Durable Facts
     ↓
Retain in Memory Bank
```

### GDPR / Privacy Controls
- `GET /v1/projects/:projectId/customers/:userId/export` — Full data export (conversations, messages, facts).
- `DELETE /v1/projects/:projectId/customers/:userId` — Cascading purge across customer records, conversation timeline, and Hindsight memory bank.
- `DELETE /v1/projects/:projectId/customers/:userId/memory/facts` — Targeted removal of individual facts.

---

## 8. Tools & Business Integrations

### Tool Registration
```json
{
  "name": "track_order",
  "description": "Fetches order tracking status",
  "sensitivity": "READ",
  "permissions": ["orders:read"],
  "inputSchema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string" }
    },
    "required": ["orderId"]
  }
}
```

### Tool Guardrails
- **Credential Protection**: Tools reject inputs containing `password`, `secret`, `token`, or `auth_token` with `400 SECURITY_VIOLATION`.
- **Permission Checking**: Calls require matching project scopes.
- **Audit Logging**: Every execution logs execution latency, actor, project, and tool metadata without leaking secrets.

---

## 9. Subscriptions, Usage & Quotas

### Plans
| Plan | Projects | API Keys | Monthly Requests | Rate Limit / Min |
|---|---|---|---|---|
| **Starter** | 2 | 5 | 1,000 | 60 |
| **Pro** | 10 | 25 | 25,000 | 300 |
| **Enterprise** | 100 | 100 | 500,000 | 1,200 |

### Webhook Event Processing (`POST /v1/billing/webhook`)
- `checkout.session.completed` -> Upgrades organization plan
- `invoice.payment_failed` -> Transitions billing status to `past_due`
- `customer.subscription.deleted` -> Cancels subscription and degrades to free tier

---

## 10. Security Audit Summary

- **IDOR Protection**: All resource queries verify tenant and project ownership.
- **Prompt Injection Defense**: System prompts enforce boundary separation; outputs pass through sensitive data filters.
- **Environment Isolation**: Live keys rejected in test environment; test keys rejected in live environment.
- **Tenant Isolation**: Memory banks are hashed and isolated; cross-organization access fails with `403 FORBIDDEN` or `404 NOT_FOUND`.

---

## 11. Production Deployment

### Recommended Topology
- **Compute**: Stateless Docker containers on AWS ECS, GCP Cloud Run, or Fly.io.
- **Database**: Neon Serverless PostgreSQL with connection pooling.
- **Environment Configuration**:
  ```env
  NODE_ENV=production
  PORT=3000
  DATABASE_URL=postgresql://user:pass@ep-cool-db.us-east-2.aws.neon.tech/contextis?sslmode=require
  API_KEY_PEPPER=<32-byte-hex-secret>
  SESSION_SECRET=<32-byte-hex-secret>
  BILLING_WEBHOOK_SECRET=<webhook-secret>
  SUPPORT_API_KEY=<fallback-master-key>
  GROQ_API_KEY=<groq-llama-key>
  HINDSIGHT_API_KEY=<hindsight-vector-key>
  PLATFORM_ADMIN_EMAILS=security@contextis.com,admin@contextis.com
  ```
