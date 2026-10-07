# CONTEXTIS — BUSINESS TOOLS & INTEGRATIONS

**Version:** 1.0.0  
**Scope:** Tool Router, Permission Scopes, Sensitivities & Security Policies

---

## 1. ARCHITECTURAL OVERVIEW

Contextis connects AI support conversations directly to live business actions using a secured, deterministic tool router. The AI cannot execute arbitrary SQL queries, shell commands, or unvetted network requests.

```text
               CUSTOMER CONVERSATION
                        │
                        ▼
                AGENT ORCHESTRATOR
                        │
                        ▼
                   TOOL ROUTER
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
     Tenant          Project        Permission
  Verification    Verification        Check
        │               │               │
        └───────────────┼───────────────┘
                        ▼
                 JSON Schema &
               Policy Validation
                        │
                        ▼
              BUSINESS SIMULATOR / API
                        │
                        ▼
               STRUCTURED RESULT &
                 AUDIT LOG ENTRY
```

---

## 2. TOOL SENSITIVITIES & PERMISSIONS

Each project tool is classified with a sensitivity tier:
- **`READ`:** Read-only data queries (e.g., `track_order`, `get_balance`). Safe for automated execution.
- **`WRITE`:** State-modifying actions (e.g., `create_ticket`, `update_shipping_address`). Requires explicit project tool permissions.
- **`SENSITIVE`:** High-impact business workflows (e.g., `cancel_order`, `process_refund`, `send_password_reset`). Requires elevated permissions and audit trail logging.

---

## 3. BUILT-IN STANDARD TOOL TEMPLATES

| Tool Name | Sensitivity | Required Permissions | Description |
| :--- | :---: | :--- | :--- |
| `get_order` | `READ` | `orders:read` | Retrieve order status, shipment tracking, and line items. |
| `track_order` | `READ` | `orders:read`, `tracking:read` | Track real-time shipment status and carrier estimation. |
| `cancel_order` | `SENSITIVE` | `orders:write`, `refunds:process` | Cancel order line items and issue refund ledger entry. |
| `create_ticket` | `WRITE` | `tickets:create` | Escalate an unresolved issue to the internal ticketing queue. |
| `send_password_reset`| `SENSITIVE` | `auth:reset` | Dispatch verification reset link/OTP to customer email. |

---

## 4. TOOL SECURITY GUARDRAILS

1. **Secret API Key Required:** Direct tool execution (`POST /v1/projects/:projectId/tools/:toolId/execute`) strictly requires a secret key (`sk_*`). Public keys (`pk_*`) are rejected with HTTP 403 `FORBIDDEN`.
2. **Schema Enforcement:** Tool arguments must strictly match the tool's configured `inputSchema`. Missing required fields or incorrect property types are rejected with HTTP 400 `INVALID_REQUEST`.
3. **Credential & Password Rejection:** Any tool request payload containing `password`, `new_password`, `secret`, or `auth_token` is immediately halted with HTTP 400 `SECURITY_VIOLATION`.
4. **Audit Trail:** Every tool execution records an audit log entry in the `audit_logs` table including `project_id`, `actor_user_id`, `tool_id`, and `created_at`.
