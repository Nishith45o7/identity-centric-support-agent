const request = require('supertest');
const { app } = require('../src/app');

describe('Contextis Phase 11 — Developer Integration Experience & Documentation Foundation', () => {
  let cookie;
  let projectId;
  let publicKey;
  let secretKey;

  beforeAll(async () => {
    const email = `phase11-dev-${Date.now()}@contextis.test`;
    const signupRes = await request(app)
      .post('/v1/auth/signup')
      .send({ email, password: 'SecurePassword123!', name: 'Phase 11 Dev' });
    expect(signupRes.status).toBe(201);
    cookie = signupRes.headers['set-cookie'][0].split(';')[0];

    const projRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Dev Experience Project', environment: 'live' });
    expect(projRes.status).toBe(201);
    projectId = projRes.body.project.id;

    // Create public and secret keys
    const pkRes = await request(app)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Public Web Key', keyType: 'public', environment: 'live' });
    publicKey = pkRes.body.key;

    const skRes = await request(app)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Secret Backend Key', keyType: 'secret', environment: 'live' });
    secretKey = skRes.body.key;
  });

  describe('1. Documentation Quality & Interactive Tools', () => {
    it('serves developer documentation containing interactive console and multi-language snippets', async () => {
      const res = await request(app).get('/docs');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Contextis Developer Documentation');
      expect(res.text).toContain('Interactive API Console');
      expect(res.text).toContain('snippet-lang-tabs');
      expect(res.text).toContain('data-lang="curl"');
      expect(res.text).toContain('data-lang="js"');
      expect(res.text).toContain('data-lang="node"');
      expect(res.text).toContain('data-lang="python"');
      expect(res.text).toContain('Outbound Webhooks');
      expect(res.text).toContain('X-Contextis-Signature');
    });

    it('serves OpenAPI 3.0 specification covering core support endpoints', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toMatch(/^3\./);
      expect(res.body.paths['/support/chat']).toBeDefined();
    });
  });

  describe('2. Multi-Language Key Transport Compatibility', () => {
    it('authenticates via x-api-key header (Browser / Client JS pattern)', async () => {
      const res = await request(app)
        .post('/v1/support/chat')
        .set('x-api-key', publicKey)
        .send({
          user_id: 'cust_browser_1',
          message: 'Hello via browser public key',
        });
      expect(res.status).toBe(200);
      expect(res.body.reply).toBeDefined();
      expect(res.body.request_id).toBeDefined();
    });

    it('authenticates via standard Authorization Bearer header (Backend Node/Python/cURL pattern)', async () => {
      const res = await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${secretKey}`)
        .send({
          user_id: 'cust_server_1',
          message: 'Hello via backend secret key',
        });
      expect(res.status).toBe(200);
      expect(res.body.reply).toBeDefined();
      expect(res.body.request_id).toBeDefined();
    });

    it('rejects missing or malformed authentication credentials', async () => {
      const res = await request(app)
        .post('/v1/support/chat')
        .send({
          user_id: 'cust_unauth_1',
          message: 'Unauthenticated message',
        });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_API_KEY');
    });
  });

  describe('3. Visual Environment Separation & Scoping', () => {
    it('strictly prevents accidental mixing by rejecting test environment with live API key', async () => {
      const res = await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${secretKey}`)
        .send({
          user_id: 'cust_test_env_1',
          message: 'Testing sandbox environment separation',
          environment: 'test',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ENVIRONMENT_MISMATCH');
    });

    it('accepts matching live environment with live API key', async () => {
      const res = await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${secretKey}`)
        .send({
          user_id: 'cust_live_env_1',
          message: 'Testing production live environment',
          environment: 'live',
        });
      expect(res.status).toBe(200);
      expect(res.body.reply).toBeDefined();
    });
  });
});
