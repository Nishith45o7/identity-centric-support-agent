const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');
const memoryService = require('../src/services/memory/hindsightMemoryService');
const projectToolService = require('../src/services/tool/projectToolService');

describe('Contextis SaaS Platform Capabilities', () => {
  beforeEach(async () => {
    memoryService.allowRemote = false;
  });

  test('full multi-tenant lifecycle: public/secret keys, widget customization, conversation persistence, and admin controls', async () => {
    // 1. Create a business developer account
    const email = `acme-founder-${crypto.randomUUID()}@contextis.test`;
    const password = 'enterprise-grade-password-123';
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Acme Technologies', email, password });

    expect(signup.status).toBe(201);
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    // 2. Create a project
    const projectRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'Acme Online Store', environment: 'live' });
    expect(projectRes.status).toBe(201);
    const project = projectRes.body.project;
    expect(project.id).toBeDefined();

    // 3. Issue a Public Key (pk_live_...) for Chat Widget
    const pubKeyRes = await request(app)
      .post(`/v1/projects/${project.id}/api-keys`)
      .set('Cookie', cookie)
      .send({ name: 'Widget Public Key', environment: 'live', type: 'public' });
    expect(pubKeyRes.status).toBe(201);
    expect(pubKeyRes.body.key).toMatch(/^pk_live_/);
    expect(pubKeyRes.body.metadata.keyType).toBe('public');

    // 4. Issue a Secret Key (sk_live_...) for Server API
    const secKeyRes = await request(app)
      .post(`/v1/projects/${project.id}/api-keys`)
      .set('Cookie', cookie)
      .send({ name: 'Server Secret Key', environment: 'live', type: 'secret' });
    expect(secKeyRes.status).toBe(201);
    expect(secKeyRes.body.key).toMatch(/^sk_live_/);
    expect(secKeyRes.body.metadata.keyType).toBe('secret');
    const secretKey = secKeyRes.body.key;

    // 5. Inspect and update Widget settings
    const widgetGetRes = await request(app)
      .get(`/v1/projects/${project.id}/widget`)
      .set('Cookie', cookie);
    expect(widgetGetRes.status).toBe(200);
    expect(widgetGetRes.body.settings.agentName).toBe('Contextis Support');

    const widgetUpdateRes = await request(app)
      .put(`/v1/projects/${project.id}/widget`)
      .set('Cookie', cookie)
      .send({
        agentName: 'Acme Concierge',
        welcomeMessage: 'Welcome to Acme! How can we assist you?',
        accentColor: '#10b981',
        theme: 'dark',
      });
    expect(widgetUpdateRes.status).toBe(200);
    expect(widgetUpdateRes.body.settings.agentName).toBe('Acme Concierge');
    expect(widgetUpdateRes.body.settings.accentColor).toBe('#10b981');

    // Public widget configuration endpoint
    const pubConfigRes = await request(app)
      .get(`/widget/config?projectId=${project.id}`);
    expect(pubConfigRes.status).toBe(200);
    expect(pubConfigRes.body.settings.agentName).toBe('Acme Concierge');
    expect(pubConfigRes.body.settings.welcomeMessage).toContain('Welcome to Acme');

    // 6. Tool Templates endpoint
    const templatesRes = await request(app)
      .get(`/v1/projects/${project.id}/tool-templates`)
      .set('Cookie', cookie);
    expect(templatesRes.status).toBe(200);
    expect(Array.isArray(templatesRes.body.templates)).toBe(true);
    const hasPasswordReset = templatesRes.body.templates.some((t) => t.name === 'send_password_reset');
    expect(hasPasswordReset).toBe(true);

    // 7. Security: Tool runner safety check must reject passwords/secrets
    const tool = await projectToolService.createProjectTool(signup.body.user.id, project.id, {
      name: 'send_password_reset',
      description: 'Trigger secure reset flow',
      sensitivity: 'SENSITIVE',
      permissions: ['auth:reset'],
    });
    await expect(
      projectToolService.executeProjectTool(project.id, tool.id, {
        email: 'alice@test.com',
        password: 'should_never_be_accepted',
      })
    ).rejects.toThrow(/Security policy violation/);

    // 8. Send Support Chat conversation message
    const convId = `conv_${crypto.randomUUID().slice(0, 8)}`;
    const chatRes = await request(app)
      .post('/v1/support/chat')
      .set('Authorization', `Bearer ${secretKey}`)
      .send({
        userId: 'customer_alice',
        message: 'Where is my order #10842?',
        conversationId: convId,
      });
    expect(chatRes.status).toBe(200);
    expect(chatRes.body.reply).toBeDefined();

    // 9. Verify Conversation and Message History are persisted
    const convListRes = await request(app)
      .get(`/v1/projects/${project.id}/conversations`)
      .set('Cookie', cookie);
    expect(convListRes.status).toBe(200);
    expect(convListRes.body.conversations.length).toBeGreaterThan(0);

    const convDetailRes = await request(app)
      .get(`/v1/projects/${project.id}/conversations/${convId}`)
      .set('Cookie', cookie);
    expect(convDetailRes.status).toBe(200);
    expect(convDetailRes.body.conversation.id).toBe(convId);
    expect(Array.isArray(convDetailRes.body.messages)).toBe(true);
    expect(convDetailRes.body.messages.length).toBeGreaterThanOrEqual(2); // user message + agent response

    // 10. Platform Admin visibility and metrics
    const adminOverview = await request(app)
      .get('/v1/admin/overview')
      .set('Cookie', cookie);
    expect(adminOverview.status).toBe(200);
    expect(adminOverview.body.stats.organizations).toBeGreaterThanOrEqual(1);
    expect(adminOverview.body.stats.health.status).toBe('healthy');

    const adminHealth = await request(app)
      .get('/v1/admin/health')
      .set('Cookie', cookie);
    expect(adminHealth.status).toBe(200);
    expect(adminHealth.body.health.status).toBe('healthy');

    const adminOrgs = await request(app)
      .get('/v1/admin/organizations')
      .set('Cookie', cookie);
    expect(adminOrgs.status).toBe(200);
    const ourOrg = adminOrgs.body.organizations.find((o) => o.id === project.organizationId);
    expect(ourOrg).toBeDefined();
    expect(ourOrg.status).toBe('active');

    const adminUsers = await request(app)
      .get('/v1/admin/users')
      .set('Cookie', cookie);
    expect(adminUsers.status).toBe(200);
    expect(adminUsers.body.users.some((u) => u.email === email)).toBe(true);

    const adminAudit = await request(app)
      .get('/v1/admin/audit')
      .set('Cookie', cookie);
    expect(adminAudit.status).toBe(200);
    expect(Array.isArray(adminAudit.body.auditLogs)).toBe(true);

    // 11. Platform Admin Tenant Suspension
    const suspendRes = await request(app)
      .patch(`/v1/admin/organizations/${project.organizationId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'suspended' });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.organization.status).toBe('suspended');

    // Suspended organization's API keys must be rejected
    const blockedChatRes = await request(app)
      .post('/v1/support/chat')
      .set('Authorization', `Bearer ${secretKey}`)
      .send({
        userId: 'customer_alice',
        message: 'Hello, are you there?',
        conversationId: convId,
      });
    expect(blockedChatRes.status).toBe(403);
    expect(blockedChatRes.body.error.code).toBe('ORGANIZATION_SUSPENDED');

    // Reactivate organization
    const reactivateRes = await request(app)
      .patch(`/v1/admin/organizations/${project.organizationId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'active' });
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.organization.status).toBe('active');

    // Chat resumes cleanly
    const resumedChatRes = await request(app)
      .post('/v1/support/chat')
      .set('Authorization', `Bearer ${secretKey}`)
      .send({
        userId: 'customer_alice',
        message: 'I am back now!',
        conversationId: convId,
      });
    expect(resumedChatRes.status).toBe(200);
    expect(resumedChatRes.body.reply).toBeDefined();
  }, 30000);
});
