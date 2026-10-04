# Design Notes

## UX goals
- Simple developer dashboard for workspaces, projects, and keys
- Lightweight embedded support widget for customer-facing support
- Clear usage and plan visibility for teams

## API design
The platform separates developer workflows and customer support workflows using different access methods:

- Developer session: workspace dashboard and admin actions
- Project API key: support traffic and project-scoped system access

## Data protection
- Sensitive values are filtered before storage
- Memory and support data remain scoped to individual users/projects
- Workspace operations are protected by membership checks and role validation

## Operational philosophy
- Fail fast in production if required config is missing
- Keep runtime logs structured and request-scoped
- Allow safe retries on port conflicts for local development
