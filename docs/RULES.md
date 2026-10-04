# Rules and Constraints

## Product rules
- Do not replace the working support engine while extending the SaaS layers.
- Preserve project-scoped customer isolation.
- All workspace operations must be tied to real membership and ownership.
- Billing status must not allow inactive workspaces to continue service access.

## Technical rules
- Use SQLite for local/test convenience and PostgreSQL-ready migrations for production.
- Keep secrets out of source control.
- Validate production env values before startup.
- Prefer minimal changes that preserve the verified platform baseline.
- Keep audit events for major operations such as plan changes, member adds/removals, and billing updates.
