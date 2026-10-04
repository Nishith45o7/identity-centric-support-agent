const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { query } = require('../db');
const developerAuth = require('../services/auth/developerAuthService');
const projectService = require('../services/project/projectService');
const projectToolService = require('../services/tool/projectToolService');
const memoryService = require('../services/memory/hindsightMemoryService');
const supportAgentService = require('../services/supportAgent/supportAgentService');
const { sanitizeText, validateUserId } = require('../utils/sanitizers');

const router = express.Router();
const SESSION_COOKIE = 'ics_session';
const PLAN_DEFINITIONS = {
  starter: { name: 'starter', maxProjects: 3, maxRequestsPer15Min: 120, maxCustomers: 1000, memoryRetentionDays: 30, supportSeats: 1 },
  growth: { name: 'growth', maxProjects: 10, maxRequestsPer15Min: 600, maxCustomers: 10000, memoryRetentionDays: 90, supportSeats: 3 },
  scale: { name: 'scale', maxProjects: 50, maxRequestsPer15Min: 1500, maxCustomers: 50000, memoryRetentionDays: 180, supportSeats: 10 },
  enterprise: { name: 'enterprise', maxProjects: 200, maxRequestsPer15Min: 5000, maxCustomers: 200000, memoryRetentionDays: 365, supportSeats: 50 },
};
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const sendError = (req, res, status, code, message) => res.status(status).json({
  error: { code, message, request_id: req.requestId },
});

const cookieValue = (req, name) => {
  const pair = String(req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  if (!pair) return '';
  try {
    return decodeURIComponent(pair.slice(name.length + 1));
  } catch {
    return '';
  }
};

const setSessionCookie = (res, session) => {
  const maxAge = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}${secure}`);
};

const clearSessionCookie = (res) => {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
};

const getOrganizationIdForUser = async (userId) => {
  const { rows } = await query(
    `SELECT organization_id AS organizationId FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  return rows[0]?.organizationId || null;
};

const requireSameOrigin = (req, res, next) => {
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site') {
    return sendError(req, res, 403, 'FORBIDDEN', 'Cross-site requests are not allowed.');
  }
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      return sendError(req, res, 403, 'FORBIDDEN', 'Request origin is invalid.');
    }
    if (originHost !== req.get('host') && !config.corsOrigins.includes(origin)) {
      return sendError(req, res, 403, 'FORBIDDEN', 'Request origin is not allowed.');
    }
  }
  return next();
};

const requireDeveloperSession = asyncHandler(async (req, res, next) => {
  const user = await developerAuth.getSession(cookieValue(req, SESSION_COOKIE));
  if (!user) {
    return sendError(req, res, 401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  }
  req.developer = user;
  return next();
});

const requireOrganizationMembership = asyncHandler(async (req, res, next) => {
  const organizationId = await getOrganizationIdForUser(req.developer.id);
  if (!organizationId) {
    return sendError(req, res, 401, 'WORKSPACE_ACCESS_REQUIRED', 'You are not a member of this workspace.');
  }
  req.organizationId = organizationId;
  return next();
});

const getOrganizationPlan = (planName = 'starter') => {
  const normalizedName = String(planName || 'starter').trim().toLowerCase();
  return PLAN_DEFINITIONS[normalizedName] || PLAN_DEFINITIONS.starter;
};

const requireProjectApiKey = asyncHandler(async (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const rawKey = authorization.startsWith('Bearer ') ? authorization.slice(7) : req.get('x-api-key');
  const key = await projectService.authenticateApiKey(rawKey);
  if (!key) {
    return sendError(req, res, 401, 'INVALID_API_KEY', 'A valid project API key is required.');
  }

  const organizationProfile = await query(
    'SELECT plan_name AS planName, billing_status AS billingStatus FROM organizations WHERE id = ?',
    [key.organizationId]
  );
  req.projectKey = key;
  req.projectId = key.projectId;
  req.organizationId = key.organizationId;
  req.organizationPlan = getOrganizationPlan(organizationProfile.rows[0]?.planName || 'starter');
  req.billingStatus = organizationProfile.rows[0]?.billingStatus || 'active';

  if (req.billingStatus !== 'active') {
    return sendError(req, res, 402, 'BILLING_REQUIRED', 'Workspace billing is not active.');
  }

  return next();
});

const requireDeveloperProject = asyncHandler(async (req, res, next) => {
  const token = cookieValue(req, SESSION_COOKIE);
  const user = await developerAuth.getSession(token);
  if (user) {
    const projectId = String(req.query.project_id || req.body?.project_id || '').trim();
    if (!projectId) {
      return sendError(req, res, 400, 'INVALID_REQUEST', 'project_id is required.');
    }
    const project = await projectService.getOwnedProject(user.id, projectId);
    if (!project) {
      return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
    }
    req.developer = user;
    req.projectId = project.id;
    req.organizationId = project.organizationId;
    return next();
  }

  const authorization = req.get('authorization') || '';
  const rawKey = authorization.startsWith('Bearer ') ? authorization.slice(7) : req.get('x-api-key');
  const key = await projectService.authenticateApiKey(rawKey);
  if (!key) {
    return sendError(req, res, 401, 'INVALID_API_KEY', 'A valid project API key or developer session is required.');
  }
  req.projectKey = key;
  req.projectId = key.projectId;
  req.organizationId = key.organizationId;
  return next();
});

const reportAuthError = (req, res, error) => {
  const duplicate = error.code === '23505' || /unique constraint/i.test(error.message || '');
  if (duplicate) {
    return sendError(req, res, 409, 'CONFLICT', 'An account with this email already exists.');
  }
  throw error;
};

router.post('/auth/signup', requireSameOrigin, asyncHandler(async (req, res) => {
  try {
    const result = await developerAuth.signup(req.body || {});
    setSessionCookie(res, result.session);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ user: result.user });
  } catch (error) {
    return reportAuthError(req, res, error);
  }
}));

