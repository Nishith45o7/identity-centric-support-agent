const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');
const projectService = require('../src/services/project/projectService');

describe('Contextis Phase 2 — Developer Platform & API Key Lifecycle', () => {
  let cookie;
  let user;
  let project;
  let otherCookie;

  beforeAll(async () => {
    // 1. Create primary developer account
    const email = `dev-p2-${crypto.randomUUID()}@contextis.test`;
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Acme Developer', email, password: 'SecurePassword123!' });
    expect(signup.status).toBe(201);
    cookie = signup.headers['set-cookie'][0].split(';')[0];
    user = signup.body.user;

    // 2. Create another user for isolation checks
    const otherEmail = `other-dev-${crypto.randomUUID()}@contextis.test`;
    const otherSignup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Other Developer', email: otherEmail, password: 'SecurePassword123!' });
    otherCookie = otherSignup.headers['set-cookie'][0].split(';')[0];
  });

  describe('1. Project Management & Configuration', () => {
    test('creates a project with environment specification', async () => {
      const res = await request(app)
        .post('/v1/projects')
        .set('Cookie', cookie)
        .send({ name: 'Production Backend', environment: 'live' });

      expect(res.status).toBe(201);
      expect(res.body.project).toBeDefined();
      expect(res.body.project.name).toBe('Production Backend');
      project = res.body.project;
    });

    test('updates / renames an existing project', async () => {
      const res = await request(app)
        .patch(`/v1/projects/${project.id}`)
        .set('Cookie', cookie)
        .send({ name: 'Production Backend v2', environment: 'live' });

      expect(res.status).toBe(200);
      expect(res.body.project.name).toBe('Production Backend v2');
    });

    test('prevents unauthorized user from updating project', async () => {
      const res = await request(app)
        .patch(`/v1/projects/${project.id}`)
        .set('Cookie', otherCookie)
        .send({ name: 'Hacked Project Name' });

      expect(res.status).toBe(404);
    });
  });

  describe('2. API Key Management, Scopes & Rotation', () => {
    let originalKey;

    test('creates a secret live API key with custom scopes', async () => {
      const res = await request(app)
        .post(`/v1/projects/${project.id}/api-keys`)
        .set('Cookie', cookie)
        .send({
          name: 'Primary Backend Key',
          environment: 'live',
          type: 'secret',
          scopes: ['support:read', 'support:write'],
        });

      expect(res.status).toBe(201);
      expect(res.body.key).toMatch(/^sk_live_/);
      expect(res.body.metadata.name).toBe('Primary Backend Key');
      expect(res.body.metadata.keyType).toBe('secret');
      expect(res.body.metadata.scopes).toEqual(['support:read', 'support:write']);
      originalKey = res.body;
    });

    test('creates a public live API key for widget integration', async () => {
      const res = await request(app)
        .post(`/v1/projects/${project.id}/api-keys`)
        .set('Cookie', cookie)
        .send({
          name: 'Widget Browser Key',
          environment: 'live',
          type: 'public',
        });

      expect(res.status).toBe(201);
      expect(res.body.key).toMatch(/^pk_live_/);
      expect(res.body.metadata.keyType).toBe('public');
      expect(res.body.metadata.scopes).toContain('widget:load');
    });

    test('rotates an API key: revokes previous and issues new secret', async () => {
      const rotateRes = await request(app)
        .post(`/v1/projects/${project.id}/api-keys/${originalKey.metadata.id}/rotate`)
        .set('Cookie', cookie);

      expect(rotateRes.status).toBe(201);
      expect(rotateRes.body.key).toBeDefined();
      expect(rotateRes.body.key).not.toBe(originalKey.key);
      expect(rotateRes.body.key).toMatch(/^sk_live_/);
      expect(rotateRes.body.metadata.name).toContain('Rotated');

      // Verify old key is revoked
      const oldCheck = await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${originalKey.key}`)
        .send({ user_id: 'cust_rot', message: 'Hello' });
      expect(oldCheck.status).toBe(401);

      // Verify new key is functional
      const newCheck = await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${rotateRes.body.key}`)
        .send({ user_id: 'cust_rot', message: 'Hello with rotated key' });
      expect(newCheck.status).toBe(200);
    });

    test('prevents unauthorized user from rotating key', async () => {
      const res = await request(app)
        .post(`/v1/projects/${project.id}/api-keys/${originalKey.metadata.id}/rotate`)
        .set('Cookie', otherCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('3. Telemetry & Usage Metrics', () => {
    test('fetches project usage telemetry', async () => {
      const res = await request(app)
        .get(`/v1/projects/${project.id}/usage`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.usage).toBeDefined();
      expect(res.body.usage.requests).toBeGreaterThanOrEqual(1);
    });
  });
});
