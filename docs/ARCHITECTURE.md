# Architecture

## System overview
The application is a Node.js Express service that combines:

- developer workspace management
- project-scoped support APIs
- a support agent layer with memory
- embeddable frontend surfaces
- billing / usage / audit metadata

## Components
### API layer
- Express server with versioned routes under `/v1`
- Support routes under `/api` and `/v1/support`
- Public docs and widget endpoints

### Auth and ownership model
- Developer session cookies for workspace access
- Project API keys for customer support access
- Organization membership checks guard access to workspace resources

### Data model
- Users
- Organizations
- Organization members
- Projects
- Customers
- Conversations
- Usage records
- Audit logs
- Billing invoices
- Billing events

### Memory and support engine
- Support requests flow through a support agent service
- Memory is stored per user / project context and sanitized before retention
- Hindsight is used when configured, otherwise a local fallback is used

## Deployment assumptions
- Local development can run with SQLite.
- Production-ready environments should use PostgreSQL and a secure runtime config.
- Secrets are kept server-side and validated before startup in production.

## Security boundaries
- project-level isolation
- workspace member authorization
- origin validation
- API key hashing and revocation
- audit logging for operational actions