router.post('/auth/login', requireSameOrigin, asyncHandler(async (req, res) => {
  const result = await developerAuth.login(req.body || {});
  setSessionCookie(res, result.session);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ user: result.user });
}));

router.get('/auth/session', asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ user: await developerAuth.getSession(cookieValue(req, SESSION_COOKIE)) });
}));

router.post('/auth/logout', requireSameOrigin, asyncHandler(async (req, res) => {
  await developerAuth.logout(cookieValue(req, SESSION_COOKIE));
  clearSessionCookie(res);
  return res.json({ success: true });
}));

router.get('/organization', requireDeveloperSession, requireOrganizationMembership, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT organizations.id, organizations.name, organizations.owner_user_id AS ownerUserId,
            organizations.created_at AS createdAt, COALESCE(organizations.plan_name, 'starter') AS planName,
            COALESCE(organizations.billing_status, 'active') AS billingStatus,
            COUNT(DISTINCT organization_members.user_id) AS memberCount,
            COUNT(DISTINCT projects.id) AS projectCount
     FROM organizations
     JOIN organization_members ON organization_members.organization_id = organizations.id
     LEFT JOIN projects ON projects.organization_id = organizations.id
     WHERE organizations.id = (
       SELECT organization_id FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1
     )
     GROUP BY organizations.id, organizations.name, organizations.owner_user_id, organizations.created_at,
              organizations.plan_name, organizations.billing_status`,
    [req.developer.id]
  );

  const organization = rows[0];
  if (!organization) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  const plan = getOrganizationPlan(organization.planName || 'starter');

  return res.json({
    organization: {
      id: organization.id,
      name: organization.name,
      ownerUserId: organization.ownerUserId,
      createdAt: organization.createdAt,
      planName: plan.name,
      billingStatus: organization.billingStatus || 'active',
      memberCount: Number(organization.memberCount || 0),
      projectCount: Number(organization.projectCount || 0),
      plan: {
        ...plan,
        name: plan.name,
      },
    },
  });
}));

router.get('/organization/members', requireDeveloperSession, requireOrganizationMembership, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT users.id, users.email, users.name, organization_members.role,
            organization_members.created_at AS joinedAt
     FROM organization_members
     JOIN users ON users.id = organization_members.user_id
     WHERE organization_members.organization_id = (
       SELECT organization_id FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1
     )
     ORDER BY organization_members.created_at ASC`,
    [req.developer.id]
  );

  return res.json({ members: rows });
}));

