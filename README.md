# Contextis

> **AI support that remembers every customer.**

Contextis is an enterprise-grade AI customer-support infrastructure SaaS platform. It allows businesses and developers to integrate an identity-aware, memory-persistent support agent into their applications using a high-throughput REST API or a drop-in embeddable chat widget.

---

## 1. Platform Architecture

```text
                         CONTEXTIS
                            │
              ┌─────────────┴─────────────┐
              │                           │
          REST API                   CHAT WIDGET
              │                           │
              └─────────────┬─────────────┘
                            ▼
                    CONTEXTIS ENGINE
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
        Identity         Hindsight         Groq
        Context           Memory          Inference
            │               │               │
            └───────────────┼───────────────┘
                            ▼
                     AGENT ORCHESTRATOR
                            │
                            ▼
                       TOOL ROUTER
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
        Customer API    Order API       Auth API
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    CUSTOMER'S SOFTWARE
```

---

## 2. Three Types of Users

1. **Contextis Platform Admin (SaaS Owner)**
   - Global multi-tenant visibility across all customer organizations, projects, and users.
   - Live health checks across APIs, PostgreSQL / SQLite databases, Hindsight memory banks, and Groq inference models.
   - Subscription distribution, quota enforcement, tenant suspension/reactivation, and cross-platform audit logging.

2. **Contextis Business / Developer Customer (e.g. Acme Store)**
   - Creates projects and manages separate `live` and `test` environments.
   - Generates and rotates API keys (`sk_live_...` for backends, `pk_live_...` for widgets).
   - Customizes the embeddable chat widget (agent name, themes, accents, greeting messages).
   - Inspects customer conversation transcripts, memory facts, tool executions, and usage records.

3. **End Customer (e.g. Alice)**
   - Interacts with support via the chat widget on the business's website or mobile app.
   - Identified by compound key `(organization_id, project_id, external_user_id)`.
   - Never needs a Contextis account; their context and memory persist seamlessly across visits.

---

## 3. Core Principles

- **Memory is Context, NOT Authentication:** The agent recalls past issues, orders, and customer preferences, but remembered facts never grant cryptographic privileges or bypass login.
- **Never Ask for Passwords:** For sensitive flows like password resets, the agent invokes authorized backend authentication endpoints (`send_password_reset`) that dispatch verified emails or OTPs directly from the customer's own identity provider.
- **Strict Server-Side Isolation:** Tenant IDs and project boundaries are always validated cryptographically on the server. Client-provided tenant headers are never blindly trusted.

---

## 4. Key Capabilities

- **Multi-Tenant PostgreSQL Architecture:** Complete relational schema with automated migrations supporting organizations, projects, API keys, conversations, messages, widget settings, usage records, tools, and audit logs (with SQLite fallback for local development).
- **Public & Secret Key Separation:**
  - `pk_live_...` / `pk_test_...`: Public browser-safe keys restricted to chat widget endpoints.
  - `sk_live_...` / `sk_test_...`: Secure hashed server keys for administrative and backend API access.
- **Shadow DOM Chat Widget:** Zero CSS leakage, responsive mobile floating launcher, customizable branding, typing indicators, and markdown formatting.
- **Business Action & Tool Router:** Declarative tool definitions with strict permission tiers (`READ`, `WRITE`, `SENSITIVE`, `ADMIN`) and input validation.
- **Platform & Developer Consoles:** Minimal, premium glassmorphism dashboards with high information density, responsive tables, real-time charts, and audit stream inspection.

---

## 5. Quick Start

### Prerequisites
- Node.js >= 18
- npm >= 9

### Installation

```bash
# Clone the repository
git clone https://github.com/Nishith45o7/identity-centric-support-agent.git
cd identity-centric-support-agent

# Install dependencies
npm install

# Run database migrations & config check
npm run validate:config

# Execute test suite
npm test

# Start the development server
npm run dev
```

Visit the platform locally at:
- **Landing Page:** `http://localhost:3000`
- **Developer Console:** `http://localhost:3000/dashboard`
- **Platform Admin Control Plane:** `http://localhost:3000/admin`
- **Chat Widget Playground:** `http://localhost:3000/widget`
- **Developer Documentation:** `http://localhost:3000/docs`

---

## 6. Environment Variables

Create a `.env` file based on `.env.example`:

```bash
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000

# Database (PostgreSQL / Neon; defaults to local SQLite if unset)
DATABASE_URL=

# AI & Memory Providers
GROQ_API_KEY=
HINDSIGHT_API_KEY=
HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io
MEMORY_MODE=on

# Cryptographic Salt / Pepper
API_KEY_PEPPER=your-secure-pepper-for-key-hashing
SESSION_SECRET=your-session-secret

# Billing & Support Secrets
SUPPORT_API_KEY=
BILLING_WEBHOOK_SECRET=
```

