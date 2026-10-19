# CONTEXTIS — EMBEDDABLE CHAT WIDGET

**Version:** 1.0.0  
**Script Asset:** `/widget.js`

---

## 1. OVERVIEW

The Contextis Chat Widget is a modern, responsive, identity-centric frontend embed. It mounts seamlessly on any web application or e-commerce storefront, providing customers with an intelligent AI support agent that remembers prior conversations, past devices, and open tickets.

---

## 2. QUICK EMBED SNIPPET

Add the following snippet before the closing `</body>` tag on your website:

```html
<script src="https://api.contextis.com/widget.js"></script>
<script>
  window.ContextisWidget.init({
    projectId: "prj_your_project_id",
    publicKey: "pk_live_your_public_key",
    userId: "cust_current_logged_in_user_id",
    accentColor: "#38bdf8",
    agentName: "Acme Support Assistant",
    theme: "dark", // 'dark' | 'light' | 'auto'
    position: "bottom-right" // 'bottom-right' | 'bottom-left'
  });
</script>
```

---

## 3. CONFIGURATION OPTIONS

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `projectId` | String | *(Required)* | Project identifier. |
| `publicKey` | String | *(Required)* | Restricted public browser key (`pk_test_*` or `pk_live_*`). |
| `userId` | String | `anonymous_<id>` | Unique external user/customer identifier. |
| `agentName` | String | `'Contextis Support'` | Display name shown in the chat widget header. |
| `accentColor` | String | `'#38bdf8'` | Brand color applied to chat bubbles, buttons, and accents. |
| `theme` | String | `'dark'` | Color scheme (`dark`, `light`, or `auto`). |
| `position` | String | `'bottom-right'` | Launcher bubble anchor (`bottom-right` or `bottom-left`). |
| `placeholder` | String | `'Type your message...'` | Input placeholder text. |

---

## 4. SECURITY & DOMAIN WHITELISTING

1. **Restricted Browser Key:** The widget only accepts public keys (`pk_*`). Secret keys (`sk_*`) must never be placed in frontend code.
2. **Domain Whitelisting:** Developers can restrict allowed domains in project settings (e.g. `store.acme.com, acme.com`). The server verifies the `Origin` header; requests from unauthorized websites are rejected with HTTP 403 `DOMAIN_NOT_ALLOWED`.
3. **Cross-Origin Resource Policy (CORP):** `/widget.js` is served with `Cross-Origin-Resource-Policy: cross-origin`, allowing clean embedding on external client host domains.
4. **XSS Protection:** All message content rendered within the widget is text-encoded to prevent HTML and script injection.

---

## 5. DYNAMIC FEATURES

- **Time-Aware Salutations:** Generates greetings tailored to customer local timezones (e.g. "Good morning!").
- **Persona Context:** Recognizes returning customers and acknowledges ongoing issues without customer repetition.
- **In-Chat Tool Rendering:** Displays interactive status cards when tools execute (e.g. live shipping tracking cards).
- **In-Chat Escalation:** Provides clean handoff cards when an issue requires human attention.