router.get('/organization/audit', requireDeveloperSession, requireOrganizationMembership, asyncHandler(async (req, res) => {
  const organizationId = await getOrganizationIdForUser(req.developer.id);

  if (!organizationId) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  const { rows } = await query(
    `SELECT id, action, metadata, created_at AS createdAt
     FROM audit_logs
     WHERE organization_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [organizationId]
  );

  return res.json({ events: rows.map((event) => ({
    id: event.id,
    action: event.action,
    metadata: (() => {
      try { return JSON.parse(event.metadata || '{}'); } catch { return {}; }
    })(),
    createdAt: event.createdAt,
  })) });
}));

router.get('/organization/billing', requireDeveloperSession, requireOrganizationMembership, asyncHandler(async (req, res) => {
  const organizationId = await getOrganizationIdForUser(req.developer.id);

  if (!organizationId) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  const organization = await query(
    `SELECT plan_name AS planName, billing_status AS billingStatus FROM organizations WHERE id = ?`,
    [organizationId]
  );

  const summary = await query(
    `SELECT COUNT(*) AS totalInvoices,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS paidBalanceCents,
            COALESCE(SUM(CASE WHEN status != 'paid' THEN amount_cents ELSE 0 END), 0) AS outstandingBalanceCents,
            COALESCE(SUM(amount_cents), 0) AS totalBalanceCents
     FROM billing_invoices
     WHERE organization_id = ?`,
    [organizationId]
  );

  const totals = summary.rows[0] || {};
  const planName = String(organization.rows[0]?.planName || 'starter').trim().toLowerCase();

  return res.json({
    billing: {
      planName,
      billingStatus: organization.rows[0]?.billingStatus || 'active',
      totalInvoices: Number(totals.totalInvoices || 0),
      paidBalanceCents: Number(totals.paidBalanceCents || 0),
      outstandingBalanceCents: Number(totals.outstandingBalanceCents || 0),
      totalBalanceCents: Number(totals.totalBalanceCents || 0),
      currentCycle: {
        start: null,
        end: null,
      },
    },
  });
}));

router.get('/organization/usage', requireDeveloperSession, requireOrganizationMembership, asyncHandler(async (req, res) => {
  const organizationId = await getOrganizationIdForUser(req.developer.id);

  if (!organizationId) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  const organization = await query(
    `SELECT organizations.plan_name AS planName,
            COUNT(DISTINCT organization_members.user_id) AS memberCount,
            COUNT(DISTINCT projects.id) AS projectCount
     FROM organizations
     LEFT JOIN organization_members ON organization_members.organization_id = organizations.id
     LEFT JOIN projects ON projects.organization_id = organizations.id
     WHERE organizations.id = ?
     GROUP BY organizations.id, organizations.plan_name`,
    [organizationId]
  );

  const customerCount = await query(
    `SELECT COUNT(*) AS customerCount
     FROM customers
     JOIN projects ON projects.id = customers.project_id
     WHERE projects.organization_id = ?`,
    [organizationId]
  );

  const requestSummary = await query(
    `SELECT COUNT(*) AS requestCount
     FROM usage_records
     JOIN projects ON projects.id = usage_records.project_id
     WHERE projects.organization_id = ?
       AND usage_records.created_at >= ?`,
    [organizationId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()]
  );

  const base = organization.rows[0] || {};
  const plan = getOrganizationPlan(base.planName || 'starter');

  return res.json({
    usage: {
      planName: plan.name,
      billingStatus: 'active',
      memberCount: Number(base.memberCount || 0),
      projectCount: Number(base.projectCount || 0),
      projectLimit: Number(plan.maxProjects),
      requestCount: Number(requestSummary.rows[0]?.requestCount || 0),
      requestLimit: Number(plan.maxRequestsPer15Min),
      customerCount: Number(customerCount.rows[0]?.customerCount || 0),
      customerLimit: Number(plan.maxCustomers),
      supportSeatsUsed: Number(base.memberCount || 0),
      supportSeatsLimit: Number(plan.supportSeats),
      usageWindowDays: 30,
    },
  });
}));

router.get('/organization/invoices', requireDeveloperSession, asyncHandler(async (req, res) => {
  const organizationId = await getOrganizationIdForUser(req.developer.id);

  if (!organizationId) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  const { rows } = await query(
    `SELECT id, invoice_number AS invoiceNumber, amount_cents AS amountCents, currency, description, status,
            created_at AS createdAt, paid_at AS paidAt
     FROM billing_invoices
     WHERE organization_id = ?
     ORDER BY created_at DESC`,
    [organizationId]
  );

  return res.json({ invoices: rows });
}));

router.post('/organization/invoices', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const organizationId = await getOrganizationIdForUser(req.developer.id);

  if (!organizationId) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  const invoiceNumber = String(req.body?.invoiceNumber || '').trim();
  const amountCents = Number(req.body?.amountCents ?? 0);
  const currency = String(req.body?.currency || 'usd').trim().toLowerCase();
  const description = String(req.body?.description || '').trim();

  if (!invoiceNumber || !Number.isFinite(amountCents) || amountCents <= 0) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'invoiceNumber and a positive amountCents value are required.');
  }

  const createdAt = new Date().toISOString();
  const invoiceId = `inv_${crypto.randomUUID()}`;

  await query(
    `INSERT INTO billing_invoices (id, organization_id, invoice_number, amount_cents, currency, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [invoiceId, organizationId, invoiceNumber, amountCents, currency, description, 'open', createdAt]
  );

  await query(
    `INSERT INTO billing_events (id, organization_id, actor_user_id, event_type, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`billing_${crypto.randomUUID()}`, organizationId, req.developer.id, 'invoice.created', JSON.stringify({
      invoiceId,
      invoiceNumber,
      amountCents,
      currency,
      description,
    }), createdAt]
  );

  return res.status(201).json({
    invoice: {
      id: invoiceId,
      invoiceNumber,
      amountCents,
      currency,
      description,
      status: 'open',
      createdAt,
    },
  });
}));

router.get('/organization/billing-events', requireDeveloperSession, asyncHandler(async (req, res) => {
  const organizationId = await getOrganizationIdForUser(req.developer.id);

  if (!organizationId) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  const { rows } = await query(
    `SELECT id, event_type AS eventType, metadata, created_at AS createdAt
     FROM billing_events
     WHERE organization_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [organizationId]
  );

  return res.json({ events: rows.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    metadata: (() => {
      try { return JSON.parse(event.metadata || '{}'); } catch { return {}; }
    })(),
    createdAt: event.createdAt,
  })) });
}));

