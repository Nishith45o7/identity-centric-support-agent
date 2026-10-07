const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');
const memoryService = require('../src/services/memory/hindsightMemoryService');

describe('Contextis Phase 4 — Customer Intelligence, Memory & Privacy', () => {
  let cookie;
  let project;
  let secretKey;
  let customerId;

  beforeAll(async () => {
    // 1. Signup developer
    const email = `dev-cust-${crypto.randomUUID()}@contextis.test`;
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Acme Intelligence', email, password: 'Strong-Password-123!' });
    expect(signup.status).toBe(201);
    cookie = signup.headers['set-cookie'][0].split(';')[0];

    // 2. Create project
    const pRes = await request(app)
      .post('/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'CRM & Support Portal', environment: 'live' });
    project = pRes.body.project;

    // 3. Create Secret Key
    const skRes = await request(app)
      .post(`/v1/projects/${project.id}/api-keys`)
      .set('Cookie', cookie)
      .send({ name: 'Admin Server Key', environment: 'live', type: 'secret' });
    secretKey = skRes.body.key;

    // 4. Create customer interaction
    customerId = `customer_vip_${crypto.randomUUID().slice(0, 8)}`;
    await request(app)
      .post('/v1/support/chat')
      .set('Authorization', `Bearer ${secretKey}`)
      .send({
        user_id: customerId,
        message: 'I am running on Windows 11 with Firefox. My subscription renewed yesterday.',
      });

    await request(app)
      .post('/v1/support/end')
      .set('Authorization', `Bearer ${secretKey}`)
      .send({
        user_id: customerId,
        messages: ['I am running on Windows 11 with Firefox.'],
      });
  });

  describe('1. Customer Directory & Intelligence', () => {
    test('lists customers with search filter', async () => {
      const res = await request(app)
        .get(`/v1/projects/${project.id}/customers?q=${customerId.slice(0, 8)}`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.customers)).toBe(true);
      expect(res.body.customers.some((c) => c.externalUserId === customerId)).toBe(true);
    });

    test('retrieves detailed customer profile with metrics', async () => {
      const res = await request(app)
        .get(`/v1/projects/${project.id}/customers/${customerId}`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.customer).toBeDefined();
      expect(res.body.customer.externalUserId).toBe(customerId);
      expect(res.body.customer.conversationCount).toBeGreaterThanOrEqual(1);
      expect(res.body.customer.memoryCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.customer.memory)).toBe(true);
    });
  });

  describe('2. Memory Sanitization & Fact Management', () => {
    test('memory never stores passwords or auth tokens', async () => {
      const sensitiveUserId = `cust_sens_${crypto.randomUUID().slice(0, 8)}`;
      await request(app)
        .post('/v1/support/end')
        .set('Authorization', `Bearer ${secretKey}`)
        .send({
          user_id: sensitiveUserId,
          messages: ['My password is SuperSecretPass123! and my token is Bearer eyJhbGciOi.'],
        });

      const memRes = await request(app)
        .get(`/v1/support/memory/${sensitiveUserId}`)
        .set('Authorization', `Bearer ${secretKey}`);

      expect(memRes.status).toBe(200);
      const factsStr = JSON.stringify(memRes.body.memory);
      expect(factsStr).not.toContain('SuperSecretPass123!');
      expect(factsStr).not.toContain('eyJhbGciOi');
    });

    test('deletes individual fact from customer memory bank', async () => {
      await memoryService.retain(
        customerId,
        [{ category: 'hardware', fact: 'HP LaserJet Printer 4000' }],
        project.organizationId,
        project.id,
        'live'
      );

      const beforeMem = await memoryService.recall(customerId, '', project.organizationId, project.id, 'live');
      expect(JSON.stringify(beforeMem.facts)).toContain('HP LaserJet Printer 4000');

      const removed = await memoryService.deleteFact(
        customerId,
        'HP LaserJet Printer 4000',
        project.organizationId,
        project.id,
        'live'
      );
      expect(removed).toBe(true);

      const afterMem = await memoryService.recall(customerId, '', project.organizationId, project.id, 'live');
      expect(JSON.stringify(afterMem.facts)).not.toContain('HP LaserJet Printer 4000');
    });
  });

  describe('3. Customer Data Export & Cascading Deletion (GDPR)', () => {
    test('exports full customer profile, conversations, and memory', async () => {
      const res = await request(app)
        .get(`/v1/projects/${project.id}/customers/${customerId}/export`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.export).toBeDefined();
      expect(res.body.export.customer.externalUserId).toBe(customerId);
      expect(Array.isArray(res.body.export.conversations)).toBe(true);
      expect(Array.isArray(res.body.export.messages)).toBe(true);
      expect(Array.isArray(res.body.export.memory)).toBe(true);
    });

    test('deletes customer completely with cascading conversations and memory wipe', async () => {
      const toDeleteId = `cust_del_${crypto.randomUUID().slice(0, 8)}`;

      // Setup customer with interaction
      await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${secretKey}`)
        .send({ user_id: toDeleteId, message: 'I want my data deleted.' });

      // Delete customer
      const delRes = await request(app)
        .delete(`/v1/projects/${project.id}/customers/${toDeleteId}`)
        .set('Cookie', cookie);
      expect(delRes.status).toBe(200);

      // Verify customer is gone
      const getRes = await request(app)
        .get(`/v1/projects/${project.id}/customers/${toDeleteId}`)
        .set('Cookie', cookie);
      expect(getRes.status).toBe(404);

      // Verify memory is cleared
      const memRes = await request(app)
        .get(`/v1/support/memory/${toDeleteId}`)
        .set('Authorization', `Bearer ${secretKey}`);
      expect(memRes.status).toBe(200);
      expect(memRes.body.memory).toEqual([]);
    });
  });
});
