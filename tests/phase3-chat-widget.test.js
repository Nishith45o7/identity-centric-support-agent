const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');

describe('Contextis Phase 3 — Embeddable Chat Widget & Security', () => {
  let cookie;
  let project;
  let publicKey;
  let secretKey;

  beforeAll(async () => {
    // 1. Signup developer
    const email = `dev-widget-${crypto.randomUUID()}@contextis.test`;
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Acme Widget Inc', email, password: 'Strong-Password-123!' });
    expect(signup.status).toBe(201);
    cookie = signup.headers['set-cookie'][0].split(';')[0];

    // 2. Create project
    const pRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'E-Commerce Website', environment: 'live' });
    project = pRes.body.project;

    // 3. Create Public Key (pk_live_...) for browser widget
    const pkRes = await request(app)
      .post(`/v1/projects/${project.id}/api-keys`)
      .set('Cookie', cookie)
      .send({ name: 'Web Chat Widget', environment: 'live', type: 'public' });
    publicKey = pkRes.body.key;

    // 4. Create Secret Key (sk_live_...) for server-to-server
    const skRes = await request(app)
      .post(`/v1/projects/${project.id}/api-keys`)
      .set('Cookie', cookie)
      .send({ name: 'Server Backend', environment: 'live', type: 'secret' });
    secretKey = skRes.body.key;
  });

  describe('1. Widget Configuration & Settings', () => {
    test('retrieves default widget settings for project', async () => {
      const res = await request(app)
        .get(`/v1/projects/${project.id}/widget`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.settings).toBeDefined();
      expect(res.body.settings.agentName).toBe('Contextis Support');
      expect(res.body.settings.accentColor).toBe('#38bdf8');
    });

    test('updates widget appearance and behavior settings', async () => {
      const res = await request(app)
        .put(`/v1/projects/${project.id}/widget`)
        .set('Cookie', cookie)
        .send({
          agentName: 'Acme Virtual Assistant',
          welcomeMessage: 'Welcome to Acme Store! How can we help?',
          accentColor: '#10b981',
          position: 'bottom-left',
          theme: 'light',
          placeholder: 'Ask anything about your order...',
          allowedDomains: 'example.com,store.example.com',
        });

      expect(res.status).toBe(200);
      expect(res.body.settings.agentName).toBe('Acme Virtual Assistant');
      expect(res.body.settings.accentColor).toBe('#10b981');
      expect(res.body.settings.position).toBe('bottom-left');
      expect(res.body.settings.theme).toBe('light');
    });

    test('public endpoint /widget/config returns configuration using public key', async () => {
      const res = await request(app)
        .get(`/widget/config?project_id=${project.id}&public_key=${publicKey}`);

      expect(res.status).toBe(200);
      expect(res.body.settings).toBeDefined();
      expect(res.body.settings.agentName).toBe('Acme Virtual Assistant');
    });
  });

  describe('2. Widget Security & Key Privilege Boundary', () => {
    test('public key (pk_*) can successfully dispatch support chat requests', async () => {
      const res = await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${publicKey}`)
        .send({
          user_id: 'cust_browser_anon_1',
          message: 'Can I track my package?',
          metadata: { source: 'chat-widget' },
        });

      expect(res.status).toBe(200);
      expect(res.body.response).toBeDefined();
      expect(res.body.conversation_id).toBeDefined();
    });

    test('public key (pk_*) is strictly FORBIDDEN from reading raw customer memory', async () => {
      const res = await request(app)
        .get('/v1/support/memory/cust_browser_anon_1')
        .set('Authorization', `Bearer ${publicKey}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('public key (pk_*) is strictly FORBIDDEN from deleting customer memory', async () => {
      const res = await request(app)
        .delete('/v1/support/memory/cust_browser_anon_1')
        .set('Authorization', `Bearer ${publicKey}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('secret key (sk_*) has privilege to read customer memory', async () => {
      const res = await request(app)
        .get('/v1/support/memory/cust_browser_anon_1')
        .set('Authorization', `Bearer ${secretKey}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.memory)).toBe(true);
    });
  });

  describe('3. Unified Support Engine Verification', () => {
    test('widget interactions persist to project conversation history', async () => {
      const customerId = `cust_widget_persistent_${crypto.randomUUID().slice(0, 8)}`;
      const chatRes = await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${publicKey}`)
        .send({
          user_id: customerId,
          message: 'My shipping address is 123 Tech Way, Suite 400.',
        });

      expect(chatRes.status).toBe(200);
      const convId = chatRes.body.conversation_id;

      // Developer inspects conversations from dashboard
      const convRes = await request(app)
        .get(`/v1/projects/${project.id}/conversations/${convId}`)
        .set('Cookie', cookie);

      expect(convRes.status).toBe(200);
      expect(convRes.body.conversation).toBeDefined();
      expect(convRes.body.messages.length).toBeGreaterThanOrEqual(2);
      expect(convRes.body.messages[0].content).toContain('123 Tech Way');
    });
  });
});