router.post('/organization/billing/webhook', asyncHandler(async (req, res) => {
  const sessionUser = await developerAuth.getSession(cookieValue(req, SESSION_COOKIE));
  const authHeader = req.get('authorization') || '';
  const webhookSecret = req.get('x-webhook-secret') || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');

  if (config.billingWebhookSecret && webhookSecret && webhookSecret !== config.billingWebhookSecret) {
    return sendError(req, res, 401, 'INVALID_WEBHOOK_SIGNATURE', 'The billing webhook signature is invalid.');
  }

  if (!sessionUser && config.billingWebhookSecret && webhookSecret !== config.billingWebhookSecret) {
    return sendError(req, res, 401, 'AUTHENTICATION_REQUIRED', 'Sign in or provide a valid webhook secret.');
  }

  const actor = sessionUser || { id: 'billing-webhook' };
  const organizationId = sessionUser ? await getOrganizationIdForUser(actor.id) : await getOrganizationIdForUser(req.body?.userId || '');

  if (!organizationId && !sessionUser) {
    return sendError(req, res, 401, 'AUTHENTICATION_REQUIRED', 'A workspace session or valid webhook secret is required.');
  }

  const invoiceNumber = String(req.body?.invoiceNumber || req.body?.invoice_number || '').trim();
  const eventType = String(req.body?.eventType || req.body?.type || 'invoice.updated').trim() || 'invoice.updated';
  const status = String(req.body?.status || req.body?.state || '').trim().toLowerCase();
  const normalizedStatus = ['open', 'paid', 'voided'].includes(status) ? status : (eventType.includes('paid') ? 'paid' : 'open');

  if (!invoiceNumber) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'invoiceNumber is required.');
  }

  const invoice = await query(
    `SELECT id, organization_id, status, invoice_number AS invoiceNumber FROM billing_invoices WHERE organization_id = ? AND invoice_number = ?`,
    [organizationId, invoiceNumber]
  );

  if (!invoice.rows[0]) {
    return sendError(req, res, 404, 'INVOICE_NOT_FOUND', 'Invoice not found for this workspace.');
  }

  const createdAt = new Date().toISOString();
  await query(
    `UPDATE billing_invoices SET status = ?, paid_at = ? WHERE id = ?`,
    [normalizedStatus, normalizedStatus === 'paid' ? createdAt : null, invoice.rows[0].id]
  );

  await query(
    `INSERT INTO billing_events (id, organization_id, actor_user_id, event_type, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`billing_${crypto.randomUUID()}`, organizationId, sessionUser?.id || null, eventType, JSON.stringify({
      invoiceId: invoice.rows[0].id,
      invoiceNumber,
      status: normalizedStatus,
      eventType,
    }), createdAt]
  );

  await query(
    `INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [`audit_${crypto.randomUUID()}`, organizationId, null, sessionUser?.id || null, null, 'billing.webhook.processed', JSON.stringify({
      invoiceNumber,
      eventType,
      status: normalizedStatus,
    }), createdAt]
  );

  return res.json({ success: true, invoiceStatus: normalizedStatus, eventType });
}));

router.delete('/organization/members/:userId', requireSameOrigin, requireDeveloperSession, requireOrganizationMembership, asyncHandler(async (req, res) => {
  const actor = await query(
    `SELECT role FROM organization_members
     WHERE organization_id = ? AND user_id = ?`,
    [req.organizationId, req.developer.id]
  );

  if (!actor.rows[0] || !['owner', 'admin'].includes(actor.rows[0].role)) {
    return sendError(req, res, 403, 'FORBIDDEN', 'Only workspace owners and admins can remove members.');
  }

  if (req.params.userId === String(req.developer.id)) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'You cannot remove yourself from the workspace.');
  }

  const target = await query(
    `SELECT organization_id AS organizationId, role FROM organization_members WHERE user_id = ?`,
    [req.params.userId]
  );

  if (!target.rows.length) {
    return sendError(req, res, 404, 'NOT_FOUND', 'Member not found in this workspace.');
  }

  const targetInCurrentOrg = target.rows.find((member) => member.organizationId === req.organizationId);
  if (!targetInCurrentOrg) {
    return sendError(req, res, 404, 'NOT_FOUND', 'Member not found in this workspace.');
  }

  if (targetInCurrentOrg.role === 'owner') {
    return sendError(req, res, 403, 'FORBIDDEN', 'The workspace owner cannot be removed.');
  }

  const deleted = await query(
    `DELETE FROM organization_members WHERE user_id = ?`,
    [req.params.userId]
  );

  if (deleted.changes === 0) {
    return sendError(req, res, 404, 'NOT_FOUND', 'Member not found or could not be removed.');
  }

  await query(
    'INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`audit_${crypto.randomUUID()}`, req.organizationId, null, req.developer.id, null, 'organization.member.removed', JSON.stringify({ userId: req.params.userId }), new Date().toISOString()]
  );

  return res.json({ success: true, userId: req.params.userId });
}));

