const request = require('supertest');
const { app } = require('../src/app');

describe('Contextis Final Launch Sprint — Primary Launch Demonstration Scenario', () => {
  it('executes the full end-to-end lifecycle: developer setup -> widget -> memory -> tool -> feedback -> analytics', async () => {
    // 1. Developer Signup & Organization
    const devEmail = `launch-dev-${Date.now()}@acme-launch.test`;
    const signupRes = await request(app)
      .post('/v1/auth/signup')
      .send({ email: devEmail, password: 'LaunchSecurePassword123!', name: 'Launch Lead' });
    expect(signupRes.status).toBe(201);
    const cookie = signupRes.headers['set-cookie'][0].split(';')[0];

    // 2. Project Creation & Keys
    const projRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Acme Launch Support', environment: 'test' });
    expect(projRes.status).toBe(201);
    const projectId = projRes.body.project.id;

    const pkRes = await request(app)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Launch Public Key', keyType: 'public', environment: 'test' });
    expect(pkRes.status).toBe(201);
    const publicKey = pkRes.body.key;

    const skRes = await request(app)
      .post(`/v1/projects/${projectId}/api-keys`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Launch Secret Key', keyType: 'secret', environment: 'test' });
    expect(skRes.status).toBe(201);
    const secretKey = skRes.body.key;

    // 3. Register Tool
    const toolRes = await request(app)
      .post(`/v1/projects/${projectId}/tools`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        name: 'track_order',
        description: 'Track real-time shipment status',
        sensitivity: 'READ',
        permissions: ['orders:read', 'tracking:read'],
        inputSchema: {
          type: 'object',
          properties: { orderId: { type: 'string' } },
          required: ['orderId'],
        },
      });
    expect(toolRes.status).toBe(201);
    const toolId = toolRes.body.tool.id;

    // 4. Customer Conversation 1
    const customerId = 'customer_demo_001';
    const chat1 = await request(app)
      .post('/v1/support/chat')
      .set('x-api-key', secretKey)
      .send({
        userId: customerId,
        message: 'My recent order hasn\'t arrived yet on my MacBook Pro. I checked and still have a 404 issue.',
        environment: 'test',
      });
    expect(chat1.status).toBe(200);
    expect(chat1.body.memoryUsed).toBe(false);

    // Tool execution
    const toolExec = await request(app)
      .post(`/v1/projects/${projectId}/tools/${toolId}/execute`)
      .set('x-api-key', secretKey)
      .send({ orderId: 'ord_9842', customerId });
    expect(toolExec.status).toBe(200);
    expect(toolExec.body.result.status).toBe('shipped');
    expect(toolExec.body.result.carrier).toBe('FedEx Express');

    // End session 1
    const end1 = await request(app)
      .post('/v1/support/end')
      .set('x-api-key', secretKey)
      .send({
        userId: customerId,
        messages: [
          'My recent order hasn\'t arrived yet on my MacBook Pro. I checked and still have a 404 issue.',
          'Order ord_9842 is currently in transit with FedEx Express.',
        ],
      });
    expect(end1.status).toBe(200);
    expect(end1.body.facts_stored).toBeGreaterThan(0);

    // 5. Customer Conversation 2 (Return Later)
    const chat2 = await request(app)
      .post('/v1/support/chat')
      .set('x-api-key', secretKey)
      .send({
        userId: customerId,
        message: 'Any update on that? What device was I using?',
        environment: 'test',
      });
    expect(chat2.status).toBe(200);
    expect(chat2.body.memoryUsed).toBe(true);
    expect(chat2.body.reply).toMatch(/MacBook Pro|macOS|404/i);

    // 6. Feedback
    const fbRes = await request(app)
      .post('/v1/support/feedback')
      .set('x-api-key', publicKey)
      .send({
        conversation_id: chat2.body.conversationId,
        customer_id: customerId,
        rating: 'positive',
      });
    expect(fbRes.status).toBe(200);

    // 7. Security Checks
    const blockedPublicTool = await request(app)
      .post(`/v1/projects/${projectId}/tools/${toolId}/execute`)
      .set('x-api-key', publicKey)
      .send({ orderId: 'ord_9842' });
    expect(blockedPublicTool.status).toBe(403);

    const blockedPassword = await request(app)
      .post(`/v1/projects/${projectId}/tools/${toolId}/execute`)
      .set('x-api-key', secretKey)
      .send({ orderId: 'ord_9842', password: 'BadPassword123!' });
    expect(blockedPassword.status).toBe(400);

    // 8. Analytics
    const analytics = await request(app)
      .get(`/v1/projects/${projectId}/analytics?range=7d`)
      .set('Cookie', cookie);
    expect(analytics.status).toBe(200);
    expect(analytics.body.analytics.overview.totalConversations).toBeGreaterThanOrEqual(1);
    expect(analytics.body.analytics.overview.totalRequests).toBeGreaterThanOrEqual(2);
  }, 30000);
});
