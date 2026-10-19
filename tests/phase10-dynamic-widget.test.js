const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');
const { query } = require('../src/db');
const memoryService = require('../src/services/memory/hindsightMemoryService');

describe('Contextis Phase 10 — Dynamic Intelligent Chat Widget & Conversation Experience Engine', () => {
  let cookie;
  let organizationId;
  let projectId;
  let publicKey;
  let secretKey;
  const testCustomer = `cust_phase10_${Date.now()}`;

  beforeAll(async () => {
    // 1. Setup Developer & Project
    const email = `widget-dev-${Date.now()}@contextis.test`;
    const signupRes = await request(app)
      .post('/v1/auth/signup')
      .send({ email, password: 'SecurePassword123!', name: 'Widget Test Dev' });
    expect(signupRes.status).toBe(201);
    cookie = signupRes.headers['set-cookie'][0].split(';')[0];

    const orgRes = await request(app).get('/v1/organization').set('Cookie', cookie);
    organizationId = orgRes.body.organization.id;

    const projRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Acme Widget App', environment: 'live' });
    expect(projRes.status).toBe(201);
    projectId = projRes.body.project.id;

    // 2. Generate Public Key (pk_*) and Secret Key (sk_*)
    const pkRes = await request(app)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Public Browser Key', keyType: 'public', environment: 'live' });
    expect(pkRes.status).toBe(201);
    publicKey = pkRes.body.key;
    expect(publicKey).toMatch(/^pk_live_/);

    const skRes = await request(app)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Secret Backend Key', keyType: 'secret', environment: 'live' });
    expect(skRes.status).toBe(201);
    secretKey = skRes.body.key;
    expect(secretKey).toMatch(/^sk_live_/);
  });

  describe('1. Dynamic Opening Context & Time-Aware Salutation', () => {
    it('generates first-time visitor greeting with morning salutation for morning timezone', async () => {
      const res = await request(app)
        .post('/v1/support/opening')
        .set('x-api-key', publicKey)
        .send({
          user_id: 'new_visitor_123',
          timezone: 'America/Chicago',
        });

      expect(res.status).toBe(200);
      expect(res.body.customerType).toBe('first_time');
      expect(res.body.greeting).toContain('Welcome to Acme Widget App support');
      expect(Array.isArray(res.body.suggestedActions)).toBe(true);
      expect(res.body.suggestedActions.length).toBeGreaterThan(0);
    });

    it('prioritizes returning customer context and remembered facts', async () => {
      // Seed durable memory for customer
      await memoryService.retain(
        testCustomer,
        [
          { category: 'device', fact: 'MacBook Pro 16-inch M3' },
          { category: 'identity', fact: 'Alex Mercer' },
        ],
        organizationId,
        projectId,
        'live'
      );

      // Create customer record in project
      const recNow = new Date().toISOString();
      await query(
        `INSERT INTO customers (id, project_id, external_user_id, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
        [`cust_rec_${Date.now()}`, projectId, testCustomer, recNow, recNow]
      );

      const res = await request(app)
        .post('/v1/support/opening')
        .set('x-api-key', publicKey)
        .send({
          user_id: testCustomer,
          timezone: 'America/New_York',
        });

      expect(res.status).toBe(200);
      expect(res.body.customerType).toBe('returning');
      expect(res.body.customerName).toBe('Alex Mercer');
      expect(res.body.greeting).toContain('Alex Mercer');
      expect(res.body.contextSummary.hasMemory).toBe(true);
    });

    it('prioritizes unresolved issue in opening greeting over generic greeting', async () => {
      const customerWithIssue = `cust_issue_${Date.now()}`;
      const custDbId = `cust_db_${Date.now()}`;
      const nowStr = new Date().toISOString();
      await query(
        `INSERT INTO customers (id, project_id, external_user_id, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
        [custDbId, projectId, customerWithIssue, nowStr, nowStr]
      );

      const convId = `conv_open_${Date.now()}`;
      await query(
        `INSERT INTO conversations (id, project_id, customer_id, status, resolution_status, escalation_reason, created_at, updated_at)
         VALUES (?, ?, ?, 'open', 'unresolved', 'login failure on Safari', ?, ?)`,
        [convId, projectId, custDbId, nowStr, nowStr]
      );

      const res = await request(app)
        .post('/v1/support/opening')
        .set('x-api-key', publicKey)
        .send({
          user_id: customerWithIssue,
        });

      expect(res.status).toBe(200);
      expect(res.body.customerType).toBe('returning');
      expect(res.body.greeting).toContain('login failure on Safari');
      expect(res.body.suggestedActions.some((a) => a.id === 'action_continue_issue')).toBe(true);
    });
  });

  describe('2. Browser Public Key Security Boundaries', () => {
    it('allows public key to send opening, chat, and feedback requests', async () => {
      const openRes = await request(app)
        .post('/v1/support/opening')
        .set('x-api-key', publicKey)
        .send({ user_id: 'pub_user_1' });
      expect(openRes.status).toBe(200);

      const chatRes = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', publicKey)
        .send({ user_id: 'pub_user_1', message: 'Hello Contextis widget!' });
      expect(chatRes.status).toBe(200);
      expect(chatRes.body.conversation_id).toBeDefined();
    });

    it('strictly forbids public key from accessing internal memory management', async () => {
      const memRes = await request(app)
        .get(`/v1/support/memory/${testCustomer}`)
        .set('x-api-key', publicKey);
      expect(memRes.status).toBe(403);
      expect(memRes.body.error.code).toBe('FORBIDDEN');

      const delRes = await request(app)
        .delete(`/v1/support/memory/${testCustomer}`)
        .set('x-api-key', publicKey);
      expect(delRes.status).toBe(403);
      expect(delRes.body.error.code).toBe('FORBIDDEN');
    });

    it('allows secret key to access memory endpoints', async () => {
      const memRes = await request(app)
        .get(`/v1/support/memory/${testCustomer}`)
        .set('x-api-key', secretKey);
      expect(memRes.status).toBe(200);
      expect(Array.isArray(memRes.body.memory)).toBe(true);
    });
  });

  describe('3. Customer Feedback Engine', () => {
    let conversationId;

    beforeAll(async () => {
      const chatRes = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', publicKey)
        .send({ user_id: testCustomer, message: 'I need to check feedback recording.' });
      conversationId = chatRes.body.conversation_id;
    });

    it('records positive rating', async () => {
      const res = await request(app)
        .post('/v1/support/feedback')
        .set('x-api-key', publicKey)
        .send({
          conversation_id: conversationId,
          customer_id: testCustomer,
          rating: 'positive',
        });

      expect(res.status).toBe(200);
      expect(res.body.rating).toBe('positive');
      expect(res.body.id).toMatch(/^fbk_/);
    });

    it('records negative rating with reason category', async () => {
      const res = await request(app)
        .post('/v1/support/feedback')
        .set('x-api-key', publicKey)
        .send({
          conversation_id: conversationId,
          customer_id: testCustomer,
          rating: 'negative',
          reason: 'Did not solve my issue',
          comment: 'The solution suggested did not apply to my version.',
        });

      expect(res.status).toBe(200);
      expect(res.body.rating).toBe('negative');
      expect(res.body.reason).toBe('Did not solve my issue');
    });

    it('rejects invalid rating types', async () => {
      const res = await request(app)
        .post('/v1/support/feedback')
        .set('x-api-key', publicKey)
        .send({
          conversation_id: conversationId,
          rating: 'maybe',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('4. Human Escalation & Context Dossier Handoff', () => {
    let convToEscalate;

    beforeAll(async () => {
      const chatRes = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', publicKey)
        .send({
          user_id: testCustomer,
          message: 'My issue is too complex and billing is failing. I need a human.',
        });
      convToEscalate = chatRes.body.conversation_id;
    });

    it('escalates conversation preserving memory, messages, and dossier', async () => {
      const res = await request(app)
        .post('/v1/support/escalate')
        .set('x-api-key', publicKey)
        .send({
          conversation_id: convToEscalate,
          user_id: testCustomer,
          reason: 'Customer requested human support',
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toMatch(/^esc_/);
      expect(res.body.status).toBe('requested');
      expect(res.body.contextSummary).toContain('CONTEXTIS ESCALATION DOSSIER');
      expect(res.body.contextSummary).toContain(testCustomer);

      // Verify conversation status updated in database
      const { rows } = await query(
        `SELECT status, resolution_status, escalation_reason FROM conversations WHERE id = ?`,
        [convToEscalate]
      );
      expect(rows[0].resolution_status).toBe('escalated');
      expect(rows[0].escalation_reason).toBe('Customer requested human support');
    });
  });
});
