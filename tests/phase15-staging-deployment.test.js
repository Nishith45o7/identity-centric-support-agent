const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');
const { query } = require('../src/db');
const { validateRuntimeConfig } = require('../src/config');
const memoryService = require('../src/services/memory/hindsightMemoryService');

describe('Contextis Phase 15 — Staging Deployment & Production-Like Infrastructure', () => {
  let stagingDevCookie;
  let stagingOrgId;
  let stagingProjectId;
  let stagingPublicKey;
  let stagingSecretKey;
  let stagingToolId;

  beforeAll(async () => {
    // 1. Provision Staging Organization & Developer Session
    const email = `staging-dev-${Date.now()}@contextis-staging.test`;
    const signupRes = await request(app)
      .post('/v1/auth/signup')
      .send({ email, password: 'StagingSecurePassword123!', name: 'Staging Admin Dev' });
    expect(signupRes.status).toBe(201);
    stagingDevCookie = signupRes.headers['set-cookie'][0].split(';')[0];

    const orgRes = await request(app).get('/v1/organization').set('Cookie', stagingDevCookie);
    stagingOrgId = orgRes.body.organization.id;

    // 2. Create Staging Project (environment: test/staging)
    const projRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', stagingDevCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Contextis Staging Storefront', environment: 'test' });
    expect(projRes.status).toBe(201);
    stagingProjectId = projRes.body.project.id;

    // 3. Generate Staging API Keys
    const pkRes = await request(app)
      .post(`/v1/projects/${stagingProjectId}/api-keys`)
      .set('Cookie', stagingDevCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Staging Public Widget Key', keyType: 'public', environment: 'test' });
    expect(pkRes.status).toBe(201);
    stagingPublicKey = pkRes.body.key;
    expect(stagingPublicKey).toMatch(/^pk_test_/);

    const skRes = await request(app)
      .post(`/v1/projects/${stagingProjectId}/api-keys`)
      .set('Cookie', stagingDevCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Staging Secret API Key', keyType: 'secret', environment: 'test' });
    expect(skRes.status).toBe(201);
    stagingSecretKey = skRes.body.key;
    expect(stagingSecretKey).toMatch(/^sk_test_/);

    // 4. Create Safe Staging Business Tool
    const toolRes = await request(app)
      .post(`/v1/projects/${stagingProjectId}/tools`)
      .set('Cookie', stagingDevCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        name: 'track_order',
        description: 'Check real-time shipping status for staging orders',
        sensitivity: 'READ',
        permissions: ['orders:read', 'tracking:read'],
        inputSchema: {
          type: 'object',
          properties: { orderId: { type: 'string' } },
          required: ['orderId'],
        },
      });
    expect(toolRes.status).toBe(201);
    stagingToolId = toolRes.body.tool.id;
  });

  describe('1. Strict Staging Environment Configuration & Validation', () => {
    it('validates that staging environment enforces secret requirements', () => {
      expect(() => {
        validateRuntimeConfig({
          nodeEnv: 'staging',
          apiKeyPepper: 'identity-centric-support-development-only',
          billingWebhookSecret: 'whsec_staging_123',
          supportApiKey: 'sup_staging_123',
        });
      }).toThrow(/Staging deployment cannot use the default development API_KEY_PEPPER/i);

      expect(() => {
        validateRuntimeConfig({
          nodeEnv: 'staging',
          apiKeyPepper: '',
          billingWebhookSecret: '',
          supportApiKey: '',
        });
      }).toThrow(/Staging deployment is missing required environment values/i);
    });

    it('passes runtime validation when valid staging credentials are provided', () => {
      const validStagingConfig = {
        nodeEnv: 'staging',
        apiKeyPepper: 'staging-pepper-crypto-hash-998877665544',
        billingWebhookSecret: 'whsec_staging_live_test_776655',
        supportApiKey: 'sup_staging_key_554433',
      };
      expect(() => validateRuntimeConfig(validStagingConfig)).not.toThrow();
    });
  });

  describe('2. Health, Liveness, and Readiness Probe Verification', () => {
    it('responds to root /health probe with healthy status and metadata', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('healthy');
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('responds to root /live probe with alive status', async () => {
      const res = await request(app).get('/live');
      expect(res.status).toBe(200);
      expect(res.body.alive).toBe(true);
      expect(res.body.status).toBe('alive');
    });

    it('responds to root /ready probe and verifies database connectivity', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
      expect(res.body.status).toBe('ready');
      expect(res.body.database).toBe('connected');
    });

    it('maintains backwards compatibility for /api/health, /api/ready, /api/live', async () => {
      const healthRes = await request(app).get('/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.status).toBe('healthy');

      const readyRes = await request(app).get('/api/ready');
      expect(readyRes.status).toBe(200);
      expect(readyRes.body.ready).toBe(true);

      const liveRes = await request(app).get('/api/live');
      expect(liveRes.status).toBe(200);
      expect(liveRes.body.alive).toBe(true);
    });
  });

  describe('3. Strict Hindsight Memory Environment Namespace Separation', () => {
    it('generates distinct namespace bank IDs for staging vs production for identical user and project', () => {
      const testUserId = 'customer_isolation_check_101';
      const stagingBankId = memoryService.buildBankId(testUserId, stagingOrgId, stagingProjectId, 'staging');
      const liveBankId = memoryService.buildBankId(testUserId, stagingOrgId, stagingProjectId, 'live');

      expect(stagingBankId).toMatch(/^ctx_staging_/);
      expect(liveBankId).toMatch(/^ctx_live_/);
      expect(stagingBankId).not.toEqual(liveBankId);
    });
  });

  describe('4. Synthetic Staging Customer Smoke Journeys', () => {
    it('Journey A: customer_demo_001 (first-time visitor session)', async () => {
      const res = await request(app)
        .post('/v1/support/opening')
        .set('x-api-key', stagingPublicKey)
        .send({
          userId: 'customer_demo_001',
          pageContext: 'Staging Demo Landing Page',
          environment: 'test',
        });

      expect(res.status).toBe(200);
      expect(res.body.salutation).toBeDefined();
      expect(Array.isArray(res.body.suggestedActions)).toBe(true);
      expect(res.body.customerType).toBe('first_time');
    });

    it('Journey B: customer_returning_001 (context retention & memory recall)', async () => {
      const returningUser = 'customer_returning_001';

      // Session 1: State device and issue
      const chat1 = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', stagingSecretKey)
        .send({
          userId: returningUser,
          message: 'I am using a MacBook Pro with macOS and having a login issue. I already restarted.',
          environment: 'test',
        });
      expect(chat1.status).toBe(200);

      // Finalize session 1 to retain facts
      const end1 = await request(app)
        .post('/v1/support/end')
        .set('x-api-key', stagingSecretKey)
        .send({
          userId: returningUser,
          messages: ['I am using a MacBook Pro with macOS and having a login issue. I already restarted.'],
        });
      expect(end1.status).toBe(200);
      expect(end1.body.factsStored).toBeGreaterThan(0);

      // Session 2: Return later
      const chat2 = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', stagingSecretKey)
        .send({
          userId: returningUser,
          message: 'It is happening again. What device was I using?',
          environment: 'test',
        });
      expect(chat2.status).toBe(200);
      expect(chat2.body.memoryUsed).toBe(true);
      expect(chat2.body.reply).toMatch(/MacBook Pro|macOS|login/i);
    });

    it('Journey C: customer_tool_test_001 (safe staging tool action execution)', async () => {
      const res = await request(app)
        .post(`/v1/projects/${stagingProjectId}/tools/${stagingToolId}/execute`)
        .set('x-api-key', stagingSecretKey)
        .send({
          orderId: 'ORD-8492',
          customerId: 'customer_tool_test_001',
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status).toBe('shipped');
      expect(res.body.result.carrier).toBe('FedEx Express');
      expect(res.body.result.summary).toMatch(/FedEx Express/i);
    });

    it('Journey D: customer_handoff_001 (human escalation & context dossier)', async () => {
      const handoffUser = 'customer_handoff_001';

      const chatRes = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', stagingSecretKey)
        .send({
          userId: handoffUser,
          message: 'My account is locked out after multiple MFA failures.',
          environment: 'test',
        });
      expect(chatRes.status).toBe(200);

      const escRes = await request(app)
        .post('/v1/support/escalate')
        .set('x-api-key', stagingSecretKey)
        .send({
          conversation_id: chatRes.body.conversation_id,
          user_id: handoffUser,
          reason: 'Customer locked out after MFA failure',
          metadata: { priority: 'urgent' },
        });

      expect(escRes.status).toBe(200);
      expect(escRes.body.id).toMatch(/^esc_/);
      const dossierText = escRes.body.contextSummary || escRes.body.dossier;
      expect(dossierText).toBeDefined();
      expect(dossierText).toMatch(/CONTEXTIS ESCALATION DOSSIER/i);
      expect(dossierText).toMatch(/MFA failure/i);
    });
  });

  describe('5. Staging Playground & Demo Page Verification', () => {
    it('serves the staging demo sandbox at /staging with proper labeling', async () => {
      const res = await request(app).get('/staging');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toMatch(/STAGING ENVIRONMENT — NOT FOR PRODUCTION USE/i);
      expect(res.text).toMatch(/customer_demo_001/);
      expect(res.text).toMatch(/customer_returning_001/);

      // Verify no secret tokens leaked
      expect(res.text).not.toMatch(/sk_live_/);
      expect(res.text).not.toMatch(/API_KEY_PEPPER/);
    });
  });
});
