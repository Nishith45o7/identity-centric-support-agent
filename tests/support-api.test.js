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

  test('validates required production secrets before startup', () => {
    const { validateRuntimeConfig } = require('../src/config');

    expect(() => validateRuntimeConfig({
      nodeEnv: 'production',
      apiKeyPepper: '',
      billingWebhookSecret: '',
      supportApiKey: '',
    })).toThrow(/API_KEY_PEPPER|BILLING_WEBHOOK_SECRET|SUPPORT_API_KEY/i);
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

  test('serves a standalone chat widget demo for embedded customer support', async () => {
    const response = await request(app).get('/widget');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Continuity Widget');
    expect(response.text).toContain('customer-support');
  });

  test('serves a reusable embeddable widget script for customers', async () => {
    const response = await request(app).get('/widget.js');

    expect(response.status).toBe(200);
    expect(response.text).toContain('ContinuityWidget');
    expect(response.text).toContain('fetch');
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

  test('project tools can be created, permission-checked, and executed safely', async () => {
    const email = `tools-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Tool workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const project = (await request(app).post('/v1/projects').set('Cookie', cookie).send({ name: 'Tool project' })).body.project;
    const key = (await request(app).post(`/v1/projects/${project.id}/api-keys`).set('Cookie', cookie).send({ name: 'Tool key', environment: 'test' })).body.key;

    const createTool = await request(app)
      .post(`/v1/projects/${project.id}/tools`)
      .set('Cookie', cookie)
      .send({
        name: 'lookup_customer',
        description: 'Look up customer profile data.',
        sensitivity: 'READ',
        permissions: ['customers:read'],
        inputSchema: {
          type: 'object',
          properties: { customerId: { type: 'string' } },
          required: ['customerId'],
        },
      });

    expect(createTool.status).toBe(201);
    expect(createTool.body.tool.name).toBe('lookup_customer');

    const execute = await request(app)
      .post(`/v1/projects/${project.id}/tools/${createTool.body.tool.id}/execute`)
      .set('Authorization', `Bearer ${key}`)
      .send({ customerId: 'cust_demo_123' });

    expect(execute.status).toBe(200);
    expect(execute.body.result.customerId).toBe('cust_demo_123');
    expect(execute.body.result.status).toBe('ok');

    const denied = await request(app)
      .post(`/v1/projects/${project.id}/tools/${createTool.body.tool.id}/execute`)
      .set('Authorization', `Bearer ${key}`)
      .send({});

    expect(denied.status).toBe(400);
  });

  test('organization metadata and members are visible to the workspace owner', async () => {
    const email = `org-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Organization workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const organization = await request(app).get('/v1/organization').set('Cookie', cookie);
    const members = await request(app).get('/v1/organization/members').set('Cookie', cookie);

    expect(organization.status).toBe(200);
    expect(organization.body.organization.name).toMatch(/Workspace/i);
    expect(organization.body.organization.planName).toBe('starter');
    expect(members.status).toBe(200);
    expect(members.body.members.length).toBeGreaterThan(0);
    expect(members.body.members[0].role).toBe('owner');
  });

  test('organization plans expose limits that match the current billing tier', async () => {
    const email = `plan-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Plan workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const organization = await request(app).get('/v1/organization').set('Cookie', cookie);

    expect(organization.status).toBe(200);
    expect(organization.body.organization.plan.name).toBe('starter');
    expect(organization.body.organization.plan.maxProjects).toBeGreaterThan(0);
    expect(organization.body.organization.plan.maxRequestsPer15Min).toBeGreaterThan(0);
  });

  test('organization can update its subscription plan through a billing endpoint', async () => {
    const email = `billing-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Billing workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    const initial = await request(app).get('/v1/organization').set('Cookie', cookie);
    expect(initial.status).toBe(200);
    expect(initial.body.organization.plan.name).toBe('starter');

    const update = await request(app).post('/v1/organization/plan').set('Cookie', cookie).send({ planName: 'growth' });
    expect(update.status).toBe(200);
    expect(update.body.organization.plan.name).toBe('growth');
    expect(update.body.organization.plan.maxRequestsPer15Min).toBeGreaterThan(initial.body.organization.plan.maxRequestsPer15Min);

    const downgrade = await request(app).post('/v1/organization/plan').set('Cookie', cookie).send({ planName: 'starter' });
    expect(downgrade.status).toBe(200);
    expect(downgrade.body.organization.plan.name).toBe('starter');
  });

  test('organization activity log exposes audit events for the workspace', async () => {
    const email = `audit-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Audit workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    const response = await request(app).get('/v1/organization/audit').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.events.length).toBeGreaterThan(0);
    expect(response.body.events[0].action).toMatch(/organization|plan|member|created/i);
  });

  test('organization owners can remove workspace members and revoke access', async () => {
    const ownerEmail = `member-owner-${crypto.randomUUID()}@example.test`;
    const memberEmail = `member-guest-${crypto.randomUUID()}@example.test`;

    const ownerSignup = await request(app).post('/v1/auth/signup').send({
      name: 'Member owner', email: ownerEmail, password: 'correct-horse-battery-staple',
    });
    const ownerCookie = ownerSignup.headers['set-cookie'][0].split(';')[0];

    const memberSignup = await request(app).post('/v1/auth/signup').send({
      name: 'Team member', email: memberEmail, password: 'correct-horse-battery-staple',
    });
    const memberCookie = memberSignup.headers['set-cookie'][0].split(';')[0];

    await request(app).post('/v1/organization/members').set('Cookie', ownerCookie).send({ email: memberEmail, role: 'member' });

    const memberListBefore = await request(app).get('/v1/organization/members').set('Cookie', ownerCookie);
    expect(memberListBefore.status).toBe(200);
    expect(memberListBefore.body.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: memberEmail }),
    ]));

    const remove = await request(app).delete(`/v1/organization/members/${memberSignup.body.user.id}`).set('Cookie', ownerCookie);
    expect(remove.status).toBe(200);
    expect(remove.body.success).toBe(true);

    const memberListAfter = await request(app).get('/v1/organization/members').set('Cookie', ownerCookie);
    expect(memberListAfter.status).toBe(200);
    expect(memberListAfter.body.members).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ email: memberEmail }),
    ]));

    const revokedAccess = await request(app).get('/v1/organization').set('Cookie', memberCookie);
    expect(revokedAccess.status).toBe(401);
  });

  test('organization billing ledger exposes invoice history and event trail', async () => {
    const email = `invoices-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Invoice workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    const createInvoice = await request(app)
      .post('/v1/organization/invoices')
      .set('Cookie', cookie)
      .send({
        invoiceNumber: 'INV-1001',
        amountCents: 2500,
        currency: 'usd',
        description: 'Growth plan monthly invoice',
      });

    expect(createInvoice.status).toBe(201);
    expect(createInvoice.body.invoice.invoiceNumber).toBe('INV-1001');
    expect(createInvoice.body.invoice.amountCents).toBe(2500);

    const invoiceList = await request(app).get('/v1/organization/invoices').set('Cookie', cookie);
    expect(invoiceList.status).toBe(200);
    expect(invoiceList.body.invoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceNumber: 'INV-1001', amountCents: 2500 }),
    ]));

    const events = await request(app).get('/v1/organization/billing-events').set('Cookie', cookie);
    expect(events.status).toBe(200);
    expect(events.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'invoice.created' }),
    ]));
  });

  test('organization billing webhook marks an invoice as paid and records the event', async () => {
    const email = `billing-webhook-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Webhook workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    const invoice = await request(app)
      .post('/v1/organization/invoices')
      .set('Cookie', cookie)
      .send({
        invoiceNumber: 'INV-WEBHOOK-1',
        amountCents: 4200,
        currency: 'usd',
        description: 'Webhook test invoice',
      });

    expect(invoice.status).toBe(201);

    const hooks = await request(app)
      .post('/v1/organization/billing/webhook')
      .set('Cookie', cookie)
      .send({
        eventType: 'invoice.paid',
        invoiceNumber: 'INV-WEBHOOK-1',
        status: 'paid',
      });

    expect(hooks.status).toBe(200);
    expect(hooks.body.success).toBe(true);
    expect(hooks.body.invoiceStatus).toBe('paid');

    const list = await request(app).get('/v1/organization/invoices').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.invoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceNumber: 'INV-WEBHOOK-1', status: 'paid' }),
    ]));
  });

  test('organization billing summary exposes balance, cycle totals, and current plan', async () => {
    const email = `billing-summary-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Summary workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    await request(app)
      .post('/v1/organization/invoices')
      .set('Cookie', cookie)
      .send({ invoiceNumber: 'INV-SUMMARY-1', amountCents: 2100, currency: 'usd', description: 'Initial invoice' });

    await request(app)
      .post('/v1/organization/invoices')
      .set('Cookie', cookie)
      .send({ invoiceNumber: 'INV-SUMMARY-2', amountCents: 6000, currency: 'usd', description: 'Second invoice' });

    await request(app)
      .post('/v1/organization/billing/webhook')
      .set('Cookie', cookie)
      .send({ eventType: 'invoice.paid', invoiceNumber: 'INV-SUMMARY-1', status: 'paid' });

    const summary = await request(app).get('/v1/organization/billing').set('Cookie', cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.billing.planName).toBe('starter');
    expect(summary.body.billing.outstandingBalanceCents).toBe(6000);
    expect(summary.body.billing.paidBalanceCents).toBe(2100);
    expect(summary.body.billing.totalInvoices).toBe(2);
  });

  test('organization usage summary exposes plan limits and current utilization', async () => {
    const email = `usage-summary-${crypto.randomUUID()}@example.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      name: 'Usage Summary workspace', email, password: 'correct-horse-battery-staple',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    const project = (await request(app).post('/v1/projects').set('Cookie', cookie).send({ name: 'Usage Summary project' })).body.project;
    const key = (await request(app).post(`/v1/projects/${project.id}/api-keys`).set('Cookie', cookie).send({ name: 'Usage key', environment: 'live' })).body.key;
    await request(app).post('/v1/support/chat').set('Authorization', `Bearer ${key}`).send({ user_id: 'usage_summary_customer', message: 'Help me with a printer issue.' }).expect(200);

    const summary = await request(app).get('/v1/organization/usage').set('Cookie', cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.usage.planName).toBe('starter');
    expect(summary.body.usage.projectCount).toBeGreaterThanOrEqual(1);
    expect(summary.body.usage.projectLimit).toBe(3);
    expect(summary.body.usage.requestCount).toBeGreaterThanOrEqual(1);
    expect(summary.body.usage.requestLimit).toBe(120);
    expect(summary.body.usage.memberCount).toBeGreaterThanOrEqual(1);
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
