const request = require('supertest');
const { app } = require('../src/app');

describe('Contextis Phase 7 — Platform Administration Control Plane', () => {
  let adminCookie = '';
  let nonAdminCookie = '';
  let testOrgId = '';
  let testProjectId = '';
  let testKeyId = '';

  beforeAll(async () => {
    // 1. Create a platform admin user
    const adminEmail = `admin-${Date.now()}@contextis.internal`;
    const signupAdmin = await request(app)
      .post('/v1/auth/signup')
      .send({ email: adminEmail, password: 'SecurePassword123!', name: 'Platform Admin' });
    expect(signupAdmin.status).toBe(201);
    adminCookie = signupAdmin.headers['set-cookie'][0].split(';')[0];

    // 2. Create a normal non-admin user
    const nonAdminEmail = `dev-${Date.now()}@customer.com`;
    const signupDev = await request(app)
      .post('/v1/auth/signup')
      .send({ email: nonAdminEmail, password: 'SecurePassword123!', name: 'Dev User' });
    expect(signupDev.status).toBe(201);
    nonAdminCookie = signupDev.headers['set-cookie'][0].split(';')[0];

    // Retrieve organization created for this user
    const orgRes = await request(app)
      .get('/v1/organization')
      .set('Cookie', nonAdminCookie);
    expect(orgRes.status).toBe(200);
    testOrgId = orgRes.body.organization.id;

    // Create a project under the user's organization
    const createProj = await request(app)
      .post('/v1/projects')
      .set('Cookie', nonAdminCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Acme Web Admin Test', environment: 'live' });
    expect(createProj.status).toBe(201);
    testProjectId = createProj.body.project.id;

    // Create an API key
    const createKey = await request(app)
      .post(`/v1/projects/${testProjectId}/api-keys`)
      .set('Cookie', nonAdminCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ name: 'Acme Test Key', environment: 'live' });
    expect(createKey.status).toBe(201);
    testKeyId = createKey.body.metadata?.id || createKey.body.apiKey?.id;
  });

  describe('1. Platform Admin Security & Access Control', () => {
    it('rejects unauthenticated requests to platform admin routes', async () => {
      const res = await request(app).get('/v1/admin/overview');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('enforces explicit server-side administrative access when PLATFORM_ADMIN_EMAILS is active', async () => {
      const originalEnv = process.env.PLATFORM_ADMIN_EMAILS;
      try {
        process.env.PLATFORM_ADMIN_EMAILS = 'superadmin@contextis.com,security@contextis.com';
        const res = await request(app)
          .get('/v1/admin/overview')
          .set('Cookie', nonAdminCookie);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      } finally {
        if (originalEnv !== undefined) {
          process.env.PLATFORM_ADMIN_EMAILS = originalEnv;
        } else {
          delete process.env.PLATFORM_ADMIN_EMAILS;
        }
      }
    });
  });

  describe('2. Admin Overview & System Health', () => {
    it('retrieves platform overview metrics with real counts and health status', async () => {
      const res = await request(app)
        .get('/v1/admin/overview')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.overview).toBeDefined();
      expect(typeof res.body.overview.organizationsCount).toBe('number');
      expect(typeof res.body.overview.projectsCount).toBe('number');
      expect(typeof res.body.overview.usersCount).toBe('number');
      expect(res.body.overview.platformVersion).toContain('contextis');
      expect(res.body.stats.health.status).toBe('healthy');
    });

    it('retrieves detailed system health telemetry', async () => {
      const res = await request(app)
        .get('/v1/admin/health')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.health).toBeDefined();
      expect(res.body.health.database).toBe('healthy');
      expect(res.body.health.services.api.status).toBe('healthy');
      expect(typeof res.body.health.uptimeSeconds).toBe('number');
    });
  });

  describe('3. Platform Organization & User Management', () => {
    it('lists all organizations with owner details and project counts', async () => {
      const res = await request(app)
        .get('/v1/admin/organizations')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.organizations)).toBe(true);
      const target = res.body.organizations.find((o) => o.id === testOrgId);
      expect(target).toBeDefined();
    });

    it('retrieves deep organization inspection details including keys, members and audits', async () => {
      const res = await request(app)
        .get(`/v1/admin/organizations/${testOrgId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.organization.id).toBe(testOrgId);
      expect(Array.isArray(res.body.projects)).toBe(true);
      expect(Array.isArray(res.body.apiKeys)).toBe(true);
      expect(Array.isArray(res.body.members)).toBe(true);
      expect(Array.isArray(res.body.auditLogs)).toBe(true);
    });

    it('allows platform admin to suspend and reactivate an organization with audit log', async () => {
      // Suspend
      const suspendRes = await request(app)
        .patch(`/v1/admin/organizations/${testOrgId}/status`)
        .set('Cookie', adminCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ status: 'suspended' });

      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.status).toBe('suspended');

      // Reactivate
      const reactivateRes = await request(app)
        .patch(`/v1/admin/organizations/${testOrgId}/status`)
        .set('Cookie', adminCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ status: 'active' });

      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.status).toBe('active');
    });

    it('lists registered users with organization membership counts', async () => {
      const res = await request(app)
        .get('/v1/admin/users')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.length).toBeGreaterThan(0);
      expect(res.body.users[0]).toHaveProperty('email');
      expect(res.body.users[0]).toHaveProperty('organizationsCount');
    });
  });

  describe('4. Security Center, Audits & Platform Projects', () => {
    it('retrieves security events and revoked keys metrics from Security Center', async () => {
      const res = await request(app)
        .get('/v1/admin/security')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.security).toBeDefined();
      expect(typeof res.body.security.revokedKeysCount).toBe('number');
      expect(typeof res.body.security.suspendedOrgsCount).toBe('number');
      expect(Array.isArray(res.body.security.events)).toBe(true);
    });

    it('queries global audit logs across organizations', async () => {
      const res = await request(app)
        .get('/v1/admin/audit')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.auditLogs)).toBe(true);
      expect(res.body.auditLogs.length).toBeGreaterThan(0);
    });

    it('lists platform projects with environment, status, and API key counts', async () => {
      const res = await request(app)
        .get('/v1/admin/projects')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.projects)).toBe(true);
      const proj = res.body.projects.find((p) => p.id === testProjectId);
      expect(proj).toBeDefined();
      expect(proj.name).toBe('Acme Web Admin Test');
    });

    it('lists organization subscriptions and plan tiers', async () => {
      const res = await request(app)
        .get('/v1/admin/subscriptions')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.subscriptions)).toBe(true);
      const sub = res.body.subscriptions.find((s) => s.organizationId === testOrgId);
      expect(sub).toBeDefined();
      expect(sub.billingStatus).toBe('active');
    });

    it('allows platform admin to immediately revoke any rogue API key', async () => {
      const res = await request(app)
        .post(`/v1/admin/keys/${testKeyId}/revoke`)
        .set('Cookie', adminCookie)
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.keyId).toBe(testKeyId);
    });
  });
});
