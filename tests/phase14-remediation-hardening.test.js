const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');
const { query } = require('../src/db');
const { validateRuntimeConfig } = require('../src/config');
const memoryService = require('../src/services/memory/hindsightMemoryService');
const projectToolService = require('../src/services/tool/projectToolService');

describe('Contextis Phase 14 — Remediation, Hardening & Production Readiness', () => {
  let orgAUserCookie;
  let orgBUserCookie;
  let orgAId;
  let orgBId;
  let projectAId;
  let projectBId;
  let publicApiKeyA;
  let secretApiKeyA;
  let publicApiKeyB;
  let secretApiKeyB;
  let toolAId;

  beforeAll(async () => {
    // 1. Setup Tenant / Org A
    const userAEmail = `org-a-${Date.now()}@test.com`;
    const signupARes = await request(app)
      .post('/v1/auth/signup')
      .send({ email: userAEmail, password: 'SecurePasswordA123!', name: 'Org A Admin' });
    expect(signupARes.status).toBe(201);
    orgAUserCookie = signupARes.headers['set-cookie'][0].split(';')[0];

    const orgARes = await request(app).get('/v1/organization').set('Cookie', orgAUserCookie);
    orgAId = orgARes.body.organization.id;

    const projARes = await request(app)
      .post('/v1/projects')
      .set('Cookie', orgAUserCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Project Alpha', environment: 'live' });
    expect(projARes.status).toBe(201);
    projectAId = projARes.body.project.id;

    const pkARes = await request(app)
      .post(`/v1/projects/${projectAId}/api-keys`)
      .set('Cookie', orgAUserCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Public Key Alpha', keyType: 'public', environment: 'live' });
    expect(pkARes.status).toBe(201);
    publicApiKeyA = pkARes.body.key;

    const skARes = await request(app)
      .post(`/v1/projects/${projectAId}/api-keys`)
      .set('Cookie', orgAUserCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Secret Key Alpha', keyType: 'secret', environment: 'live' });
    expect(skARes.status).toBe(201);
    secretApiKeyA = skARes.body.key;

    // Create Tool in Project A
    const toolARes = await request(app)
      .post(`/v1/projects/${projectAId}/tools`)
      .set('Cookie', orgAUserCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        name: 'order_status_check',
        description: 'Check customer order status',
        sensitivity: 'READ',
        permissions: ['orders:read'],
        inputSchema: {
          type: 'object',
          properties: { orderId: { type: 'string' } },
          required: ['orderId'],
        },
      });
    expect(toolARes.status).toBe(201);
    toolAId = toolARes.body.tool.id;

    // 2. Setup Tenant / Org B
    const userBEmail = `org-b-${Date.now()}@test.com`;
    const signupBRes = await request(app)
      .post('/v1/auth/signup')
      .send({ email: userBEmail, password: 'SecurePasswordB123!', name: 'Org B Admin' });
    expect(signupBRes.status).toBe(201);
    orgBUserCookie = signupBRes.headers['set-cookie'][0].split(';')[0];

    const orgBRes = await request(app).get('/v1/organization').set('Cookie', orgBUserCookie);
    orgBId = orgBRes.body.organization.id;

    const projBRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', orgBUserCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Project Beta', environment: 'live' });
    expect(projBRes.status).toBe(201);
    projectBId = projBRes.body.project.id;

    const pkBRes = await request(app)
      .post(`/v1/projects/${projectBId}/api-keys`)
      .set('Cookie', orgBUserCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Public Key Beta', keyType: 'public', environment: 'live' });
    expect(pkBRes.status).toBe(201);
    publicApiKeyB = pkBRes.body.key;

    const skBRes = await request(app)
      .post(`/v1/projects/${projectBId}/api-keys`)
      .set('Cookie', orgBUserCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Secret Key Beta', keyType: 'secret', environment: 'live' });
    expect(skBRes.status).toBe(201);
    secretApiKeyB = skBRes.body.key;
  }, 30000);

  describe('1. CORS & Embeddable Widget Security', () => {
    it('serves widget.js with Cross-Origin-Resource-Policy cross-origin', async () => {
      const res = await request(app).get('/widget.js');
      expect(res.status).toBe(200);
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('allows cross-origin fetch to /widget/config from third-party client site', async () => {
      const res = await request(app)
        .get(`/widget/config?project_id=${projectAId}&public_key=${publicApiKeyA}`)
        .set('Origin', 'https://customer-shopify-store.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://customer-shopify-store.com');
      expect(res.body.config.projectId).toBe(projectAId);
    });

    it('allows cross-origin fetch to /v1/support/opening with public key', async () => {
      const res = await request(app)
        .post('/v1/support/opening')
        .set('x-api-key', publicApiKeyA)
        .set('Origin', 'https://customer-shopify-store.com')
        .send({ userId: 'cust_shop_101', pageContext: 'Cart Page' });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://customer-shopify-store.com');
      expect(res.body.salutation).toBeDefined();
    });

    it('enforces allowed_domains whitelist when specified in widget settings', async () => {
      // Configure allowed domains for Project A
      const updateRes = await request(app)
        .put(`/v1/projects/${projectAId}/widget`)
        .set('Cookie', orgAUserCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          agentName: 'Secure Agent',
          allowedDomains: 'trusted-shop.com, staging.trusted-shop.com',
        });
      expect(updateRes.status).toBe(200);

      // Request from authorized origin succeeds
      const allowedRes = await request(app)
        .get(`/widget/config?project_id=${projectAId}&public_key=${publicApiKeyA}`)
        .set('Origin', 'https://trusted-shop.com');
      expect(allowedRes.status).toBe(200);

      // Request from unauthorized origin is rejected with 403 DOMAIN_NOT_ALLOWED
      const blockedRes = await request(app)
        .get(`/widget/config?project_id=${projectAId}&public_key=${publicApiKeyA}`)
        .set('Origin', 'https://malicious-phishing-site.com');
      expect(blockedRes.status).toBe(403);
      expect(blockedRes.body.error.code).toBe('DOMAIN_NOT_ALLOWED');

      // Public API key request to /v1/support/chat is also rejected from unauthorized origin
      const blockedChatRes = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', publicApiKeyA)
        .set('Origin', 'https://malicious-phishing-site.com')
        .send({ userId: 'cust_phish_1', message: 'Hello' });
      expect(blockedChatRes.status).toBe(403);
      expect(blockedChatRes.body.error.code).toBe('DOMAIN_NOT_ALLOWED');

      // Reset allowed domains back to *
      await request(app)
        .put(`/v1/projects/${projectAId}/widget`)
        .set('Cookie', orgAUserCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ allowedDomains: '*' });
    });
  });

  describe('2. Public vs Secret API Key Privilege Boundaries', () => {
    it('rejects public key (pk_*) when calling direct tool execution endpoint', async () => {
      const res = await request(app)
        .post(`/v1/projects/${projectAId}/tools/${toolAId}/execute`)
        .set('x-api-key', publicApiKeyA)
        .send({ orderId: 'ORD-991' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/Public API keys/i);
    });

    it('permits secret key (sk_*) to execute tool successfully', async () => {
      const res = await request(app)
        .post(`/v1/projects/${projectAId}/tools/${toolAId}/execute`)
        .set('x-api-key', secretApiKeyA)
        .send({ orderId: 'ORD-991' });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status).toBe('ok');
    });

    it('rejects public key (pk_*) when calling memory management endpoint', async () => {
      const getRes = await request(app)
        .get('/v1/support/memory/cust_target_1')
        .set('x-api-key', publicApiKeyA);
      expect(getRes.status).toBe(403);
      expect(getRes.body.error.code).toBe('FORBIDDEN');

      const delRes = await request(app)
        .delete('/v1/support/memory/cust_target_1')
        .set('x-api-key', publicApiKeyA);
      expect(delRes.status).toBe(403);
      expect(delRes.body.error.code).toBe('FORBIDDEN');
    });

    it('permits secret key (sk_*) to access memory management endpoint', async () => {
      const getRes = await request(app)
        .get('/v1/support/memory/cust_target_1')
        .set('x-api-key', secretApiKeyA);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body.memory)).toBe(true);
    });

    it('rejects revoked API key', async () => {
      // Create and revoke a key in Project A
      const genRes = await request(app)
        .post(`/v1/projects/${projectAId}/api-keys`)
        .set('Cookie', orgAUserCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ name: 'Key To Revoke', keyType: 'secret', environment: 'live' });
      const revKey = genRes.body.key;
      const revKeyId = genRes.body.metadata?.id || genRes.body.id;

      const deleteRes = await request(app)
        .delete(`/v1/projects/${projectAId}/api-keys/${revKeyId}`)
        .set('Cookie', orgAUserCookie)
        .set('Origin', 'http://localhost:3000');
      expect(deleteRes.status).toBe(200);

      // Using the revoked key must fail with 401
      const callRes = await request(app)
        .get('/v1/support/memory/cust_any')
        .set('x-api-key', revKey);
      expect(callRes.status).toBe(401);
      expect(callRes.body.error.code).toBe('INVALID_API_KEY');
    });
  });

  describe('3. Multi-Tenant Cryptographic Isolation', () => {
    const sharedUserId = `user_iso_${Date.now()}`;

    it('prevents Org A from accessing Org B project via session API', async () => {
      const crossRes = await request(app)
        .get(`/v1/projects/${projectBId}`)
        .set('Cookie', orgAUserCookie);
      expect(crossRes.status).toBe(404);
      expect(crossRes.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('prevents Key A from executing tools in Project B', async () => {
      const crossRes = await request(app)
        .post(`/v1/projects/${projectBId}/tools/${toolAId}/execute`)
        .set('x-api-key', secretApiKeyA)
        .send({ orderId: 'ORD-123' });
      expect(crossRes.status).toBe(403);
      expect(crossRes.body.error.code).toBe('PROJECT_MISMATCH');
    });

    it('completely isolates memory between Project A and Project B for identical user_id', async () => {
      // 1. Customer chats in Project A stating device and issue
      const chatARes = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', secretApiKeyA)
        .send({
          userId: sharedUserId,
          message: 'I am on a MacBook Pro with macOS and having a login error. I already restarted.',
        });
      expect(chatARes.status).toBe(200);

      // End session in Project A to retain durable facts
      const endRes = await request(app)
        .post('/v1/support/end')
        .set('x-api-key', secretApiKeyA)
        .send({
          userId: sharedUserId,
          messages: ['I am on a MacBook Pro with macOS and having a login error. I already restarted.'],
        });
      expect(endRes.status).toBe(200);
      expect(endRes.body.factsStored).toBeGreaterThan(0);

      // 2. Snapshot memory in Project A
      const memARes = await request(app)
        .get(`/v1/support/memory/${sharedUserId}`)
        .set('x-api-key', secretApiKeyA);
      expect(memARes.status).toBe(200);
      expect(memARes.body.memory.length).toBeGreaterThan(0);
      const factText = JSON.stringify(memARes.body.memory);
      expect(factText).toMatch(/MacBook Pro|login error/i);

      // 3. Snapshot memory in Project B for the EXACT same user_id: MUST BE EMPTY
      const memBRes = await request(app)
        .get(`/v1/support/memory/${sharedUserId}`)
        .set('x-api-key', secretApiKeyB);
      expect(memBRes.status).toBe(200);
      expect(memBRes.body.memory).toEqual([]);

      // 4. Chat in Project B: agent must have ZERO recalled facts from Project A
      const chatBRes = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', secretApiKeyB)
        .send({
          userId: sharedUserId,
          message: 'What device do I use?',
        });
      expect(chatBRes.status).toBe(200);
      expect(chatBRes.body.memoryUsed).toBe(false);
      expect(chatBRes.body.memory_used).toBe(false);
    });
  });

  describe('4. Tool & Input Security Guardrails', () => {
    it('rejects passwords or secrets supplied in tool execution input', async () => {
      const res = await request(app)
        .post(`/v1/projects/${projectAId}/tools/${toolAId}/execute`)
        .set('x-api-key', secretApiKeyA)
        .send({
          orderId: 'ORD-991',
          password: 'SecretUserPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SECURITY_VIOLATION');
      expect(res.body.error.message).toMatch(/Passwords and auth tokens must never be supplied/i);
    });

    it('rejects malformed identity containing path traversal or SQL injection attempt', async () => {
      const injectionUserId = '../../etc/passwd';
      const res = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', secretApiKeyA)
        .send({
          userId: injectionUserId,
          message: 'Hello support',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_IDENTITY');
    });

    it('rejects message payload exceeding safe size limits', async () => {
      const oversized = 'A'.repeat(12000);
      const res = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', secretApiKeyA)
        .send({
          userId: 'cust_valid_1',
          message: oversized,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
      expect(res.body.error.message).toMatch(/too long/i);
    });
  });

  describe('5. Error Formatting & Stack Trace Prevention', () => {
    it('returns structured error with request_id and no stack trace on bad requests', async () => {
      const res = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', secretApiKeyA)
        .send({
          userId: '',
          message: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('INVALID_IDENTITY');
      expect(res.body.error.message).toBeDefined();
      expect(res.body.error.request_id || res.body.request_id).toBeDefined();
      expect(res.body.stack).toBeUndefined();
      expect(res.body.error.stack).toBeUndefined();
    });
  });

  describe('6. Production Configuration Enforcement', () => {
    it('rejects startup in production if default development pepper is used', () => {
      expect(() => {
        validateRuntimeConfig({
          nodeEnv: 'production',
          apiKeyPepper: 'identity-centric-support-development-only',
          billingWebhookSecret: 'whsec_prod123',
          supportApiKey: 'sup_prod123',
        });
      }).toThrow(/default development API_KEY_PEPPER/i);
    });

    it('rejects startup in production if required secrets are empty', () => {
      expect(() => {
        validateRuntimeConfig({
          nodeEnv: 'production',
          apiKeyPepper: '',
          billingWebhookSecret: '',
          supportApiKey: '',
        });
      }).toThrow(/missing required environment values/i);
    });

    it('passes production validation when custom strong secrets are provided', () => {
      const validConfig = {
        nodeEnv: 'production',
        apiKeyPepper: 'custom-prod-pepper-hash-strong-9988',
        billingWebhookSecret: 'whsec_custom_prod_live_8877',
        supportApiKey: 'sup_prod_custom_live_6655',
      };
      expect(() => validateRuntimeConfig(validConfig)).not.toThrow();
    });
  });
});
