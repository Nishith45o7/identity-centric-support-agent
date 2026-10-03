const request = require('supertest');
const { app } = require('../src/app');
const memoryService = require('../src/services/memory/hindsightMemoryService');

describe('Identity-Centric Support API', () => {
  beforeEach(async () => {
    await memoryService.clear('user_a');
    await memoryService.clear('user_b');
    await memoryService.clear('user_demo_001');
  });

  test('server retries on a free port when the default port is busy', () => {
    const { startServer } = require('../src/server');
    const listeners = [];
    const app = { listen: jest.fn((port, callback) => {
      listeners.push({ port, callback });
      if (listeners.length === 1) {
        const error = new Error('EADDRINUSE');
        error.code = 'EADDRINUSE';
        const server = { on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(error);
          }
        }) };
        return server;
      }
      callback();
      return { on: jest.fn() };
    }) };

    const server = startServer(app, 3000);
    expect(app.listen).toHaveBeenCalledTimes(2);
    expect(app.listen.mock.calls[0][0]).toBe(3000);
    expect(app.listen.mock.calls[1][0]).toBe(3001);
    expect(server).toBeDefined();
  });

  test('registers graceful shutdown handlers for SIGINT and SIGTERM', async () => {
    const { registerGracefulShutdown } = require('../src/server');
    const originalOn = process.on;
    const originalExit = process.exit;
    const handlers = {};
    const close = jest.fn((callback) => callback && callback());
    const server = { close };

    process.on = jest.fn((signal, handler) => {
      handlers[signal] = handler;
    });
    process.exit = jest.fn();

    registerGracefulShutdown(server);

    expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    handlers.SIGINT();
    expect(close).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(process.exit).toHaveBeenCalledWith(0);

    process.on = originalOn;
    process.exit = originalExit;
  });

  test('creates a developer API key and lists it in v1', async () => {
    const createResponse = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Web app', environment: 'test' });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.key).toMatch(/^sk_test_/);
    expect(createResponse.body.metadata).toMatchObject({
      name: 'Web app',
      environment: 'test',
      status: 'active',
    });

    const listResponse = await request(app).get('/v1/developer/keys');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.keys.length).toBeGreaterThan(0);
  });

  test('creates and lists tenants with tenant-bound developer keys', async () => {
    const tenantResponse = await request(app)
      .post('/v1/developer/tenants')
      .send({ tenantId: 'tenant_omega', name: 'Omega Labs', ownerEmail: 'ops@omegalabs.example' });

    expect(tenantResponse.status).toBe(200);
    expect(tenantResponse.body.tenant.tenantId).toBe('tenant_omega');
    expect(tenantResponse.body.tenant.name).toBe('Omega Labs');

    const keyResponse = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Omega agent', environment: 'test', tenantId: 'tenant_omega' });

    expect(keyResponse.status).toBe(200);
    expect(keyResponse.body.metadata.tenantId).toBe('tenant_omega');

    const tenants = await request(app).get('/v1/developer/tenants');
    expect(tenants.status).toBe(200);
    expect(tenants.body.tenants.some((tenant) => tenant.tenantId === 'tenant_omega')).toBe(true);
  });

  test('persists developer API keys on disk so the registry survives restarts', async () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../data/api-keys.json');

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const createResponse = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Persistent app', environment: 'test' });

    expect(createResponse.status).toBe(200);

    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted.some((entry) => entry.name === 'Persistent app')).toBe(true);
  });

  test('exposes a developer summary and audit trail for tenant operations', async () => {
    const tenantResponse = await request(app)
      .post('/v1/developer/tenants')
      .send({ tenantId: 'tenant_audit', name: 'Audit Tenant', ownerEmail: 'ops@audit.example' });

    expect(tenantResponse.status).toBe(200);

    const keyResponse = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Audit Agent', environment: 'test', tenantId: 'tenant_audit' });

    expect(keyResponse.status).toBe(200);

    const summaryResponse = await request(app).get('/v1/developer/summary');
    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.summary).toHaveProperty('tenantCount');
    expect(summaryResponse.body.summary).toHaveProperty('activeKeyCount');
    expect(summaryResponse.body.summary.tenantCount).toBeGreaterThanOrEqual(1);

    const auditResponse = await request(app).get('/v1/developer/audit');
    expect(auditResponse.status).toBe(200);
    expect(Array.isArray(auditResponse.body.events)).toBe(true);
    expect(auditResponse.body.events.length).toBeGreaterThan(0);
  });

  test('isolates memory across tenants for the same customer id', async () => {
    const keyA = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Tenant A', environment: 'test', tenantId: 'tenant_acme' });

    const keyB = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Tenant B', environment: 'test', tenantId: 'tenant_shopx' });

    await request(app)
      .post('/v1/support/chat')
      .set('Authorization', `Bearer ${keyA.body.key}`)
      .send({ tenantId: 'tenant_acme', user_id: 'customer_123', message: 'My MacBook Pro login returns 404 after reset.' });

    await request(app)
      .post('/v1/support/end')
      .set('Authorization', `Bearer ${keyA.body.key}`)
      .send({ tenantId: 'tenant_acme', user_id: 'customer_123', messages: ['My MacBook Pro login returns 404 after reset.'] });

    const tenantARecall = await request(app)
      .get('/v1/support/memory/customer_123')
      .set('Authorization', `Bearer ${keyA.body.key}`)
      .query({ tenantId: 'tenant_acme' });

    const tenantBRecall = await request(app)
      .get('/v1/support/memory/customer_123')
      .set('Authorization', `Bearer ${keyB.body.key}`)
      .query({ tenantId: 'tenant_shopx' });

    expect(tenantARecall.status).toBe(200);
    expect(tenantBRecall.status).toBe(200);
    expect(JSON.stringify(tenantARecall.body.memory)).toMatch(/MacBook Pro|404/i);
    expect(JSON.stringify(tenantBRecall.body.memory)).not.toMatch(/MacBook Pro|404/i);
  });

  test('GET /api/health returns healthy response', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.service).toBe('identity-centric-support');
    expect(response.body).toHaveProperty('nodeEnv');
    expect(response.body).toHaveProperty('port');
    expect(response.body).toHaveProperty('memoryMode');
    expect(response.body).toHaveProperty('hindsightConfigured');
    expect(response.body).toHaveProperty('groqConfigured');
    expect(response.body).toHaveProperty('version');
    expect(response.body).toHaveProperty('uptimeSeconds');
    expect(typeof response.body.hindsightConfigured).toBe('boolean');
    expect(typeof response.body.groqConfigured).toBe('boolean');
    expect(typeof response.body.version).toBe('string');
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  test('rejects empty messages', async () => {
    const response = await request(app)
      .post('/api/support/chat')
      .send({ userId: 'user_a', message: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('requires an API key for support routes when configured', async () => {
    const { config } = require('../src/config');
    const originalKey = config.supportApiKey;
    config.supportApiKey = 'support-secret';

    const response = await request(app)
      .post('/api/support/chat')
      .send({ userId: 'user_a', message: 'I need help with my login' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');

    const authed = await request(app)
      .post('/api/support/chat')
      .set('x-api-key', 'support-secret')
      .send({ userId: 'user_a', message: 'I need help with my login' });

    expect(authed.status).toBe(200);
    config.supportApiKey = originalKey;
  });

  test('serves readiness and liveness probes for orchestration', async () => {
    const ready = await request(app).get('/api/ready');
    const live = await request(app).get('/api/live');

    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');
    expect(ready.body).toHaveProperty('version');
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('alive');
    expect(live.body).toHaveProperty('uptimeSeconds');
  });

  test('adds a request id to API responses for tracing', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body.requestId.length).toBeGreaterThan(10);
  });

  test('exposes an OpenAPI contract for the API', async () => {
    const response = await request(app).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.0');
    expect(response.body.info.title).toBe('Identity-Centric Support Agent API');
    expect(response.body.paths['/health']).toBeDefined();
    expect(response.body.paths['/support/chat']).toBeDefined();
  });

  test('serves a browser-friendly Swagger UI page for the API contract', async () => {
    const response = await request(app).get('/docs');

    expect(response.status).toBe(200);
    expect(response.text).toContain('SwaggerUIBundle');
    expect(response.text).toContain('/api/openapi.json');
  });

  test('serves a developer dashboard for tenant and key management', async () => {
    const response = await request(app).get('/developer');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Developer Dashboard');
    expect(response.text).toContain('/v1/developer/summary');
    expect(response.text).toContain('Create Tenant');
  });

  test('enforces developer roles for read-only versus admin-only actions', async () => {
    const adminKey = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Admin Console', environment: 'test', role: 'admin' });

    const viewerKey = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Viewer Console', environment: 'test', role: 'viewer' });

    const summary = await request(app)
      .get('/v1/developer/summary')
      .set('Authorization', `Bearer ${viewerKey.body.key}`);

    expect(summary.status).toBe(200);

    const deny = await request(app)
      .post('/v1/developer/keys')
      .set('Authorization', `Bearer ${viewerKey.body.key}`)
      .send({ name: 'Blocked Key', environment: 'test' });

    expect(deny.status).toBe(403);
    expect(deny.body.error.code).toBe('FORBIDDEN');

    const allow = await request(app)
      .post('/v1/developer/keys')
      .set('Authorization', `Bearer ${adminKey.body.key}`)
      .send({ name: 'Allowed Key', environment: 'test' });

    expect(allow.status).toBe(200);
  });

  test('allows admins to update key roles and tenant metadata', async () => {
    const adminKey = await request(app)
      .post('/v1/developer/keys')
      .send({ name: 'Admin Manager', environment: 'test', tenantId: 'tenant_admin_ops', role: 'admin' });

    const tenant = await request(app)
      .post('/v1/developer/tenants')
      .set('Authorization', `Bearer ${adminKey.body.key}`)
      .send({ tenantId: 'tenant_admin_ops', name: 'Ops Tenant', ownerEmail: 'ops@tenant.example' });

    expect(tenant.status).toBe(200);

    const keyList = await request(app)
      .get('/v1/developer/keys')
      .set('Authorization', `Bearer ${adminKey.body.key}`);

    const createdKey = keyList.body.keys.find((entry) => entry.name === 'Admin Manager');
    expect(createdKey).toBeTruthy();

    const roleUpdate = await request(app)
      .patch(`/v1/developer/keys/${createdKey.id}/role`)
      .set('Authorization', `Bearer ${adminKey.body.key}`)
      .send({ role: 'viewer' });

    expect(roleUpdate.status).toBe(200);
    expect(roleUpdate.body.metadata.role).toBe('viewer');

    const tenantUpdate = await request(app)
      .patch('/v1/developer/tenants/tenant_admin_ops')
      .set('Authorization', `Bearer ${adminKey.body.key}`)
      .send({ name: 'Ops Tenant Updated', ownerEmail: 'ops+new@tenant.example' });

    expect(tenantUpdate.status).toBe(200);
    expect(tenantUpdate.body.tenant.name).toBe('Ops Tenant Updated');
    expect(tenantUpdate.body.tenant.ownerEmail).toBe('ops+new@tenant.example');
  });

  test('retains and recalls facts for the same user', async () => {
    const first = await request(app)
      .post('/api/support/chat')
      .send({ userId: 'user_demo_001', message: 'I use a MacBook Pro and I am getting a 404 login error. I already reset my password and it did not work.' });

    expect(first.status).toBe(200);

    const end = await request(app)
      .post('/api/support/end')
      .send({
        userId: 'user_demo_001',
        messages: [
          'I use a MacBook Pro and I am getting a 404 login error. I already reset my password and it did not work.',
        ],
      });

    expect(end.status).toBe(200);
    expect(end.body.factsStored).toBeGreaterThan(0);

    const recall = await request(app)
      .get('/api/support/memory')
      .query({ userId: 'user_demo_001' });

    expect(recall.status).toBe(200);
    expect(JSON.stringify(recall.body.memory)).toMatch(/MacBook Pro|404|password/i);
  });

  test('supports memory off mode as a stateless baseline', async () => {
    const first = await request(app)
      .post('/api/support/chat')
      .send({ userId: 'user_demo_001', message: 'I use a MacBook Pro and received a 404 login error.' });

    await request(app)
      .post('/api/support/end')
      .send({
        userId: 'user_demo_001',
        messages: ['I use a MacBook Pro and received a 404 login error.'],
      });

    const second = await request(app)
      .post('/api/support/chat')
      .send({ userId: 'user_demo_001', message: 'The problem is still happening.', memoryMode: 'off' });

    expect(second.status).toBe(200);
    expect(second.body.memoryUsed).toBe(false);
  });

  test('uses the live Hindsight API when configured', async () => {
    const originalFetch = global.fetch;
    const originalKey = memoryService.apiKey;
    const originalAllowRemote = memoryService.allowRemote;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ text: 'MacBook Pro login issue', type: 'experience' }] }),
      headers: {
        get: () => 'application/json',
      },
    });
    memoryService.apiKey = 'hsk_test_123';
    memoryService.allowRemote = true;

    const result = await memoryService.recall('user_remote', 'login issue');

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'experience',
          fact: 'MacBook Pro login issue',
        }),
      ]),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/default/banks/user_user_remote/memories/recall'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer hsk_test_123',
          'Content-Type': 'application/json',
        }),
      }),
    );

    global.fetch = originalFetch;
    memoryService.apiKey = originalKey;
    memoryService.allowRemote = originalAllowRemote;
  });

  test('isolates memory between users', async () => {
    await request(app)
      .post('/api/support/end')
      .send({
        userId: 'user_a',
        messages: ['I use a ThinkPad and have a printer issue.'],
      });

    await request(app)
      .post('/api/support/end')
      .send({
        userId: 'user_b',
        messages: ['I use a MacBook and have a login issue.'],
      });

    const userA = await request(app).get('/api/support/memory').query({ userId: 'user_a' });
    const userB = await request(app).get('/api/support/memory').query({ userId: 'user_b' });

    expect(JSON.stringify(userA.body.memory)).toMatch(/ThinkPad|printer/i);
    expect(JSON.stringify(userA.body.memory)).not.toMatch(/MacBook|login/i);
    expect(JSON.stringify(userB.body.memory)).toMatch(/MacBook|login/i);
    expect(JSON.stringify(userB.body.memory)).not.toMatch(/ThinkPad|printer/i);
  });

  test('does not retain sensitive fields such as passwords or tokens', async () => {
    const response = await request(app)
      .post('/api/support/end')
      .send({
        userId: 'user_demo_001',
        messages: ['My password is secret123 and token is abc123xyz.'],
      });

    expect(response.status).toBe(200);
    const memory = await request(app).get('/api/support/memory').query({ userId: 'user_demo_001' });
    expect(JSON.stringify(memory.body.memory)).not.toMatch(/secret123|abc123xyz|password/i);
  });
});
