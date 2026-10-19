const request = require('supertest');
const crypto = require('crypto');
const http = require('http');
const { app } = require('../src/app');
const webhookService = require('../src/services/webhook/webhookService');
const memoryService = require('../src/services/memory/hindsightMemoryService');

describe('Contextis Phase 12 — Growth, Intelligence, Analytics, Webhooks & Escalation', () => {
  let cookie;
  let organizationId;
  let projectId;
  let secretKey;
  let publicKey;
  const testCustomer = `cust_growth_${Date.now()}`;

  beforeAll(async () => {
    const email = `phase12-dev-${Date.now()}@contextis.test`;
    const signupRes = await request(app)
      .post('/v1/auth/signup')
      .send({ email, password: 'SecurePassword123!', name: 'Growth SaaS Lead' });
    expect(signupRes.status).toBe(201);
    cookie = signupRes.headers['set-cookie'][0].split(';')[0];

    const orgRes = await request(app).get('/v1/organization').set('Cookie', cookie);
    organizationId = orgRes.body.organization.id;

    const projRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Growth Intelligence App', environment: 'live' });
    expect(projRes.status).toBe(201);
    projectId = projRes.body.project.id;

    const pkRes = await request(app)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Public Browser Key', keyType: 'public', environment: 'live' });
    publicKey = pkRes.body.key;

    const skRes = await request(app)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Secret Backend Key', keyType: 'secret', environment: 'live' });
    secretKey = skRes.body.key;

    // Seed conversations & usage
    const chatRes1 = await request(app)
      .post('/v1/support/chat')
      .set('x-api-key', publicKey)
      .send({ user_id: testCustomer, message: 'I need help checking out.' });
    expect(chatRes1.status).toBe(200);

    // Seed positive feedback
    await request(app)
      .post('/v1/support/feedback')
      .set('x-api-key', publicKey)
      .send({
        conversation_id: chatRes1.body.conversation_id,
        customer_id: testCustomer,
        rating: 'positive',
      });

    // Seed escalation
    await request(app)
      .post('/v1/support/escalate')
      .set('x-api-key', publicKey)
      .send({
        conversation_id: chatRes1.body.conversation_id,
        user_id: testCustomer,
        reason: 'Payment gateway rejected customer card',
      });
  }, 30000);

  describe('1. Real Time-Series Analytics & Metrics Engine', () => {
    it('returns data-driven support metrics and resolution statistics', async () => {
      const res = await request(app)
        .get(`/v1/projects/${projectId}/analytics?range=7d`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.analytics).toBeDefined();
      const { overview } = res.body.analytics;
      expect(overview.totalConversations).toBeGreaterThanOrEqual(1);
      expect(overview.escalatedConversations).toBeGreaterThanOrEqual(1);
      expect(overview.satisfactionRate).toBeGreaterThanOrEqual(0);
      expect(overview.totalRequests).toBeGreaterThanOrEqual(1);
      expect(typeof overview.avgLatencyMs).toBe('number');
    });

    it('isolates analytics by project boundary', async () => {
      // Create a second clean project
      const projRes2 = await request(app)
        .post('/v1/projects')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .send({ name: 'Empty Project Analytics', environment: 'live' });
      const emptyProjId = projRes2.body.project.id;

      const res = await request(app)
        .get(`/v1/projects/${emptyProjId}/analytics?range=7d`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.analytics.overview.totalConversations).toBe(0);
      expect(res.body.analytics.overview.totalRequests).toBe(0);
      expect(res.body.analytics.overview.escalatedConversations).toBe(0);
    });
  });

  describe('2. Escalations & Human Handoff Management', () => {
    let escalationId;

    it('lists escalations with customer context and reason', async () => {
      const res = await request(app)
        .get(`/v1/projects/${projectId}/escalations`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.escalations)).toBe(true);
      expect(res.body.escalations.length).toBeGreaterThanOrEqual(1);

      const target = res.body.escalations[0];
      escalationId = target.id;
      expect(target.reason).toContain('Payment gateway rejected');
      expect(target.status).toBe('requested');
      expect(target.context_summary).toContain('CONTEXTIS ESCALATION DOSSIER');
    });

    it('allows support team to assign and resolve escalation tickets', async () => {
      const res = await request(app)
        .patch(`/v1/projects/${projectId}/escalations/${escalationId}`)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          status: 'in_progress',
          assigned_to: 'agent_sarah_support',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify status update in list
      const listRes = await request(app)
        .get(`/v1/projects/${projectId}/escalations`)
        .set('Cookie', cookie);
      const updated = listRes.body.escalations.find((e) => e.id === escalationId);
      expect(updated.status).toBe('in_progress');
      expect(updated.assigned_to).toBe('agent_sarah_support');
    });
  });

  describe('3. Outbound Webhooks & HMAC Signatures', () => {
    let webhookId;
    let webhookSecret;

    it('creates a new signed webhook endpoint and reveals secret once', async () => {
      const res = await request(app)
        .post(`/v1/projects/${projectId}/webhooks`)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          name: 'Customer Events Webhook',
          url: 'https://webhook.site/test-endpoint',
          events: ['conversation.created', 'conversation.escalated'],
        });

      expect(res.status).toBe(201);
      expect(res.body.webhook).toBeDefined();
      webhookId = res.body.webhook.id;
      webhookSecret = res.body.webhook.secret;
      expect(webhookId).toMatch(/^whk_/);
      expect(webhookSecret).toMatch(/^whsec_/);
    });

    it('lists configured webhooks while masking secrets', async () => {
      const res = await request(app)
        .get(`/v1/projects/${projectId}/webhooks`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.webhooks)).toBe(true);
      const found = res.body.webhooks.find((w) => w.id === webhookId);
      expect(found).toBeDefined();
      expect(found.secret).toBeUndefined(); // Secret must never be exposed after creation
    });

    it('verifies HMAC-SHA256 signature algorithm against expected hash', () => {
      const payload = JSON.stringify({ event: 'conversation.escalated', data: { id: 'test_123' } });
      const secret = 'whsec_test_secret_123';
      const signature = webhookService.signPayload(payload, secret);

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
      const expectedHash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(signature).toBe(`sha256=${expectedHash}`);
    });

    it('deletes a webhook endpoint cleanly', async () => {
      const res = await request(app)
        .delete(`/v1/projects/${projectId}/webhooks/${webhookId}`)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('4. Customer Memory Deletion & GDPR Privacy Controls', () => {
    const gdprCustomer = `cust_gdpr_${Date.now()}`;

    beforeAll(async () => {
      await memoryService.retain(
        gdprCustomer,
        [{ category: 'profile', fact: 'Lives in London and prefers night delivery' }],
        organizationId,
        projectId,
        'live'
      );
    });

    it('retrieves customer memory snapshot via secret key', async () => {
      const res = await request(app)
        .get(`/v1/support/memory/${gdprCustomer}`)
        .set('Authorization', `Bearer ${secretKey}`);

      expect(res.status).toBe(200);
      expect(res.body.memory.length).toBeGreaterThanOrEqual(1);
      expect(res.body.memory.some((f) => f.fact.includes('London'))).toBe(true);
    });

    it('permanently deletes customer memory upon authorized request', async () => {
      const delRes = await request(app)
        .delete(`/v1/support/memory/${gdprCustomer}`)
        .set('Authorization', `Bearer ${secretKey}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Verify memory is completely wiped
      const verifyRes = await request(app)
        .get(`/v1/support/memory/${gdprCustomer}`)
        .set('Authorization', `Bearer ${secretKey}`);

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.memory.length).toBe(0);
    });
  });
});