---

---

## 7. REST API Reference

All requests must include a valid Contextis Secret Key (`sk_live_...` or `sk_test_...`):

```bash
Authorization: Bearer sk_live_...
```

Every response returns an `X-Request-ID` header matching the payload `request_id`.

### Core Chat Endpoint
`POST /v1/support/chat`

Request:
```json
{
  "user_id": "cust_10482",
  "message": "Where is my shipment?",
  "conversation_id": "conv_948210",
  "metadata": {
    "source": "website",
    "language": "en"
  }
}
```

Response:
```json
{
  "request_id": "req_1728148920_abc123",
  "conversation_id": "conv_948210",
  "user_id": "cust_10482",
  "response": "I remember that you ordered the Ergonomic Chair yesterday. Tracking shows it is currently in transit with FedEx Express.",
  "memory_used": true
}
```

### End Conversation & Retain Memory
`POST /v1/support/end`

Request:
```json
{
  "user_id": "cust_10482",
  "messages": [
    "I'm on macOS Sonoma and using the Safari browser."
  ]
}
```

Response:
```json
{
  "request_id": "req_1728148920_def456",
  "user_id": "cust_10482",
  "factsStored": 1,
  "retainedFacts": [
    {
      "category": "platform",
      "fact": "macOS Sonoma, Safari"
    }
  ]
}
```

### Query Customer Memory
`GET /v1/support/memory/:userId`

Response:
```json
{
  "request_id": "req_1728148920_ghi789",
  "user_id": "cust_10482",
  "memory": [
    {
      "category": "platform",
      "fact": "macOS Sonoma, Safari"
    }
  ]
}
```

---

## 8. Embeddable Widget Snippet

Add this script tag right before the closing `</body>` tag on any page:

```html
<script
  src="https://cdn.contextis.io/widget.js"
  data-project-id="your_project_id"
  data-public-key="pk_live_your_public_key"
  data-user-id="optional_logged_in_user_id"
  data-user-name="optional_customer_name"
  defer>
</script>
```

---

## 9. Phase 9–12 Product Capabilities

### 9.1 Public Onboarding & Dynamic Pricing
- `GET /v1/public/plans`: Data-driven public subscription plans and feature limits.
- `GET /v1/onboarding`: Live SaaS onboarding wizard progress tracking.

### 9.2 Conversation Experience Engine & Widget 2.0
- `POST /v1/support/opening`: Evaluates IANA timezone, time-of-day period, returning customer status, unresolved friction points, and generates contextual greetings and active tool suggestion chips.
- `POST /v1/support/feedback`: Records positive/negative feedback with reason categories (`Did not solve my issue`, `Too complicated`).
- `POST /v1/support/escalate`: Packages conversation transcript, durable customer memory, and attempted actions into a structured human agent dossier.

### 9.3 Developer Experience & Interactive Console
- Multi-language code snippets for **cURL**, **JavaScript (Browser)**, **Node.js**, and **Python**.
- Live Interactive API Console built into `/docs` for test request dispatching with real-time latency measurement and response inspection.

### 9.4 Growth, Analytics & Outbound Webhooks
- `GET /v1/projects/:projectId/analytics`: Real database-backed metrics for conversations, satisfaction rate, AI resolution rate, latency, and tool executions.
- `GET /v1/projects/:projectId/escalations`: Escalation ticket review and assignment queue.
- `POST /v1/projects/:projectId/webhooks`: Configures HTTPS endpoints receiving signed `X-Contextis-Signature` HMAC-SHA256 event notifications.

---

## 10. Testing & Quality Assurance

Run the test suite:

```bash
npm test -- --runInBand
```

The test suite covers:
- User signup, login, session validation, and onboarding wizard progress.
- Multi-tenant organization isolation and project boundaries.
- Public (`pk_`) and Secret (`sk_`) key issuance, validation, and permission sandboxing.
- Time-aware salutations, customer memory personalization, and unresolved issue prioritization.
- Developer documentation, OpenAPI 3.0 spec validation, and multi-language key transports.
- Outbound signed webhooks (HMAC-SHA256) and time-series analytics aggregation.
- Human escalation ticket creation, context dossier generation, and status lifecycles.
- GDPR customer memory inspection and permanent deletion.
- Groq AI inference orchestration, Hindsight memory recall, and tool router dispatch.
- Rate limiting, subscription plan enforcement, and security defenses.

---

## 11. License

Proprietary — Contextis Platform Inc. All rights reserved.
