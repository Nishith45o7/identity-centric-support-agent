const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');

describe('Contextis Phase 6 — Subscriptions, Usage & Billing Foundation', () => {
  let cookie;
  let organizationId;

  beforeAll(async () => {
    // 1. Signup developer
    const email = `dev-billing-${crypto.randomUUID()}@contextis.test`;
    const signup = await request(app)
      .post('/v1/auth/signup')
      .send({ name: 'Acme SaaS Corp', email, password: 'SecurePassword123!' });
    expect(signup.status).toBe(201);
    cookie = signup.headers['set-cookie'][0].split(';')[0];

    const orgRes = await request(app).get('/v1/organization').set('Cookie', cookie);
    organizationId = orgRes.body.organization.id;
  });

  describe('1. Subscription & Plan Status', () => {
    test('retrieves active organization subscription and plan definitions', async () => {
      const res = await request(app)
        .get('/v1/organization/subscription')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.plan).toBeDefined();
      expect(res.body.subscription).toBeDefined();
      expect(res.body.plan.name).toBeDefined();
      expect(res.body.plan.monthlyRequests).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('2. Webhook Event Processing & Plan Lifecycle', () => {
    test('handles checkout.session.completed and upgrades organization plan to Pro', async () => {
      const res = await request(app)
        .post('/v1/billing/webhook')
        .send({
          type: 'checkout.session.completed',
          data: {
            organization_id: organizationId,
            plan_slug: 'pro',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('plan_upgraded');
      expect(res.body.plan).toBe('pro');

      // Verify org plan upgraded
      const subRes = await request(app)
        .get('/v1/organization/subscription')
        .set('Cookie', cookie);
      expect(subRes.body.plan.slug).toBe('pro');
    });

    test('handles invoice.payment_failed and transitions to past_due', async () => {
      const res = await request(app)
        .post('/v1/billing/webhook')
        .send({
          type: 'invoice.payment_failed',
          data: {
            organization_id: organizationId,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('status_past_due');

      const orgRes = await request(app).get('/v1/organization').set('Cookie', cookie);
      expect(orgRes.body.organization.billingStatus).toBe('past_due');
    });

    test('handles customer.subscription.deleted and cancels subscription to free tier', async () => {
      const res = await request(app)
        .post('/v1/billing/webhook')
        .send({
          type: 'customer.subscription.deleted',
          data: {
            organization_id: organizationId,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('subscription_canceled');

      const subRes = await request(app)
        .get('/v1/organization/subscription')
        .set('Cookie', cookie);
      expect(subRes.body.plan.slug).toBe('free');
    });
  });
});