router.post('/organization/members', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const actor = await query(
    `SELECT role FROM organization_members
     WHERE organization_id = (
       SELECT organization_id FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1
     ) AND user_id = ?`,
    [req.developer.id, req.developer.id]
  );

  if (!actor.rows[0] || !['owner', 'admin'].includes(actor.rows[0].role)) {
    return sendError(req, res, 403, 'FORBIDDEN', 'Only workspace owners and admins can add members.');
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = String(req.body?.role || 'member').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'A valid email is required.');
  }
  if (!['owner', 'admin', 'member'].includes(role)) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'role must be owner, admin, or member.');
  }

  const organizationId = await query(
    `SELECT organization_id AS organizationId FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
    [req.developer.id]
  );

  const userMatch = await query('SELECT id, email, name FROM users WHERE email = ?', [email]);
  if (!userMatch.rows[0]) {
    return sendError(req, res, 404, 'USER_NOT_FOUND', 'No developer account exists for that email yet.');
  }

  const existingMembership = await query(
    `SELECT user_id FROM organization_members WHERE organization_id = ? AND user_id = ?`,
    [organizationId.rows[0].organizationId, userMatch.rows[0].id]
  );

  if (existingMembership.rows[0]) {
    return sendError(req, res, 409, 'CONFLICT', 'This user is already part of the workspace.');
  }

  await query(
    'INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    [organizationId.rows[0].organizationId, userMatch.rows[0].id, role, new Date().toISOString()]
  );

  await query(
    'INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`audit_${crypto.randomUUID()}`, organizationId.rows[0].organizationId, null, req.developer.id, null, 'organization.member.added', JSON.stringify({ userId: userMatch.rows[0].id, email, role }), new Date().toISOString()]
  );

  return res.status(201).json({ member: { id: userMatch.rows[0].id, email: userMatch.rows[0].email, name: userMatch.rows[0].name, role } });
}));

router.patch('/organization/members/:userId/role', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const actor = await query(
    `SELECT role FROM organization_members
     WHERE organization_id = (
       SELECT organization_id FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1
     ) AND user_id = ?`,
    [req.developer.id, req.developer.id]
  );

  if (!actor.rows[0] || !['owner', 'admin'].includes(actor.rows[0].role)) {
    return sendError(req, res, 403, 'FORBIDDEN', 'Only workspace owners and admins can update member roles.');
  }

  const role = String(req.body?.role || '').trim().toLowerCase();
  if (!['owner', 'admin', 'member'].includes(role)) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'role must be owner, admin, or member.');
  }

  const organizationId = await query(
    `SELECT organization_id AS organizationId FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
    [req.developer.id]
  );

  const updated = await query(
    `UPDATE organization_members SET role = ?
     WHERE organization_id = ? AND user_id = ? AND user_id != ? AND role != 'owner'`,
    [role, organizationId.rows[0].organizationId, req.params.userId, req.developer.id]
  );

  if (updated.changes === 0) {
    return sendError(req, res, 404, 'NOT_FOUND', 'Member not found or cannot be changed.');
  }

  await query(
    'INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`audit_${crypto.randomUUID()}`, organizationId.rows[0].organizationId, null, req.developer.id, null, 'organization.member.role_updated', JSON.stringify({ userId: req.params.userId, role }), new Date().toISOString()]
  );

  return res.json({ success: true, userId: req.params.userId, role });
}));

router.post('/organization/plan', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const planName = String(req.body?.planName || req.body?.plan_name || '').trim().toLowerCase();
  if (!planName || !PLAN_DEFINITIONS[planName]) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'planName must be one of starter, growth, scale, or enterprise.');
  }

  const organizationId = await query(
    `SELECT organization_id AS organizationId FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
    [req.developer.id]
  );

  if (!organizationId.rows[0]) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  await query('UPDATE organizations SET plan_name = ? WHERE id = ?', [planName, organizationId.rows[0].organizationId]);
  await query(
    'INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`audit_${crypto.randomUUID()}`, organizationId.rows[0].organizationId, null, req.developer.id, null, 'organization.plan.updated', JSON.stringify({ planName }), new Date().toISOString()]
  );

  const refresh = await query(
    `SELECT organizations.id, organizations.name, organizations.owner_user_id AS ownerUserId,
            organizations.created_at AS createdAt, COALESCE(organizations.plan_name, 'starter') AS planName,
            COALESCE(organizations.billing_status, 'active') AS billingStatus,
            COUNT(DISTINCT organization_members.user_id) AS memberCount,
            COUNT(DISTINCT projects.id) AS projectCount
     FROM organizations
     JOIN organization_members ON organization_members.organization_id = organizations.id
     LEFT JOIN projects ON projects.organization_id = organizations.id
     WHERE organizations.id = ?
     GROUP BY organizations.id, organizations.name, organizations.owner_user_id, organizations.created_at,
              organizations.plan_name, organizations.billing_status`,
    [organizationId.rows[0].organizationId]
  );

  const organization = refresh.rows[0];
  const plan = getOrganizationPlan(organization.planName || 'starter');

  return res.json({
    organization: {
      id: organization.id,
      name: organization.name,
      ownerUserId: organization.ownerUserId,
      createdAt: organization.createdAt,
      planName: plan.name,
      billingStatus: organization.billingStatus || 'active',
      memberCount: Number(organization.memberCount || 0),
      projectCount: Number(organization.projectCount || 0),
      plan: { ...plan },
    },
  });
}));

router.patch('/organization', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const organizationId = await query(
    `SELECT organizations.id FROM organizations
     JOIN organization_members ON organization_members.organization_id = organizations.id
     WHERE organization_members.user_id = ? AND organization_members.role IN ('owner', 'admin')
     ORDER BY organization_members.created_at ASC LIMIT 1`,
    [req.developer.id]
  );

  if (!organizationId.rows[0]) {
    return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  }

  const updates = [];
  const values = [];
  const name = String(req.body?.name || '').trim();
  if (name) {
    updates.push('name = ?');
    values.push(name);
  }

  const planName = String(req.body?.planName || req.body?.plan_name || '').trim().toLowerCase();
  if (planName) {
    const validPlans = ['starter', 'growth', 'scale', 'enterprise'];
    if (!validPlans.includes(planName)) {
      return sendError(req, res, 400, 'INVALID_REQUEST', 'planName must be one of starter, growth, scale, or enterprise.');
    }
    updates.push('plan_name = ?');
    values.push(planName);
  }

  if (!updates.length) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'Provide a name or planName to update.');
  }

  values.push(organizationId.rows[0].id);
  await query(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`, values);

  const refresh = await query(
    `SELECT id, name, owner_user_id AS ownerUserId, created_at AS createdAt,
            COALESCE(plan_name, 'starter') AS planName,
            COALESCE(billing_status, 'active') AS billingStatus
     FROM organizations WHERE id = ?`,
    [organizationId.rows[0].id]
  );

  return res.json({ organization: refresh.rows[0] });
}));

