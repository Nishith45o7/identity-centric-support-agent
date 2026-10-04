const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');
const memoryService = require('../src/services/memory/hindsightMemoryService');

describe('Identity-Centric Support API', () => {
  beforeEach(async () => {
    memoryService.allowRemote = false;
    await memoryService.clear('user_a');
    await memoryService.clear('user_b');
    await memoryService.clear('user_demo_001');
  });

  test('developer signup, login, project creation, one-time API keys, and logout work', async () => {
    const email = `developer-${crypto.randomUUID()}@example.test`;
    const password = 'correct-horse-battery-staple';
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Acme Support', email, password });

    expect(signup.status).toBe(201);
    expect(signup.body.user).toMatchObject({ email, name: 'Acme Support' });
    expect(signup.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect((await request(app).get('/v1/projects')).status).toBe(401);

    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const session = await request(app).get('/v1/auth/session').set('Cookie', cookie);
    expect(session.body.user.email).toBe(email);

    const projectResponse = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'Acme Website' });
    expect(projectResponse.status).toBe(201);
    const project = projectResponse.body.project;

    const keyResponse = await request(app)
      .post(`/v1/projects/${project.id}/api-keys`)
      .set('Cookie', cookie)
      .send({ name: 'Production key', environment: 'live' });
    expect(keyResponse.status).toBe(201);
    expect(keyResponse.body.key).toMatch(/^sk_live_/);

    const keyList = await request(app)
      .get(`/v1/projects/${project.id}/api-keys`)
      .set('Cookie', cookie);
    expect(keyList.status).toBe(200);
    expect(keyList.body.keys[0]).not.toHaveProperty('hash');
    expect(keyList.body.keys[0]).not.toHaveProperty('key');
    expect(keyList.body.keys[0].prefix).toBe(keyResponse.body.metadata.prefix);

    const wrongPassword = await request(app)
      .post('/v1/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(wrongPassword.status).toBe(401);

    await request(app).post('/v1/auth/logout').set('Cookie', cookie).expect(200);
    expect((await request(app).get('/v1/projects').set('Cookie', cookie)).status).toBe(401);
  });

  test('project keys isolate identical customer IDs and ignore caller project IDs', async () => {
    const email = `isolation-${crypto.randomUUID()}@example.test`;
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Isolation Workspace', email, password: 'correct-horse-battery-staple' });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    const projectA = (await request(app).post('/v1/projects').set('Cookie', cookie).send({ name: 'Project A' })).body.project;
    const projectB = (await request(app).post('/v1/projects').set('Cookie', cookie).send({ name: 'Project B' })).body.project;
    const keyA = (await request(app).post(`/v1/projects/${projectA.id}/api-keys`).set('Cookie', cookie).send({ name: 'Key A', environment: 'test' })).body.key;
    const keyB = (await request(app).post(`/v1/projects/${projectB.id}/api-keys`).set('Cookie', cookie).send({ name: 'Key B', environment: 'test' })).body.key;
    const customerId = `customer_${crypto.randomUUID()}`;

    await request(app).post('/v1/support/chat').set('Authorization', `Bearer ${keyA}`).send({
      user_id: customerId, project_id: projectB.id, message: 'I use a Windows laptop and my printer is offline.',
    }).expect(200);
    await request(app).post('/v1/support/end').set('Authorization', `Bearer ${keyA}`).send({
      user_id: customerId, messages: ['I use a Windows laptop and my printer is offline.'],
    }).expect(200);
    await request(app).post('/v1/support/chat').set('Authorization', `Bearer ${keyB}`).send({
      user_id: customerId, message: 'My MacBook login shows error 404.',
    }).expect(200);
    await request(app).post('/v1/support/end').set('Authorization', `Bearer ${keyB}`).send({
      user_id: customerId, messages: ['My MacBook login shows error 404.'],
    }).expect(200);

    const memoryA = await request(app).get(`/v1/support/memory/${customerId}`).set('Authorization', `Bearer ${keyA}`);
    const memoryB = await request(app).get(`/v1/support/memory/${customerId}`).set('Authorization', `Bearer ${keyB}`);
    expect(JSON.stringify(memoryA.body.memory)).toMatch(/Windows|printer/i);
    expect(JSON.stringify(memoryA.body.memory)).not.toMatch(/MacBook|404/i);
    expect(JSON.stringify(memoryB.body.memory)).toMatch(/MacBook|404/i);
    expect(JSON.stringify(memoryB.body.memory)).not.toMatch(/Windows|printer/i);

    const crossProject = await request(app)
      .get(`/v1/projects/${projectB.id}/api-keys`)
      .set('Cookie', (await request(app).post('/v1/auth/signup').send({ name: 'Other', email: `other-${crypto.randomUUID()}@example.test`, password: 'correct-horse-battery-staple' })).headers['set-cookie'][0].split(';')[0]);
    expect(crossProject.status).toBe(404);
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

  test('rejects support requests without project API keys and disables legacy key bootstrap', async () => {
    const supportResponse = await request(app).post('/v1/support/chat').send({ user_id: 'customer_a', message: 'Help' });
    const keyBootstrap = await request(app).post('/v1/developer/keys').send({ name: 'Unowned key' });

    expect(supportResponse.status).toBe(401);
    expect(supportResponse.body.error.code).toBe('INVALID_API_KEY');
    expect(keyBootstrap.status).toBe(404);
  });

  test('requires a developer session to create or list projects', async () => {
    const listResponse = await request(app).get('/v1/projects');
    const createResponse = await request(app).post('/v1/projects').send({ name: 'Unowned project' });
    const legacyTenant = await request(app).post('/v1/developer/tenants').send({ tenantId: 'unowned' });

    expect(listResponse.status).toBe(401);
    expect(createResponse.status).toBe(401);
    expect(legacyTenant.status).toBe(404);
  });

  test('does not serve or persist keys through the legacy file registry API', async () => {
    const listResponse = await request(app).get('/v1/developer/keys');
    const createResponse = await request(app).post('/v1/developer/keys').send({ name: 'Unowned app' });

    expect(listResponse.status).toBe(404);
    expect(createResponse.status).toBe(404);
  });

  test('project usage is visible only to an authenticated project owner', async () => {
    const email = `usage-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Usage workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const project = (await request(app).post('/v1/projects').set('Cookie', cookie).send({ name: 'Usage project' })).body.project;
    const key = (await request(app).post(`/v1/projects/${project.id}/api-keys`).set('Cookie', cookie).send({ name: 'Usage key' })).body.key;
    await request(app).post('/v1/support/chat').set('Authorization', `Bearer ${key}`).send({
      user_id: 'usage_customer', message: 'My printer is offline.',
    }).expect(200);

    const usage = await request(app).get(`/v1/projects/${project.id}/usage`).set('Cookie', cookie);
    const denied = await request(app).get(`/v1/projects/${project.id}/usage`);
    expect(usage.status).toBe(200);
    expect(Number(usage.body.usage.total_requests)).toBeGreaterThanOrEqual(1);
    expect(usage.body.usage).toHaveProperty('memory_operations');
    expect(denied.status).toBe(401);
  });

  test('legacy tenant-bound API keys cannot access project support routes', async () => {
    const response = await request(app)
      .get('/v1/support/memory/customer_123')
      .set('Authorization', 'Bearer sk_test_legacy-key')
      .query({ tenantId: 'tenant_acme' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_API_KEY');
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

  test('project API key revocation blocks later support requests', async () => {
    const email = `revoke-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Revocation workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const project = (await request(app).post('/v1/projects').set('Cookie', cookie).send({ name: 'Revocation project' })).body.project;
    const keyResult = await request(app).post(`/v1/projects/${project.id}/api-keys`).set('Cookie', cookie).send({ name: 'Revocable key' });
    const key = keyResult.body.key;

    const revoked = await request(app)
      .delete(`/v1/projects/${project.id}/api-keys/${keyResult.body.metadata.id}`)
      .set('Cookie', cookie);
    const denied = await request(app).post('/v1/support/chat').set('Authorization', `Bearer ${key}`).send({
      user_id: 'revoke_customer', message: 'Still works?'
    });

    expect(revoked.status).toBe(200);
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('INVALID_API_KEY');
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

    try {
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
        expect.stringContaining(`/v1/default/banks/${memoryService.buildBankId('user_remote')}/memories/recall`),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer hsk_test_123',
            'Content-Type': 'application/json',
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      memoryService.apiKey = originalKey;
      memoryService.allowRemote = originalAllowRemote;
    }

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
