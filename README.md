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
<div align="center">

<img src="./assets/banner.svg" alt="Identity-Centric Support Platform" width="100%" />

<br/><br/>

<img src="./assets/badges.svg" alt="Node.js · Express · PostgreSQL · SQLite · Groq · MIT" />

<br/><br/>

**A production-oriented, multi-tenant AI customer support platform for developers and support teams.**<br/>
Identity-first by design: every request resolves to an organization, a project, and a user.

[Overview](#1-overview) · [Features](#2-features) · [Architecture](#3-architecture) · [Setup](#6-setup) · [Security](#9-security) · [Status](#11-project-status)

</div>

<img src="./assets/divider.svg" width="100%" alt="" />

## 1. Overview

**Identity-Centric Support Platform** lets developers sign up, create workspaces and projects, issue project-scoped API keys, and embed an AI support widget in their own products — while each end-user's conversation memory stays isolated by **user and project**.

### Why this exists

Most AI support tools treat every conversation as anonymous and every tenant as one shared pool. In B2B SaaS that breaks down fast:

- **Context bleeds** between customers, projects, and organizations.
- **Access control** gets bolted on after the fact.
- **Billing and usage** are disconnected from who actually consumed what.

This platform inverts that: **identity comes first**, and memory, usage, billing, and audit trails all follow it.

### How it works

<img src="./assets/flow.svg" width="100%" alt="Developer → Org & Project → API Key → Widget → Support API → Memory + LLM, feeding usage, billing, audit and isolation" />

1. A developer creates an **organization → project** and generates a **project-scoped API key**.
2. The **widget** (or any HTTP client) sends chat requests with that key.
3. The API validates the key, origin, and rate limit, then resolves the end-user identity.
4. Memory is recalled and retained **only within the user + project boundary**.
5. The LLM responds, usage is metered against the org's plan, and sensitive actions are audit-logged.

<img src="./assets/divider.svg" width="100%" alt="" />

## 2. Features

<img src="./assets/features.svg" width="100%" alt="Key features: developer auth, workspaces and orgs, projects and API keys, support chat, memory isolation, billing and usage, widget and dashboard, Postgres plus SQLite" />

<details>
<summary><b>Text version</b></summary>

| Area | Capabilities |
| --- | --- |
| **Developer auth** | Signup and login for developers |
| **Workspaces & orgs** | Organization management, members, role-based access control |
| **Projects** | Multiple support projects per organization |
| **API keys** | Project-scoped, hashed with a server-side pepper, revocable |
| **Support chat** | Customer-facing chat endpoints backed by an LLM |
| **Memory isolation** | Memory partitioned per user + project |
| **Billing** | Org plans, invoices, usage summaries |
| **UI** | Embeddable widget and developer dashboard |
| **Database** | PostgreSQL-ready migrations with SQLite fallback |

</details>

<img src="./assets/divider.svg" width="100%" alt="" />

## 3. Architecture

```mermaid
flowchart LR
    subgraph Client
      W[Embedded Widget]
      D[Developer Dashboard]
    end
    subgraph API["Express API"]
      MW[Auth · API Key · Origin · Rate Limit]
      R[Routes]
      S[Services]
    end
    subgraph Data
      DB[(PostgreSQL / SQLite)]
      M[(Memory Store)]
    end
    L[LLM Provider]
    W --> MW
    D --> MW
    MW --> R --> S
    S --> DB
    S --> M
    S --> L
```

**Design principles**

- **Identity-first:** every request resolves to org, project, and user before any data access.
- **Layered:** routes → services → data access, with middleware enforcing cross-cutting security.
- **Portable storage:** the same migrations target PostgreSQL in production and SQLite locally.
- **Fail-closed in production:** missing or weak configuration stops the app from starting.

<img src="./assets/isolation.svg" width="100%" alt="Memory vaults per org, project and user, separated by blocked cross-boundary access" />

<img src="./assets/divider.svg" width="100%" alt="" />

## 4. Tech stack

- **Runtime:** Node.js, Express
- **Database:** PostgreSQL (production), SQLite (local fallback)
- **AI inference:** Groq
- **Memory:** Hindsight-backed memory with a configurable mode
- **Frontend:** Embeddable widget + developer dashboard
- **Tooling:** Migrations, config validation script, automated tests

## 5. Project structure

> Adjust paths to match your repository layout.

```text
.
├── assets/                   # README graphics
├── src/
│   ├── app.js                # Express app setup
│   ├── server.js             # Entry point
│   ├── config/               # Env loading + production validation
│   ├── db/                   # Connection layer + migrations
│   ├── middleware/           # Auth, RBAC, API key, origin, rate limit
│   ├── routes/               # Auth, orgs, projects, keys, chat, billing
│   ├── services/             # Memory, usage, billing, audit
│   └── utils/
├── public/
│   ├── widget/               # Embeddable support widget
│   └── dashboard/            # Developer dashboard UI
├── scripts/validate-config.js
├── tests/
├── .env.example
└── package.json
```

<img src="./assets/divider.svg" width="100%" alt="" />

## 6. Setup

**Prerequisites:** Node.js 18+ and npm. PostgreSQL is optional locally — SQLite is used when `DATABASE_URL` is unset.

```bash
git clone https://github.com/your-org/identity-centric-support-platform.git
cd identity-centric-support-platform

npm install                 # install dependencies
cp .env.example .env        # configure environment
npm run validate:config     # verify configuration
npm test                    # run the test suite
npm run dev                 # start the dev server
```

The API is available at `http://localhost:3000` by default.

## 7. Environment variables

```env
# Server
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

# Database (leave empty for SQLite fallback)
DATABASE_URL=postgres://user:password@localhost:5432/support_platform

# Security
SUPPORT_API_KEY=replace-with-a-long-random-value
BILLING_WEBHOOK_SECRET=replace-with-a-long-random-value
API_KEY_PEPPER=replace-with-a-long-random-value

# AI provider
GROQ_API_KEY=your-groq-api-key

# Memory
HINDSIGHT_API_KEY=your-hindsight-api-key
HINDSIGHT_BASE_URL=https://your-hindsight-instance.example.com
MEMORY_MODE=hindsight
```

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port |
| `NODE_ENV` | `development`, `test`, or `production` (strict validation in production) |
| `CORS_ORIGIN` | Allowed origin(s) for browser and widget traffic |
| `DATABASE_URL` | PostgreSQL connection string; SQLite when unset |
| `SUPPORT_API_KEY` | Platform-level key for internal/service access |
| `BILLING_WEBHOOK_SECRET` | Verifies inbound billing webhook requests |
| `API_KEY_PEPPER` | Server-side secret mixed into API key hashing |
| `GROQ_API_KEY` | LLM provider credentials |
| `HINDSIGHT_API_KEY` / `HINDSIGHT_BASE_URL` | Memory service credentials and endpoint |
| `MEMORY_MODE` | Memory backend mode |

> **Never commit `.env`.** Inject secrets via your platform's secret manager in production.

<img src="./assets/divider.svg" width="100%" alt="" />

## 8. Usage

> Endpoint paths are illustrative of the route groups — align them with your implemented routes.

```bash
# Register a developer
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"a-strong-password"}'

# Create a project
curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer <developer-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Support","organizationId":"<org-id>"}'

# Issue a project-scoped API key (shown once — stored only as a hash)
curl -X POST http://localhost:3000/api/projects/<project-id>/keys \
  -H "Authorization: Bearer <developer-token>"

# Send a customer support message
curl -X POST http://localhost:3000/api/support/chat \
  -H "x-api-key: <project-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"customer-42","message":"How do I reset my password?"}'

# Revoke a key
curl -X DELETE http://localhost:3000/api/projects/<project-id>/keys/<key-id> \
  -H "Authorization: Bearer <developer-token>"
```

**Embed the widget**

```html
<script
  src="https://your-domain.com/widget/widget.js"
  data-api-key="<project-api-key>"
  data-user-id="customer-42"
  async
></script>
```

<img src="./assets/divider.svg" width="100%" alt="" />

## 9. Security

<img src="./assets/security.svg" width="100%" alt="Requests pass origin validation, rate limiting, API key hash check, RBAC and audit logging; invalid requests are rejected" />

- **Config validation:** required environment variables are verified at startup in production; the app refuses to boot with missing or placeholder secrets.
- **API key hashing & revocation:** keys are hashed with a server-side pepper, never stored in plaintext, and revocable instantly.
- **Role-based access control:** organization membership and roles gate every management action.
- **Origin validation:** widget and browser traffic is restricted to approved origins.
- **Rate limiting:** per-key and per-client limits protect the API and your LLM budget.
- **Tenant & memory isolation:** data access is always scoped by organization, project, and user.
- **Audit logging:** sensitive actions (key creation/revocation, membership changes, billing events) are recorded.

Found a vulnerability? Please report it privately to the maintainers instead of opening a public issue.

## 10. Testing

```bash
npm run validate:config   # verify environment configuration
npm test                  # run the automated test suite
```

Run both before every deploy and wire them into CI to block releases on failure.

<img src="./assets/divider.svg" width="100%" alt="" />

## 11. Project status

This repository is a **production-oriented foundation**: authentication, tenancy, API key management, memory isolation, usage metering, billing records, audit logging, and the widget/dashboard are implemented.

> **Payment provider integration is intentionally deferred.** Plans, invoices, and usage summaries are implemented at the data and API level, but **no real payment processor is integrated** in this implementation.

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
## 12. License

Released under the [MIT License](./LICENSE).

<br/>

<img src="./assets/footer.svg" width="100%" alt="Identity first. Isolation by default. Support that scales with your customers." />
