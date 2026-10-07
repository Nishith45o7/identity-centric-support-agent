const request = require('supertest');
const { app } = require('../src/app');
const { query } = require('../src/db');
const memoryService = require('../src/services/memory/hindsightMemoryService');

async function runJourneysAudit() {
  const results = {};
  console.log('=== STARTING CONTEXTIS 6-JOURNEY AUDIT ===\n');

  // JOURNEY 1: Developer Journey
  try {
    const email = `audit-dev-${Date.now()}@contextis.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      email,
      password: 'AuditSecurePassword123!',
      name: 'Audit Developer',
    });
    if (signup.status !== 201) throw new Error(`Signup failed: ${signup.status}`);
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    const orgRes = await request(app).get('/v1/organization').set('Cookie', cookie);
    if (orgRes.status !== 200) throw new Error(`Org fetch failed: ${orgRes.status}`);

    const projRes = await request(app).post('/v1/projects').set('Cookie', cookie).send({
      name: 'Audit Project Dev',
      environment: 'test',
    });
    if (projRes.status !== 201) throw new Error(`Project creation failed: ${projRes.status}`);
    const projectId = projRes.body.project.id;

    const keyRes = await request(app).post(`/v1/projects/${projectId}/api-keys`).set('Cookie', cookie).send({
      name: 'Audit Test Secret Key',
      type: 'secret',
      environment: 'test',
    });
    if (keyRes.status !== 201) throw new Error(`Key creation failed: ${keyRes.status}`);
    const testSecretKey = keyRes.body.key;

    const chatRes = await request(app).post('/v1/support/chat')
      .set('Authorization', `Bearer ${testSecretKey}`)
      .send({
        user_id: 'cust_audit_dev_1',
        message: 'Hello, this is my first test request via developer API key.',
        environment: 'test',
      });
    if (chatRes.status !== 200) throw new Error(`Chat failed: ${chatRes.status}`);

    const usageRes = await request(app).get(`/v1/projects/${projectId}/usage`).set('Cookie', cookie);
    if (usageRes.status !== 200) throw new Error(`Usage fetch failed: ${usageRes.status}`);

    results.journey1_developer = {
      status: 'PASSED',
      details: {
        userId: signup.body.user.id,
        projectId,
        keyPrefix: testSecretKey.slice(0, 15),
        responseId: chatRes.body.request_id,
        requestsRecorded: usageRes.body.usage.requests,
      },
    };
  } catch (err) {
    results.journey1_developer = { status: 'FAILED', error: err.message };
  }

  // JOURNEY 2: Widget Journey
  try {
    const email = `audit-widget-${Date.now()}@contextis.test`;
    const signup = await request(app).post('/v1/auth/signup').send({
      email,
      password: 'AuditSecurePassword123!',
      name: 'Widget Business',
    });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];

    const projRes = await request(app).post('/v1/projects').set('Cookie', cookie).send({
      name: 'Widget Storefront',
      environment: 'live',
    });
    const projectId = projRes.body.project.id;

    const pkRes = await request(app).post(`/v1/projects/${projectId}/api-keys`).set('Cookie', cookie).send({
      name: 'Widget Public Key',
      type: 'public',
      environment: 'live',
    });
    const publicKey = pkRes.body.key;

    const widgetJsRes = await request(app).get('/widget.js');
    if (widgetJsRes.status !== 200) throw new Error('widget.js asset not served');

    const configRes = await request(app).get(`/widget/config?public_key=${publicKey}`);
    if (configRes.status !== 200) throw new Error('widget/config failed');

    const openRes = await request(app).post('/v1/support/opening')
      .set('x-api-key', publicKey)
      .send({ user_id: 'visitor_widget_1', timezone: 'UTC' });
    if (openRes.status !== 200) throw new Error('support/opening failed');

    const chatRes = await request(app).post('/v1/support/chat')
      .set('x-api-key', publicKey)
      .send({ user_id: 'visitor_widget_1', message: 'Hello Contextis widget!' });
    if (chatRes.status !== 200) throw new Error('widget chat failed');
    const convId = chatRes.body.conversation_id;

    // Reload with same identity and conversation
    const reloadRes = await request(app).post('/v1/support/chat')
      .set('x-api-key', publicKey)
      .send({ user_id: 'visitor_widget_1', conversation_id: convId, message: 'I am back.' });
    if (reloadRes.status !== 200) throw new Error('widget continuation failed');

    results.journey2_widget = {
      status: 'PASSED',
      details: {
        publicKeyPrefix: publicKey.slice(0, 15),
        greeting: openRes.body.greeting,
        conversationId: convId,
        continuationSuccess: Boolean(reloadRes.body.reply),
      },
    };
  } catch (err) {
    results.journey2_widget = { status: 'FAILED', error: err.message };
  }

  // JOURNEY 3: Returning Customer Journey & Namespace Isolation
  try {
    const emailA = `audit-custA-${Date.now()}@contextis.test`;
    const signupA = await request(app).post('/v1/auth/signup').send({ email: emailA, password: 'SecurePassword123!', name: 'Org A' });
    const cookieA = signupA.headers['set-cookie'][0].split(';')[0];
    const orgA = (await request(app).get('/v1/organization').set('Cookie', cookieA)).body.organization.id;
    const projA = (await request(app).post('/v1/projects').set('Cookie', cookieA).send({ name: 'Project A', environment: 'live' })).body.project.id;
    const skA = (await request(app).post(`/v1/projects/${projA}/api-keys`).set('Cookie', cookieA).send({ name: 'Key A', type: 'secret', environment: 'live' })).body.key;

    const emailB = `audit-custB-${Date.now()}@contextis.test`;
    const signupB = await request(app).post('/v1/auth/signup').send({ email: emailB, password: 'SecurePassword123!', name: 'Org B' });
    const cookieB = signupB.headers['set-cookie'][0].split(';')[0];
    const projB = (await request(app).post('/v1/projects').set('Cookie', cookieB).send({ name: 'Project B', environment: 'live' })).body.project.id;
    const skB = (await request(app).post(`/v1/projects/${projB}/api-keys`).set('Cookie', cookieB).send({ name: 'Key B', type: 'secret', environment: 'live' })).body.key;

    const customerSharedId = `cust_shared_${Date.now()}`;

    // Seed memory in Project A
    await memoryService.retain(
      customerSharedId,
      [{ category: 'profile', fact: 'VIP Tier Customer based in Munich' }],
      orgA,
      projA,
      'live'
    );

    // Read memory in Project A
    const memARes = await request(app).get(`/v1/support/memory/${customerSharedId}`).set('Authorization', `Bearer ${skA}`);
    if (memARes.status !== 200 || memARes.body.memory.length === 0) throw new Error('Memory A read failed');

    // Attempt to read memory in Project B using same customer ID
    const memBRes = await request(app).get(`/v1/support/memory/${customerSharedId}`).set('Authorization', `Bearer ${skB}`);
    if (memBRes.status !== 200) throw new Error('Memory B call failed');
    if (memBRes.body.memory.length !== 0) throw new Error('Memory cross-leak detected between Project A and B!');

    results.journey3_returning_customer = {
      status: 'PASSED',
      details: {
        customerSharedId,
        projectAMemoryCount: memARes.body.memory.length,
        projectBMemoryCount: memBRes.body.memory.length,
        isolationVerified: true,
      },
    };
  } catch (err) {
    results.journey3_returning_customer = { status: 'FAILED', error: err.message };
  }

  // JOURNEY 4: Tool Journey
  try {
    const email = `audit-tool-${Date.now()}@contextis.test`;
    const signup = await request(app).post('/v1/auth/signup').send({ email, password: 'SecurePassword123!', name: 'Tool Org' });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const proj = (await request(app).post('/v1/projects').set('Cookie', cookie).send({ name: 'Tool Project', environment: 'live' })).body.project.id;
    const sk = (await request(app).post(`/v1/projects/${proj}/api-keys`).set('Cookie', cookie).send({ name: 'Tool Key', type: 'secret', environment: 'live' })).body.key;

    // Create tool
    const toolRes = await request(app).post(`/v1/projects/${proj}/tools`).set('Cookie', cookie).send({
      name: 'track_order',
      description: 'Shipment tracker',
      sensitivity: 'READ',
      permissions: ['orders:read'],
      inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
    });
    const toolId = toolRes.body.tool.id;

    // Authorized execution
    const execOk = await request(app).post(`/v1/projects/${proj}/tools/${toolId}/execute`)
      .set('Authorization', `Bearer ${sk}`)
      .send({ orderId: 'ord_9981' });
    if (execOk.status !== 200) throw new Error(`Authorized tool execution failed: ${execOk.status}`);

    // Unauthorized/Insecure execution (password injection attempt)
    const execInsecure = await request(app).post(`/v1/projects/${proj}/tools/${toolId}/execute`)
      .set('Authorization', `Bearer ${sk}`)
      .send({ orderId: 'ord_9981', password: 'injectedPassword123' });
    if (execInsecure.status !== 400 || execInsecure.body.error.code !== 'SECURITY_VIOLATION') {
      throw new Error(`Insecure tool execution was not blocked properly: ${execInsecure.status}`);
    }

    results.journey4_tool = {
      status: 'PASSED',
      details: {
        toolId,
        authorizedResultStatus: execOk.body.result.status,
        insecureBlockedCode: execInsecure.body.error.code,
      },
    };
  } catch (err) {
    results.journey4_tool = { status: 'FAILED', error: err.message };
  }

  // JOURNEY 5: Human Handoff Journey
  try {
    const email = `audit-handoff-${Date.now()}@contextis.test`;
    const signup = await request(app).post('/v1/auth/signup').send({ email, password: 'SecurePassword123!', name: 'Handoff Org' });
    const cookie = signup.headers['set-cookie'][0].split(';')[0];
    const proj = (await request(app).post('/v1/projects').set('Cookie', cookie).send({ name: 'Handoff Project', environment: 'live' })).body.project.id;
    const pk = (await request(app).post(`/v1/projects/${proj}/api-keys`).set('Cookie', cookie).send({ name: 'PK', type: 'public', environment: 'live' })).body.key;

    // Start conversation
    const chat = await request(app).post('/v1/support/chat')
      .set('x-api-key', pk)
      .send({ user_id: 'cust_escalate_1', message: 'I need human help, my account has been locked.' });
    const convId = chat.body.conversation_id;

    // Escalate
    const escRes = await request(app).post('/v1/support/escalate')
      .set('x-api-key', pk)
      .send({ conversation_id: convId, user_id: 'cust_escalate_1', reason: 'Customer account locked' });
    if (escRes.status !== 200) throw new Error(`Escalate call failed: ${escRes.status}`);
    const escId = escRes.body.id;

    // Admin/support team review list
    const listRes = await request(app).get(`/v1/projects/${proj}/escalations`).set('Cookie', cookie);
    if (listRes.status !== 200) throw new Error(`List escalations failed: ${listRes.status}`);
    const found = listRes.body.escalations.find((e) => e.id === escId);
    if (!found) throw new Error('Created escalation not found in dashboard list');

    // Support team updates status
    const updateRes = await request(app).patch(`/v1/projects/${proj}/escalations/${escId}`)
      .set('Cookie', cookie)
      .send({ status: 'in_progress', assigned_to: 'agent_mark' });
    if (updateRes.status !== 200) throw new Error(`Update escalation failed: ${updateRes.status}`);

    results.journey5_handoff = {
      status: 'PASSED',
      details: {
        escalationId: escId,
        conversationId: convId,
        reason: found.reason,
        dossierContainsContext: found.context_summary.includes('CONTEXTIS ESCALATION DOSSIER'),
        updatedStatus: 'in_progress',
      },
    };
  } catch (err) {
    results.journey5_handoff = { status: 'FAILED', error: err.message };
  }

  // JOURNEY 6: Platform-Admin Journey
  try {
    const adminEmail = `audit-admin-${Date.now()}@contextis.internal`;
    const signupAdmin = await request(app).post('/v1/auth/signup').send({ email: adminEmail, password: 'SecurePassword123!', name: 'Platform Admin' });
    const adminCookie = signupAdmin.headers['set-cookie'][0].split(';')[0];

    const devEmail = `audit-regular-dev-${Date.now()}@regular.test`;
    const signupDev = await request(app).post('/v1/auth/signup').send({ email: devEmail, password: 'SecurePassword123!', name: 'Regular Dev' });
    const devCookie = signupDev.headers['set-cookie'][0].split(';')[0];

    // Admin overview check
    const adminOverview = await request(app).get('/v1/admin/overview').set('Cookie', adminCookie);
    if (adminOverview.status !== 200) throw new Error(`Admin overview failed: ${adminOverview.status}`);

    // Health telemetry check
    const adminHealth = await request(app).get('/v1/admin/health').set('Cookie', adminCookie);
    if (adminHealth.status !== 200) throw new Error(`Admin health failed: ${adminHealth.status}`);

    // Enforce PLATFORM_ADMIN_EMAILS check
    process.env.PLATFORM_ADMIN_EMAILS = adminEmail;
    const devAttempt = await request(app).get('/v1/admin/overview').set('Cookie', devCookie);
    delete process.env.PLATFORM_ADMIN_EMAILS;

    if (devAttempt.status !== 403 || devAttempt.body.error.code !== 'FORBIDDEN') {
      throw new Error(`Regular developer was not forbidden from admin: ${devAttempt.status}`);
    }

    results.journey6_platform_admin = {
      status: 'PASSED',
      details: {
        adminOverviewOrganizations: adminOverview.body.overview.organizationsCount,
        systemHealth: adminHealth.body.health.status,
        regularDevAccessBlocked: true,
      },
    };
  } catch (err) {
    results.journey6_platform_admin = { status: 'FAILED', error: err.message };
  }

  console.log(JSON.stringify(results, null, 2));
  return results;
}

runJourneysAudit().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
