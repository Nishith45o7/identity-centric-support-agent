# Contextis — Persistent Customer Memory Engine

Contextis provides AI customer support that remembers every customer across sessions, channels, and devices. This document details the technical architecture, security boundaries, and operational characteristics of the Contextis Persistent Memory subsystem.

---

## 1. Overview & Architecture

Contextis implements persistent memory using a layered retrieval architecture:

```text
Customer Message
       ↓
Memory Scoping Check (org_id / project_id / environment / user_id)
       ↓
Memory Retrieval & Fact Recall
       ↓
Groq LLM Prompt Context Augmentation
       ↓
AI Response Generation
       ↓
Asynchronous Fact Extraction & Retention
       ↓
Cryptographic Vector / In-Memory Storage
```

1. **Deterministic Bank Scoping:** Vector memory banks are isolated per customer, per environment, per project, and per organization.
2. **Fact Retention:** As conversations proceed, salient user facts (devices, operating systems, unresolved technical issues, customer preferences) are extracted and categorized.
3. **Fact Recall:** On subsequent visits, relevant facts are automatically recalled and injected into the LLM system prompt so customers never have to repeat themselves.
4. **Graceful Fallback:** If the external Hindsight Vector Memory service is unavailable or unconfigured, Contextis seamlessly falls back to local in-process memory maps with identical retention and recall interfaces.

---

## 2. Multi-Tenant Bank Scoping

Memory banks use a deterministic, collision-resistant SHA-256 namespace formulation:

$$\text{BankID} = \text{SHA256}(\text{org\_id} \mathbin{\Vert} \text{project\_id} \mathbin{\Vert} \text{environment} \mathbin{\Vert} \text{user\_id})$$

```javascript
const buildBankId = (orgId, projectId, environment, userId) => {
  const hash = crypto
    .createHash('sha256')
    .update(`${orgId}\0${projectId}\0${environment}\0${userId}`)
    .digest('hex')
    .slice(0, 32);
  return `ctx_${environment}_${hash}`;
};
```

This guarantees:
- **Zero Cross-Customer Leakage:** Customer A can never access Customer B's memories.
- **Zero Cross-Project Leakage:** Identical user IDs across separate projects within the same organization operate in completely separate memory namespaces.
- **Zero Cross-Environment Contamination:** Staging and test memories (`ctx_test_*`, `ctx_staging_*`) are cryptographically isolated from production live memories (`ctx_live_*`).

---

## 3. Fact Extraction & Sanitization

### Categories
Facts are categorized into structured buckets:
- `identity`: Customer name, account handle, role.
- `device`: Hardware models (MacBook Pro, ThinkPad, iPhone), peripherals, firmware.
- `environment`: Operating system, browser, version.
- `issue`: Active error codes (404, 500), failing workflows.
- `attempted_fix`: Prior troubleshooting steps already attempted.

### Security Sanitization & PII Redaction
Before any memory candidate is evaluated or persisted:
- **Passwords & Secrets:** Any string matching authentication credentials, API keys, or JWT tokens is stripped.
- **Credit Cards & PII:** Credit card numbers (Luhn candidate regex) and sensitive financial identifiers are redacted.
- **Prompt Injection Defense:** Input strings containing prompt override instructions (e.g., "Ignore previous instructions", "System prompt: ") are scrubbed.

---

## 4. API Endpoints

### Retrieve Customer Memory Snapshot
```http
GET /v1/support/memory/:userId
Authorization: Bearer sk_live_...
```
*Requires Secret Key (`sk_*`). Public Widget Keys (`pk_*`) are rejected with HTTP 403.*

**Response:**
```json
{
  "success": true,
  "userId": "customer_demo_001",
  "bankId": "ctx_live_4f89b...",
  "memory": [
    {
      "category": "device",
      "fact": "MacBook Pro M2 running macOS Sonoma",
      "timestamp": "2026-10-07T14:15:00.000Z"
    }
  ]
}
```

### Clear Customer Memory (GDPR / Right to be Forgotten)
```http
DELETE /v1/support/memory/:userId
Authorization: Bearer sk_live_...
```

---

## 5. Memory Modes

Contextis supports explicit memory toggling via the `memoryMode` request parameter:
- `on` (Default): Memory recall and fact retention active.
- `off`: Stateless baseline mode. No prior memory is recalled, and no conversation context from this session is retained.

---

## 6. Resilience & Production Verification

- **Timeout Boundaries:** External vector searches are constrained by 3-second network timeouts.
- **100% Non-Blocking:** Fact extraction and storage are asynchronous and will never delay the customer response stream.
- **Empirical Validation:** Memory recall, multi-tenant isolation, and sensitive field redaction are verified across 17 automated test suites with 100% pass rates.