router.get('/projects', requireDeveloperSession, asyncHandler(async (req, res) => {
  return res.json({ projects: await projectService.listProjects(req.developer.id) });
}));

router.post('/projects', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  try {
    return res.status(201).json({ project: await projectService.createProject(req.developer.id, req.body?.name) });
  } catch (error) {
    if (error.code === '23505' || /unique constraint/i.test(error.message || '')) {
      return sendError(req, res, 409, 'CONFLICT', 'A project with that name already exists in this workspace.');
    }
    throw error;
  }
}));

router.get('/projects/:projectId', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  return res.json({ project });
}));

router.delete('/projects/:projectId', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  await query("UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?", [new Date().toISOString(), project.id]);
  const customers = await query('SELECT external_user_id AS userId FROM customers WHERE project_id = ?', [project.id]);
  for (const customer of customers.rows) {
    await memoryService.clear(customer.userId, project.organizationId, project.id);
  }
  await projectService.deleteProject(req.developer.id, project.id);
  return res.json({ success: true });
}));

router.get('/projects/:projectId/api-keys', requireDeveloperSession, asyncHandler(async (req, res) => {
  const keys = await projectService.listApiKeys(req.developer.id, req.params.projectId);
  if (!keys) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  return res.json({ keys });
}));

router.post('/projects/:projectId/api-keys', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  const created = await projectService.createApiKey(req.developer.id, req.params.projectId, req.body || {});
  await query(
    `INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [`audit_${crypto.randomUUID()}`, project.organizationId, created.metadata.projectId, req.developer.id, created.metadata.id,
      'api_key.created', JSON.stringify({ name: created.metadata.name, environment: created.metadata.environment }), created.metadata.createdAt]
  );
  res.setHeader('Cache-Control', 'no-store');
  return res.status(201).json(created);
}));

router.delete('/projects/:projectId/api-keys/:keyId', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const revoked = await projectService.revokeApiKey(req.developer.id, req.params.projectId, req.params.keyId);
  if (!revoked) return sendError(req, res, 404, 'NOT_FOUND', 'API key not found.');
  return res.json({ success: true });
}));

router.get('/projects/:projectId/tools', requireDeveloperSession, asyncHandler(async (req, res) => {
  const tools = await projectToolService.listProjectTools(req.developer.id, req.params.projectId);
  if (!tools) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  return res.json({ tools });
}));

router.post('/projects/:projectId/tools', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const tool = await projectToolService.createProjectTool(req.developer.id, req.params.projectId, req.body || {});
  if (!tool) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  return res.status(201).json({ tool });
}));

router.get('/projects/:projectId/tools/:toolId', requireDeveloperSession, asyncHandler(async (req, res) => {
  const tool = await projectToolService.getOwnedProjectTool(req.developer.id, req.params.projectId, req.params.toolId);
  if (!tool) return sendError(req, res, 404, 'TOOL_NOT_FOUND', 'Tool not found.');
  return res.json({ tool });
}));

router.post('/projects/:projectId/tools/:toolId/execute', requireProjectApiKey, asyncHandler(async (req, res) => {
  if (req.projectId !== req.params.projectId) {
    return sendError(req, res, 403, 'PROJECT_MISMATCH', 'This API key is not valid for the selected project.');
  }

  const response = await projectToolService.executeProjectTool(req.projectId, req.params.toolId, req.body || {});
  return res.json(response);
}));

router.get('/projects/:projectId/usage', requireDeveloperSession, asyncHandler(async (req, res) => {
  if (!await projectService.getOwnedProject(req.developer.id, req.params.projectId)) {
    return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }
  const { rows } = await query(
    `SELECT COUNT(*) AS total_requests,
            SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) AS successful_requests,
            SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed_requests,
            COALESCE(AVG(duration_ms), 0) AS average_response_time_ms,
            COALESCE(SUM(memory_operations), 0) AS memory_operations
     FROM usage_records WHERE project_id = ? AND created_at >= ?`,
    [req.params.projectId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()]
  );
  return res.json({ usage: rows[0] || {} });
}));

const customersForProject = async (projectId, externalUserId) => {
  if (externalUserId) {
    const { rows } = await query(
      `SELECT id, project_id AS projectId, external_user_id AS userId, metadata,
              created_at AS createdAt, last_seen_at AS lastSeenAt
       FROM customers WHERE project_id = ? AND external_user_id = ?`,
      [projectId, externalUserId]
    );
    return rows[0] || null;
  }
  const { rows } = await query(
    `SELECT id, project_id AS projectId, external_user_id AS userId, metadata,
            created_at AS createdAt, last_seen_at AS lastSeenAt
     FROM customers WHERE project_id = ? ORDER BY last_seen_at DESC LIMIT 100`,
    [projectId]
  );
  return rows;
};

router.get('/support/customers', requireDeveloperSession, asyncHandler(async (req, res) => {
  const projectId = String(req.query.project_id || '').trim();
  if (!projectId || !await projectService.getOwnedProject(req.developer.id, projectId)) {
    return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  }
  return res.json({ customers: await customersForProject(projectId) });
}));

router.get('/support/customers/:userId', requireDeveloperProject, asyncHandler(async (req, res) => {
  const customer = await customersForProject(req.projectId, req.params.userId);
  if (!customer) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  return res.json({ customer });
}));

router.get('/support/customers/:userId/memory', requireDeveloperProject, asyncHandler(async (req, res) => {
  const customer = await customersForProject(req.projectId, req.params.userId);
  if (!customer) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  const project = await query('SELECT organization_id AS organizationId FROM projects WHERE id = ?', [req.projectId]);
  const memory = await supportAgentService.getMemorySnapshot({ userId: req.params.userId, tenantId: project.rows[0].organizationId, projectId: req.projectId });
  return res.json({ user_id: req.params.userId, memory: memory.facts });
}));

const validateExternalIdentity = (req, res) => {
  const userId = req.body?.user_id;
  if (typeof userId !== 'string' || !validateUserId(userId)) {
    sendError(req, res, 400, 'MISSING_USER_ID', 'A valid user_id is required.');
    return null;
  }
  return userId.trim();
};

const sanitizeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '{}';
  const safe = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 30)) {
    if (/password|token|secret|credential|card|authorization|api.?key/i.test(key)) continue;
    if (typeof value === 'string') safe[key.slice(0, 80)] = sanitizeText(value).slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) safe[key.slice(0, 80)] = value;
  }
  const serialized = JSON.stringify(safe);
  return serialized.length <= 10000 ? serialized : '{}';
};

const getOrCreateCustomer = async (req, userId) => {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO customers (id, project_id, external_user_id, metadata, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id, external_user_id) DO UPDATE SET
       metadata = excluded.metadata, last_seen_at = excluded.last_seen_at`,
    [`cus_${crypto.randomUUID()}`, req.projectId, userId, sanitizeMetadata(req.body?.metadata), now, now]
  );
  const { rows } = await query(
    'SELECT id FROM customers WHERE project_id = ? AND external_user_id = ?',
    [req.projectId, userId]
  );
  return rows[0].id;
};

