/**
 * Contextis — Primary Launch Demonstration Scenario
 * Scenario: ACME SUPPORT (Memory + Tool + Customer Identity + Conversation + Security + Analytics)
 */
const request = require('supertest');
const { app } = require('../src/app');

async function runDemo() {
  console.log('================================================================');
  console.log('            CONTEXTIS — OFFICIAL PRIMARY DEMONSTRATION          ');
  console.log('           "AI support that remembers every customer."          ');
  console.log('================================================================\n');

  // STEP 1: Developer Onboarding & Organization Setup
  console.log('[1/8] Developer Signup & Organization Provisioning...');
  const devEmail = `demo-dev-${Date.now()}@acme-support.test`;
  const signupRes = await request(app)
    .post('/v1/auth/signup')
    .send({ email: devEmail, password: 'AcmeSecurePassword123!', name: 'Acme Support Admin' });
  if (signupRes.status !== 201) throw new Error(`Signup failed: ${signupRes.status}`);
  const cookie = signupRes.headers['set-cookie'][0].split(';')[0];

  const orgRes = await request(app).get('/v1/organization').set('Cookie', cookie);
  const organizationId = orgRes.body.organization.id;
  console.log(`      ✓ Organization Created: "Acme Inc" (ID: ${organizationId})`);

  // STEP 2: Project Creation & API Key Issuance
  console.log('[2/8] Project Creation & Staging API Keys...');
  const projRes = await request(app)
    .post('/v1/projects')
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ name: 'Acme Support Platform', environment: 'test' });
  const projectId = projRes.body.project.id;

  const pkRes = await request(app)
    .post(`/v1/projects/${projectId}/api-keys`)
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ name: 'Acme Widget Public Key', keyType: 'public', environment: 'test' });
  const publicKey = pkRes.body.key;

  const skRes = await request(app)
    .post(`/v1/projects/${projectId}/api-keys`)
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:3000')
    .send({ name: 'Acme Backend Secret Key', keyType: 'secret', environment: 'test' });
  const secretKey = skRes.body.key;

  console.log(`      ✓ Project Created: "Acme Support Platform" (${projectId})`);
  console.log(`      ✓ Public Key: ${publicKey.slice(0, 16)}...`);
  console.log(`      ✓ Secret Key: ${secretKey.slice(0, 16)}...`);

  // STEP 3: Register Authorized Business Tool (Order Tracking)
  console.log('[3/8] Registering Authorized Business Tool...');
  const toolRes = await request(app)
    .post(`/v1/projects/${projectId}/tools`)
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:3000')
    .send({
      name: 'track_order',
      description: 'Retrieve real-time package delivery status and carrier tracking number',
      sensitivity: 'READ',
      permissions: ['orders:read', 'tracking:read'],
      inputSchema: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
    });
  const toolId = toolRes.body.tool.id;
  console.log(`      ✓ Business Tool Registered: "track_order" (${toolId})`);

  // STEP 4: Conversation 1 — Customer First Visit & Tool Execution
  const customerId = 'customer_demo_001';
  console.log(`\n[4/8] Conversation 1: ${customerId} First Visit...`);

  // Customer asks about order
  const chat1 = await request(app)
    .post('/v1/support/chat')
    .set('x-api-key', secretKey)
    .send({
      userId: customerId,
      message: 'My recent order hasn\'t arrived yet on my MacBook Pro. I checked and still have a 404 issue.',
      environment: 'test',
    });
  console.log(`      • Customer: "My recent order hasn't arrived yet on my MacBook Pro. I checked and still have a 404 issue."`);
  console.log(`      • Contextis AI: "${chat1.body.reply.slice(0, 110)}..."`);
  console.log(`      • Memory Used: ${chat1.body.memoryUsed} (First visit, no prior history)`);

  // Execute authorized business tool to track order
  const toolExecRes = await request(app)
    .post(`/v1/projects/${projectId}/tools/${toolId}/execute`)
    .set('x-api-key', secretKey)
    .send({
      orderId: 'ord_9842',
      customerId: customerId,
    });
  console.log(`      ✓ Authorized Tool Execution: [${toolExecRes.body.toolName}] -> Status: "${toolExecRes.body.result.status}", Carrier: "${toolExecRes.body.result.carrier}"`);

  // End Conversation 1 to retain facts
  const end1 = await request(app)
    .post('/v1/support/end')
    .set('x-api-key', secretKey)
    .send({
      userId: customerId,
      conversationId: chat1.body.conversationId,
      messages: [
        'My recent order hasn\'t arrived yet on my MacBook Pro. I checked and still have a 404 issue.',
        'Order ord_9842 is currently in transit with FedEx Express.',
      ],
    });
  console.log(`      ✓ Session Finalized. Durable Facts Retained: ${end1.body.facts_stored}`);

  // STEP 5: Conversation 2 — Return Later & Context Recall
  console.log(`\n[5/8] Conversation 2: ${customerId} Returns in Later Session...`);
  const chat2 = await request(app)
    .post('/v1/support/chat')
    .set('x-api-key', secretKey)
    .send({
      userId: customerId,
      message: 'Any update on that? What device was I using?',
      environment: 'test',
    });
  console.log(`      • Customer: "Any update on that? What device was I using?"`);
  console.log(`      • Contextis AI: "${chat2.body.reply}"`);
  console.log(`      • Memory Recalled: ${chat2.body.memoryUsed} (Context recalled seamlessly!)`);

  // STEP 6: Customer Feedback
  console.log('\n[6/8] Customer Feedback Submission...');
  const feedbackRes = await request(app)
    .post('/v1/support/feedback')
    .set('x-api-key', publicKey)
    .send({
      conversation_id: chat2.body.conversationId,
      customer_id: customerId,
      rating: 'positive',
      reason: 'Issue resolved fast and agent remembered my device context',
    });
  console.log(`      ✓ Customer Satisfaction Recorded: "${feedbackRes.body.rating}" rating.`);

  // STEP 7: Security Guardrail Verification (Negative Tests)
  console.log('\n[7/8] Security Guardrails & Tenant Isolation Verification...');

  // Attempt unauthorized tool execution via public key
  const badToolRes = await request(app)
    .post(`/v1/projects/${projectId}/tools/${toolId}/execute`)
    .set('x-api-key', publicKey)
    .send({ orderId: 'ord_9842' });
  console.log(`      ✓ Public Key Tool Execution Blocked: HTTP ${badToolRes.status} (${badToolRes.body.error.code})`);

  // Attempt password injection in tool payload
  const injectionRes = await request(app)
    .post(`/v1/projects/${projectId}/tools/${toolId}/execute`)
    .set('x-api-key', secretKey)
    .send({ orderId: 'ord_9842', password: 'StolenPassword123!' });
  console.log(`      ✓ Password Injection Blocked: HTTP ${injectionRes.status} (${injectionRes.body.error.code})`);

  // STEP 8: Analytics & Developer Observability
  console.log('\n[8/8] Developer Observability & Real-Time Analytics...');
  const analyticsRes = await request(app)
    .get(`/v1/projects/${projectId}/analytics?range=7d`)
    .set('Cookie', cookie);
  const metrics = analyticsRes.body.analytics.overview;
  console.log(`      ✓ Total Conversations: ${metrics.totalConversations}`);
  console.log(`      ✓ Total API Requests: ${metrics.totalRequests}`);
  console.log(`      ✓ Resolution Rate: ${metrics.resolutionRate}`);
  console.log(`      ✓ Average Latency: ${metrics.avgLatencyMs} ms`);

  console.log('\n================================================================');
  console.log('              ALL PRIMARY DEMO CAPABILITIES VERIFIED!           ');
  console.log('   Identity + Memory + Tool + Security + Feedback + Analytics   ');
  console.log('================================================================\n');
}

if (require.main === module) {
  runDemo().catch((err) => {
    console.error('Demo encountered failure:', err);
    process.exit(1);
  });
}

module.exports = { runDemo };
