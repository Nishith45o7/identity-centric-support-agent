# Memory and Project Notes

## Product memory
This implementation is intentionally built as a layered SaaS platform on top of a working support engine. The project preserves the original support flow while adding multi-tenant business controls.

## Engineering memory
- Do not remove the legacy support functionality.
- Extend by adding boundaries at the route, auth, and data access layers.
- Prefer regression testing before and after product additions.
- Keep migrations and runtime schema consistent.
- Keep support data isolated per project.

## Release memory
- Real payment integration is intentionally postponed until after deployment readiness is complete.
- Production secrets must be configured and validated before startup.