const getOrCreateConversation = async (req, customerId) => {
  const requestedId = req.body?.conversation_id;
  if (requestedId !== undefined && (typeof requestedId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestedId))) {
    const error = new Error('conversation_id is invalid.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }
  const id = requestedId || `conv_${crypto.randomUUID()}`;
  const found = await query('SELECT project_id AS projectId, customer_id AS customerId FROM conversations WHERE id = ?', [id]);
  if (found.rows[0] && (found.rows[0].projectId !== req.projectId || found.rows[0].customerId !== customerId)) {
    const error = new Error('Conversation not found.');
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  const now = new Date().toISOString();
  if (found.rows[0]) {
    await query('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, id]);
  } else {
    await query(
      `INSERT INTO conversations (id, project_id, customer_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, ?)`,
      [id, req.projectId, customerId, now, now]
    );
  }
  return id;
};

const recordUsage = async (req, statusCode, durationMs, memoryOperations) => {
  try {
    await query(
      `INSERT INTO usage_records (id, project_id, api_key_id, request_id, endpoint, status_code, duration_ms, memory_operations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`usage_${crypto.randomUUID()}`, req.projectId, req.projectKey?.id || null, req.requestId || '', req.path, statusCode, durationMs, memoryOperations, new Date().toISOString()]
    );
  } catch {
    // A usage-write failure must not replace the support request result.
  }
};

const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: (req) => {
    if (req.organizationPlan && req.organizationPlan.maxRequestsPer15Min) {
      return req.organizationPlan.maxRequestsPer15Min;
    }
    return req.projectKey?.environment === 'live' ? 300 : 120;
  },
  keyGenerator: (req) => req.projectKey?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendError(req, res, 429, 'RATE_LIMIT_EXCEEDED', 'Too many requests. Please retry later.'),
});

router.post('/support/chat', requireProjectApiKey, supportLimiter, asyncHandler(async (req, res, next) => {
  const startedAt = Date.now();
  let statusCode = 200;
  let memoryOperations = 0;
  try {
    const userId = validateExternalIdentity(req, res);
    if (!userId) {
      statusCode = 400;
      return;
    }
    const message = sanitizeText(req.body?.message || '');
    if (!message || message.length > 8000) {
      statusCode = 400;
      return sendError(req, res, 400, 'INVALID_REQUEST', 'message is required and must be 8,000 characters or fewer.');
    }
    const customerId = await getOrCreateCustomer(req, userId);
    const conversationId = await getOrCreateConversation(req, customerId);
    const result = await supportAgentService.processSupportMessage({
      userId,
      message,
      tenantId: req.organizationId,
      projectId: req.projectId,
      requestId: req.requestId,
    });
    memoryOperations = result.memoryUsed ? 1 : 0;
    return res.json({
      request_id: req.requestId,
      conversation_id: conversationId,
      user_id: userId,
      response: result.reply,
      memory_used: result.memoryUsed,
    });
  } catch (error) {
    statusCode = error.statusCode || 500;
    return next(error);
  } finally {
    await recordUsage(req, statusCode, Date.now() - startedAt, memoryOperations);
  }
}));

router.post('/support/end', requireProjectApiKey, supportLimiter, asyncHandler(async (req, res, next) => {
  const startedAt = Date.now();
  let statusCode = 200;
  try {
    const userId = validateExternalIdentity(req, res);
    if (!userId) {
      statusCode = 400;
      return;
    }
    if (!Array.isArray(req.body?.messages) || !req.body.messages.length) {
      statusCode = 400;
      return sendError(req, res, 400, 'INVALID_REQUEST', 'messages must contain at least one message.');
    }
    const customerId = await getOrCreateCustomer(req, userId);
    const conversationId = await getOrCreateConversation(req, customerId);
    const result = await supportAgentService.finalizeSession({
      userId,
      messages: req.body.messages,
      tenantId: req.organizationId,
      projectId: req.projectId,
    });
    await query("UPDATE conversations SET status = 'closed', updated_at = ? WHERE id = ? AND project_id = ?", [new Date().toISOString(), conversationId, req.projectId]);
    return res.json({ request_id: req.requestId, conversation_id: conversationId, user_id: userId, facts_stored: result.factsStored || 0 });
  } catch (error) {
    statusCode = error.statusCode || 500;
    return next(error);
  } finally {
    await recordUsage(req, statusCode, Date.now() - startedAt, 1);
  }
}));

router.get('/support/memory/:userId', requireProjectApiKey, asyncHandler(async (req, res) => {
  if (!validateUserId(req.params.userId)) return sendError(req, res, 400, 'INVALID_REQUEST', 'user_id is invalid.');
  const memory = await supportAgentService.getMemorySnapshot({ userId: req.params.userId, tenantId: req.organizationId, projectId: req.projectId });
  return res.json({ request_id: req.requestId, user_id: req.params.userId, memory: memory.facts });
}));

router.delete('/support/memory/:userId', requireProjectApiKey, asyncHandler(async (req, res) => {
  if (!validateUserId(req.params.userId)) return sendError(req, res, 400, 'INVALID_REQUEST', 'user_id is invalid.');
  await supportAgentService.clearMemory({ userId: req.params.userId, tenantId: req.organizationId, projectId: req.projectId });
  return res.json({ request_id: req.requestId, user_id: req.params.userId, success: true });
}));

router.get('/support/customers/:userId/memory', requireDeveloperProject, asyncHandler(async (req, res) => {
  const customer = await customersForProject(req.projectId, req.params.userId);
  if (!customer) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  const memory = await supportAgentService.getMemorySnapshot({ userId: req.params.userId, tenantId: req.organizationId, projectId: req.projectId });
  return res.json({ request_id: req.requestId, user_id: req.params.userId, memory: memory.facts });
}));

router.delete('/support/customers/:userId/memory', requireSameOrigin, requireDeveloperProject, asyncHandler(async (req, res) => {
  const customer = await customersForProject(req.projectId, req.params.userId);
  if (!customer) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  await supportAgentService.clearMemory({ userId: req.params.userId, tenantId: req.organizationId, projectId: req.projectId });
  return res.json({ request_id: req.requestId, user_id: req.params.userId, success: true });
}));

module.exports = router;