# Identity-Centric Support Platform

A production-oriented, multi-tenant AI support SaaS for managing developer workspaces, projects, customer-facing support agents, team access, and billing-aware usage limits.

## What this platform includes

- Developer authentication and workspace membership management
- Multi-project support environments with customer isolation
- Project API keys with revocation and access control
- Project-scoped support chat endpoints and customer memory storage
- Embeddable support widget and dashboard UI
- Organization plan management, billing summaries, and invoice history
- Usage summaries and member/audit tracking for operational visibility
- PostgreSQL-ready schema with SQLite fallback for local and test environments

## Architecture

- Backend: Node.js + Express
- Database: SQLite for local/dev/tests, PostgreSQL-ready migrations for production
- Auth: developer session cookies and project-scoped API keys
- AI support flow: support agent service with Hindsight and Groq integration
- Frontend: dashboard and embeddable widget assets under the public folder
- Security: request validation, origin checks, rate limits, project isolation, audit logging

## Core product model

The system is organized around workspaces and projects:

- Developer user signs up and logs in
- User belongs to an organization/workspace
- Workspace contains members, projects, and billing metadata
- Each project owns customer data, support keys, and tool definitions
- Support requests are authenticated by project API keys, not just developer sessions

This keeps customer data isolated across projects while preserving a developer dashboard for operational control.

## Quick start

```bash
npm install
npm run validate:config
npm test
npm run dev
```

The app serves the dashboard and widgets locally on:

```text
http://localhost:3000
```

## Environment variables

```bash
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=
SUPPORT_API_KEY=
BILLING_WEBHOOK_SECRET=
API_KEY_PEPPER=
GROQ_API_KEY=
HINDSIGHT_API_KEY=
HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io
MEMORY_MODE=on
```

Production deployments must provide all required secrets before booting the service. Use:

```bash
npm run validate:config
```

Notes:
- When `DATABASE_URL` is unset, the app uses SQLite.
- When `GROQ_API_KEY` or `HINDSIGHT_API_KEY` is missing, the app falls back to local demo-safe behavior instead of failing the request lifecycle.
- Billing and workspace secrets are expected to stay server-side only.

## Developer and workspace APIs

### Auth

```bash
POST /v1/auth/signup
POST /v1/auth/login
POST /v1/auth/logout
GET /v1/auth/session
```

### Organization and teams

```bash
GET /v1/organization
GET /v1/organization/members
POST /v1/organization/members
DELETE /v1/organization/members/:userId
PATCH /v1/organization/members/:userId/role
GET /v1/organization/audit
POST /v1/organization/plan
GET /v1/organization/billing
GET /v1/organization/usage
GET /v1/organization/invoices
POST /v1/organization/invoices
GET /v1/organization/billing-events
POST /v1/organization/billing/webhook
```

### Projects

```bash
GET /v1/projects
POST /v1/projects
GET /v1/projects/:projectId
PATCH /v1/projects/:projectId
DELETE /v1/projects/:projectId
POST /v1/projects/:projectId/api-keys
GET /v1/projects/:projectId/api-keys
DELETE /v1/projects/:projectId/api-keys/:keyId
POST /v1/projects/:projectId/tools
GET /v1/projects/:projectId/tools
POST /v1/projects/:projectId/tools/:toolId/execute
```

### Support routes

```bash
POST /v1/support/chat
POST /v1/support/end
GET /v1/support/memory/:userId
DELETE /v1/support/memory/:userId
```

### Public endpoints

```bash
GET /api/health
GET /docs
GET /widget
GET /widget.js
```

## Example flow

1. Sign up as a developer and create a workspace.
2. Create a project for a product or customer cohort.
3. Generate a project API key for the support client or widget.
4. Send support requests through the support API using the project key.
5. Review workspace members, billing data, audit events, and usage summaries from the dashboard.
6. Update the plan or invoice state through the billing endpoints or webhook simulation.

## Security notes

- Project API keys are stored as hashes, never plain text.
- Customer memory is isolated by project and user context.
- Sensitive fields like tokens, passwords, and secrets are filtered before persistence.
- Workspace membership and project ownership checks are enforced on route access.
- Rate limiting and origin validation are enabled for public-facing endpoints.

## Testing

```bash
npm test -- --runInBand
```

The project includes integration tests covering signup, project creation, key revocation, support access, workspace management, billing, usage tracking, and multi-user memory isolation.

## Current status

The project is in a production-oriented SaaS state with the core operating layers in place:
- developer workspace auth
- project isolation
- billing and plan management
- member removal and access revocation
- invoice history and billing events
- usage reporting and operational audit logs

It remains suitable as a foundation for real payment-provider integration, broader production hardening, and operational deployment workflows.
