const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');

describe('Contextis Phase 9 — Public Landing Page & SaaS Onboarding Experience', () => {
  let cookie;
  let user;
  let projectId;
  let secretKey;

  beforeAll(async () => {
    const email = `onboarding-${Date.now()}@contextis.test`;
    const signupRes = await request(app)
      .post('/v1/auth/signup')
      .send({ email, password: 'SecurePassword123!', name: 'New SaaS Founder' });
    expect(signupRes.status).toBe(201);
    cookie = signupRes.headers['set-cookie'][0].split(';')[0];
    user = signupRes.body.user;
  });

  describe('1. Public Plans API & Dynamic Pricing Foundation', () => {
    it('returns data-driven public plans with limits and features', async () => {
      const res = await request(app).get('/v1/public/plans');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.plans)).toBe(true);
      expect(res.body.plans.length).toBeGreaterThanOrEqual(4);

      const freePlan = res.body.plans.find((p) => p.slug === 'free');
      expect(freePlan).toBeDefined();
      expect(freePlan.monthlyRequests).toBeGreaterThanOrEqual(1000);
      expect(Array.isArray(freePlan.features)).toBe(true);

      const proPlan = res.body.plans.find((p) => p.slug === 'pro');
      expect(proPlan).toBeDefined();
      expect(proPlan.highlighted).toBe(true);
      expect(proPlan.maxProjects).toBeGreaterThanOrEqual(10);
    });
  });

  describe('2. SaaS Onboarding Wizard Progress State', () => {
    it('initial onboarding state shows organization created but project pending', async () => {
      const res = await request(app)
        .get('/v1/onboarding')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.onboarding).toBeDefined();
      expect(res.body.onboarding.organizationCreated).toBe(true);
      expect(res.body.onboarding.projectCreated).toBe(false);
      expect(res.body.onboarding.apiKeyCreated).toBe(false);
      expect(res.body.onboarding.currentStep).toBe('create_project');
      expect(res.body.onboarding.completed).toBe(false);
    });

    it('progresses to generate_key step when project is created', async () => {
      const projRes = await request(app)
        .post('/v1/projects')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .send({ name: 'Onboarding App Live', environment: 'live' });
      expect(projRes.status).toBe(201);
      projectId = projRes.body.project.id;

      const res = await request(app)
        .get('/v1/onboarding')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.onboarding.projectCreated).toBe(true);
      expect(res.body.onboarding.apiKeyCreated).toBe(false);
      expect(res.body.onboarding.currentStep).toBe('generate_key');
    });

    it('progresses to test_request step when API key is generated', async () => {
      const keyRes = await request(app)
        .post(`/v1/projects/${projectId}/api-keys`)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .send({ name: 'Onboarding Secret Key', environment: 'live' });
      expect(keyRes.status).toBe(201);
      secretKey = keyRes.body.key;

      const res = await request(app)
        .get('/v1/onboarding')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.onboarding.apiKeyCreated).toBe(true);
      expect(res.body.onboarding.firstRequestSent).toBe(false);
      expect(res.body.onboarding.currentStep).toBe('test_request');
    });

    it('marks onboarding complete after first successful support chat request', async () => {
      const chatRes = await request(app)
        .post('/v1/support/chat')
        .set('Authorization', `Bearer ${secretKey}`)
        .send({
          user_id: 'customer_onboard_1',
          message: 'Testing first onboarding support message.',
        });
      expect(chatRes.status).toBe(200);

      const res = await request(app)
        .get('/v1/onboarding')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.onboarding.firstRequestSent).toBe(true);
      expect(res.body.onboarding.completed).toBe(true);
      expect(res.body.onboarding.currentStep).toBe('completed');
    });
  });

  describe('3. Public Landing Page Verification & SEO', () => {
    it('serves landing page with meta tags, core promise and product identity', async () => {
      const res = await request(app).get('/home');
      expect(res.status).toBe(200);
      expect(res.text).toContain('AI support that remembers');
      expect(res.text).toContain('Start Building');
      expect(res.text).toContain('Explore Documentation');
      expect(res.text).toContain('Talk to Sales');
      expect(res.text).toContain('SoftwareApplication');
      expect(res.text).toContain('Persistent Customer Memory');
    });
  });
});
