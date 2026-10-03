# Identity-Centric Support Agent

A secure, identity-aware support agent that persists useful customer facts across sessions without exposing private or cross-user data.

## Problem
Customers repeatedly explain their device, issue history, and previous attempts. The application solves this with a memory loop:

RECALL → REASON → RESPOND → EXTRACT → RETAIN

## Architecture

- Backend: Node.js + Express
- Memory: in-memory per-user memory bank with a Hindsight-compatible abstraction
- AI: Groq chat integration with a graceful demo fallback when API keys are not configured
- Security: Helmet, CORS, rate limiting, input validation, user identity checks
- Frontend: lightweight responsive web UI served by the Express app

## Project structure

```text
identity-centric-support/
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   └── index.js
│   ├── controllers/
│   │   └── supportController.js
│   ├── middleware/
│   │   ├── errorHandler.js
│   │   ├── notFound.js
│   │   └── requestLogger.js
│   ├── routes/
│   │   └── supportRoutes.js
│   ├── services/
│   │   ├── identity/
│   │   │   └── identityService.js
│   │   ├── llm/
│   │   │   └── groqService.js
│   │   ├── memory/
│   │   │   └── hindsightMemoryService.js
│   │   └── supportAgent/
│   │       └── supportAgentService.js
│   ├── utils/
│   │   ├── logger.js
│   │   └── sanitizers.js
│   └── validators/
│       └── supportValidator.js
├── tests/
│   └── support-api.test.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Environment variables

```bash
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=
GROQ_API_KEY=
HINDSIGHT_API_KEY=
HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io
MEMORY_MODE=on
```

The app uses the live Hindsight API when a valid `HINDSIGHT_API_KEY` is present, and safely falls back to the local in-memory memory bank when it is not configured. Secrets are never exposed to the browser.

The developer registry uses local SQLite when `DATABASE_URL` is unset. For Neon or another PostgreSQL provider, set `DATABASE_URL` as a server-side environment secret. On startup, the app creates the registry tables and imports existing `data/identity_support.sqlite` rows into empty PostgreSQL tables. Keep the connection URL out of source control and rotate credentials that have been shared outside your secret manager.

## Install and run

```bash
npm install
npm run dev
```

Then open the frontend in the browser at:

```text
http://localhost:3000
```

### Docker

```bash
npm run docker:build
npm run docker:run
```

The container exposes the app on port 3000 and reads the same environment variables from `.env`.
The image includes a built-in container health check that probes `GET /api/health` and marks the service unhealthy if it stops responding.

The API is available at:

```text
GET /api/health
POST /api/support/chat
POST /api/support/end
GET /api/support/memory
DELETE /api/support/memory

POST /v1/developer/keys
GET /v1/developer/keys
DELETE /v1/developer/keys/:keyId
POST /v1/support/chat
POST /v1/support/end
GET /v1/support/memory/:userId
DELETE /v1/support/memory/:userId
```

## Developer API key flow

The versioned support API accepts developer-issued keys in the `Authorization: Bearer <key>` header or `x-api-key` header. The service creates a signed developer key, stores only a hash, and exposes a tenant-aware key registry for policy enforcement.

```bash
curl -X POST http://localhost:3000/v1/developer/keys \
  -H "Content-Type: application/json" \
  -d '{"name":"Support Console","environment":"test","tenantId":"tenant_acme"}'
```

## API examples

### Health

```bash
curl http://localhost:3000/api/health
```

### Chat

```bash
curl -X POST http://localhost:3000/api/support/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"user_demo_001","message":"The problem is still happening."}'
```

### End session

```bash
curl -X POST http://localhost:3000/api/support/end \
  -H "Content-Type: application/json" \
  -d '{"userId":"user_demo_001","messages":["I use a MacBook Pro and I am getting a 404 login error."]}'
```

## Security notes

- Secrets are only kept in server environment variables.
- Memory is isolated per user.
- Sensitive values such as passwords, tokens, and API keys are filtered before retention.
- CORS is restricted to configured origins.
- The support routes are rate limited.

## Demo flow

1. Start a chat for `user_demo_001` with a MacBook Pro + login error.
2. End the session to store the facts.
3. Start a second chat for the same user with the message, "The problem is still happening."
4. Observe that the system uses the remembered context.
5. Repeat with `memoryMode: "off"` to compare the stateless behavior.

## Testing

```bash
npm test
```

## Known limitations

- If the Hindsight key is absent, the app uses the secure in-memory fallback instead of a remote bank.
- When Groq credentials are absent, the app runs in local demo response mode.
- Production deployments should provide real provider credentials and review the remote retention policy for compliance-sensitive data.
