# CONTEXTIS — API REFERENCE

**Version:** 1.0.0  
**Base URL:** `https://api.contextis.com` (or `http://localhost:3000`)

---

## 1. AUTHENTICATION & HEADERS

All requests to the Contextis Support API must provide a project API key via the `Authorization` header or `x-api-key` header:

```http
Authorization: Bearer sk_live_...
# or
x-api-key: pk_live_...
```

- **Public Keys (`pk_test_*`, `pk_live_*`):** Permitted for browser/widget endpoints (`/v1/support/opening`, `/v1/support/chat`, `/v1/support/feedback`, `/v1/support/escalate`, `/widget/config`). Blocked from tool execution and administrative actions.
- **Secret Keys (`sk_test_*`, `sk_live_*`):** Permitted for backend server-to-server calls, direct tool executions, and customer memory lookups.

---

## 2. CORE SUPPORT ENDPOINTS

### 2.1 Send Support Chat Message

`POST /v1/support/chat`

Generates an identity-aware, memory-augmented reply for a customer.

**Request Body:**
```json
{
  "user_id": "customer_101",
  "message": "I am having trouble checking out on my MacBook Pro.",
  "conversation_id": "conv_optional_123",
  "environment": "live"
}
```

**Response (HTTP 200 OK):**
```json
{
  "request_id": "req_1791300226661_804fe1",
  "conversation_id": "conv_849201948201",
  "user_id": "customer_101",
  "reply": "I reviewed your context and I recall you are using a MacBook Pro...",
  "memory_used": true
}
```

---

### 2.2 Dynamic Opening Salutation

`POST /v1/support/opening`

Generates dynamic, time-aware greeting context based on visitor history, device, and page context.

**Request Body:**
```json
{
  "user_id": "customer_101",
  "timezone": "America/New_York",
  "page_context": "Checkout Page",
  "environment": "live"
}
```

**Response (HTTP 200 OK):**
```json
{
  "request_id": "req_1791300226615",
  "salutation": "Good morning! Welcome back to Acme Support.",
  "customerType": "returning",
  "suggestedActions": ["Track Order", "Troubleshoot Checkout", "Speak to Agent"]
}
```

---

### 2.3 Finalize Conversation Session

`POST /v1/support/end`

Closes an active conversation session and extracts durable facts to retain in Contextis Memory.

**Request Body:**
```json
{
  "user_id": "customer_101",
  "conversation_id": "conv_849201948201",
  "messages": [
    "I am having trouble checking out on my MacBook Pro.",
    "Order ord_9842 is currently in transit with FedEx Express."
  ]
}
```

**Response (HTTP 200 OK):**
```json
{
  "request_id": "req_1791300232574",
  "conversation_id": "conv_849201948201",
  "user_id": "customer_101",
  "facts_stored": 2
}
```

---

### 2.4 Customer Feedback Submission

`POST /v1/support/feedback`

Records customer satisfaction rating for a conversation.

**Request Body:**
```json
{
  "conversation_id": "conv_849201948201",
  "customer_id": "customer_101",
  "rating": "positive",
  "reason": "Agent remembered my previous device context"
}
```

---

### 2.5 Human Agent Escalation

`POST /v1/support/escalate`

Transfers an unresolved customer conversation to human support and generates an AI context dossier.

**Request Body:**
```json
{
  "conversation_id": "conv_849201948201",
  "user_id": "customer_101",
  "reason": "Account locked after MFA failures"
}
```

**Response (HTTP 200 OK):**
```json
{
  "request_id": "req_1791300237928",
  "id": "esc_1ba5d395860d4971a75e4a1c1720a81f",
  "status": "requested",
  "contextSummary": "=== CONTEXTIS ESCALATION DOSSIER ===\nCustomer ID: customer_101..."
}
```

---

### 2.6 Execute Business Tool

`POST /v1/projects/:projectId/tools/:toolId/execute` *(Requires Secret Key `sk_*`)*

Executes an authorized project business tool with strict schema validation.

**Request Body:**
```json
{
  "orderId": "ord_9842",
  "customerId": "customer_101"
}
```

**Response (HTTP 200 OK):**
```json
{
  "toolId": "tool_68942bb46aaa42a1b487760d58390e03",
  "toolName": "track_order",
  "result": {
    "status": "shipped",
    "carrier": "FedEx Express",
    "trackingNumber": "FX-98421049281"
  }
}
```

---

## 3. STRUCTURED ERROR RESPONSES

All errors follow a standardized format and include a correlation `request_id`:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "user_id is invalid.",
    "request_id": "req_1791300226661_804fe1"
  }
}
```

Common Error Codes:
- `AUTH_REQUIRED` / `INVALID_API_KEY`: Missing, malformed, or revoked API key.
- `FORBIDDEN`: Insufficient key privilege (e.g. public key attempting tool execution).
- `DOMAIN_NOT_ALLOWED`: Request origin violates widget domain whitelisting.
- `SECURITY_VIOLATION`: Prohibited payload submitted (e.g. password or auth token).
- `RATE_LIMIT_EXCEEDED`: Request velocity exceeded subscription tier limits.
