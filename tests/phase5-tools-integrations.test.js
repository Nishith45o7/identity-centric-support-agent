const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');

describe('Contextis Phase 5 — Tools & Business Integrations', () => {
  let cookie;
  let project;
  let secretKey;

  beforeAll(async () => {
    // 1. Signup developer
    const email = `dev-tools-${crypto.randomUUID()}@contextis.test`;
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Acme Integrations Co', email, password: 'SecurePassword123!' });
    expect(signup.status).toBe(201);
    cookie = signup.headers['set-cookie'][0].split(';')[0];

    // 2. Create project
    const pRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'ERP Integration Hub', environment: 'live' });
    project = pRes.body.project;

    // 3. Create Secret Key
    const skRes = await request(app)
      .post(`/v1/projects/${project.id}/api-keys`)
      .set('Cookie', cookie)
      .send({ name: 'Tool Runner Key', environment: 'live', type: 'secret' });
    secretKey = skRes.body.key;
  });

  describe('1. Tool Templates & Registration', () => {
    test('fetches pre-built business tool templates', async () => {
      const res = await request(app)
        .get(`/v1/projects/${project.id}/tool-templates`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.templates)).toBe(true);
      expect(res.body.templates.some((t) => t.name === 'track_order')).toBe(true);
      expect(res.body.templates.some((t) => t.name === 'send_password_reset')).toBe(true);
    });

    test('registers a new business tool with custom schema and sensitivity tier', async () => {
      const res = await request(app)
        .post(`/v1/projects/${project.id}/tools`)
        .set('Cookie', cookie)
        .send({
          name: 'get_order_details',
          description: 'Fetch order line items and shipping tracking',
          sensitivity: 'READ',
          permissions: ['orders:read'],
          inputSchema: {
            type: 'object',
            properties: {
              orderId: { type: 'string' },
            },
            required: ['orderId'],
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.tool).toBeDefined();
      expect(res.body.tool.name).toBe('get_order_details');
      expect(res.body.tool.sensitivity).toBe('READ');
    });
  });

  describe('2. Tool Execution & Security Guardrails', () => {
    let orderTool;

    beforeAll(async () => {
      const toolRes = await request(app)
        .post(`/v1/projects/${project.id}/tools`)
        .set('Cookie', cookie)
        .send({
          name: 'track_order',
          description: 'Tracks delivery status',
          sensitivity: 'READ',
          permissions: ['orders:read'],
          inputSchema: {
            type: 'object',
            properties: {
              orderId: { type: 'string' },
            },
            required: ['orderId'],
          },
        });
      orderTool = toolRes.body.tool;
    });

    test('executes tool successfully with valid parameters', async () => {
      const res = await request(app)
        .post(`/v1/projects/${project.id}/tools/${orderTool.id}/execute`)
        .set('Authorization', `Bearer ${secretKey}`)
        .send({ orderId: 'ord_12345' });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status).toBe('shipped');
      expect(res.body.result.carrier).toBe('FedEx Express');
    });

    test('strictly rejects tool execution containing password or credentials', async () => {
      const res = await request(app)
        .post(`/v1/projects/${project.id}/tools/${orderTool.id}/execute`)
        .set('Authorization', `Bearer ${secretKey}`)
        .send({ orderId: 'ord_12345', password: 'plainTextPassword!' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SECURITY_VIOLATION');
    });
  });

  describe('3. Business Integrations Management', () => {
    let integrationId;

    test('creates a business API integration with credentials', async () => {
      const res = await request(app)
        .post(`/v1/projects/${project.id}/integrations`)
        .set('Cookie', cookie)
        .send({
          name: 'Shopify Storefront Webhook',
          type: 'webhook',
          config: {
            url: 'https://store.example.com/api/webhooks',
            apiKey: 'shpat_test_key_12345',
            secret: 'shpss_secret_67890',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.integration).toBeDefined();
      expect(res.body.integration.name).toBe('Shopify Storefront Webhook');
      integrationId = res.body.integration.id;
    });

    test('lists integrations with masked secrets in dashboard view', async () => {
      const res = await request(app)
        .get(`/v1/projects/${project.id}/integrations`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.integrations)).toBe(true);
      const found = res.body.integrations.find((i) => i.id === integrationId);
      expect(found).toBeDefined();
      expect(found.config.secret).toBe('••••••••');
    });

    test('tests integration connectivity', async () => {
      const res = await request(app)
        .post(`/v1/projects/${project.id}/integrations/${integrationId}/test`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Shopify Storefront Webhook');
    });

    test('deletes an integration', async () => {
      const res = await request(app)
        .delete(`/v1/projects/${project.id}/integrations/${integrationId}`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
