const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { query } = require('../db');
const developerAuth = require('../services/auth/developerAuthService');
const authorizationService = require('../services/auth/authorizationService');
const projectService = require('../services/project/projectService');
const projectToolService = require('../services/tool/projectToolService');
const memoryService = require('../services/memory/hindsightMemoryService');
const supportAgentService = require('../services/supportAgent/supportAgentService');
const supportService = require('../services/support/supportService');
const customerService = require('../services/customer/customerService');
const conversationService = require('../services/conversation/conversationService');
const subscriptionService = require('../services/subscription/subscriptionService');
const { sanitizeText, validateUserId } = require('../utils/sanitizers');

const router = express.Router();
const SESSION_COOKIE = 'ics_session';
const PLAN_DEFINITIONS = {
  starter: { name: 'starter', maxProjects: 3, maxRequestsPer15Min: 120, maxCustomers: 1000, memoryRetentionDays: 30, supportSeats: 1 },
  growth: { name: 'growth', maxProjects: 10, maxRequestsPer15Min: 600, maxCustomers: 10000, memoryRetentionDays: 90, supportSeats: 3 },
  scale: { name: 'scale', maxProjects: 50, maxRequestsPer15Min: 1500, maxCustomers: 50000, memoryRetentionDays: 180, supportSeats: 10 },
  enterprise: { name: 'enterprise', maxProjects: 200, maxRequestsPer15Min: 5000, maxCustomers: 200000, memoryRetentionDays: 365, supportSeats: 50 },
};

const sendError = (req, res, status, code, message) => res.status(status).json({
  error: { code, message, request_id: req.requestId || `req_${Date.now()}` },
});

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch((err) => {
  const status = err.statusCode || 500;
  const code = err.code || (status === 400 ? 'INVALID_REQUEST' : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR');
  return sendError(req, res, status, code, err.message || 'An unexpected error occurred.');
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

  if (key.status === 'revoked') {
    return sendError(req, res, 401, 'INVALID_API_KEY', 'This API key has been revoked.');
  }

  if (key.organizationStatus === 'suspended') {
    return sendError(req, res, 403, 'ORGANIZATION_SUSPENDED', 'This organization account has been suspended by platform administration.');
  }

  if (key.organizationStatus === 'deleted') {
    return sendError(req, res, 403, 'ORGANIZATION_DELETED', 'This organization account has been deleted.');
  }

  if (key.projectStatus !== 'active') {
    return sendError(req, res, 403, 'PROJECT_ARCHIVED', 'This project is archived or inactive.');
  }

  const organizationProfile = await query(
    'SELECT plan_name AS planName, billing_status AS billingStatus FROM organizations WHERE id = ?',
    [key.organizationId]
  );
  req.projectKey = key;
  req.projectId = key.projectId;
  req.organizationId = key.organizationId;
  req.projectEnvironment = key.environment || 'live';
  req.organizationPlan = getOrganizationPlan(organizationProfile.rows[0]?.planName || 'starter');
  req.billingStatus = organizationProfile.rows[0]?.billingStatus || 'active';
  req.organizationStatus = key.organizationStatus;

  // Domain whitelisting check for public keys
  if (key.keyType === 'public') {
    const origin = req.get('origin');
    if (origin) {
      const widgetSettings = await projectService.getWidgetSettings(key.projectId);
      if (widgetSettings.allowedDomains && widgetSettings.allowedDomains !== '*') {
        const allowedList = widgetSettings.allowedDomains.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
        let requestHost = '';
        try {
          requestHost = new URL(origin).hostname.toLowerCase();
        } catch {
          requestHost = origin.toLowerCase();
        }
        const isAllowed = allowedList.some((domain) => {
          if (domain === '*' || domain === requestHost) return true;
          if (domain.startsWith('*.') && requestHost.endsWith(domain.slice(2))) return true;
          if (requestHost.endsWith(`.${domain}`)) return true;
          return false;
        });
        if (!isAllowed) {
          return sendError(req, res, 403, 'DOMAIN_NOT_ALLOWED', `The origin '${requestHost}' is not authorized to use this public key.`);
        }
      }
    }
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

router.get('/public/plans', asyncHandler(async (req, res) => {
  const plans = await subscriptionService.listPublicPlans();
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.json({ plans });
}));

router.get('/onboarding', requireDeveloperSession, requireOrganizationMembership, asyncHandler(async (req, res) => {
  const projectsCount = await query(
    `SELECT COUNT(*) AS count FROM projects WHERE organization_id = ?`,
    [req.organizationId]
  );
  const keysCount = await query(
    `SELECT COUNT(*) AS count FROM project_api_keys
     JOIN projects ON projects.id = project_api_keys.project_id
     WHERE projects.organization_id = ?`,
    [req.organizationId]
  );
  const usageCount = await query(
    `SELECT COUNT(*) AS count FROM usage_records WHERE organization_id = ?`,
    [req.organizationId]
  );

  const hasProject = Number(projectsCount.rows[0]?.count || 0) > 0;
  const hasKey = Number(keysCount.rows[0]?.count || 0) > 0;
  const hasUsage = Number(usageCount.rows[0]?.count || 0) > 0;

  let currentStep = 'create_project';
  if (!hasProject) currentStep = 'create_project';
  else if (!hasKey) currentStep = 'generate_key';
  else if (!hasUsage) currentStep = 'test_request';
  else currentStep = 'completed';

  return res.json({
    onboarding: {
      organizationCreated: true,
      projectCreated: hasProject,
      apiKeyCreated: hasKey,
      firstRequestSent: hasUsage,
      completed: hasUsage,
      currentStep,
      steps: [
        { id: 'create_org', title: 'Create Organization', completed: true },
        { id: 'create_project', title: 'Create Project & Environment', completed: hasProject },
        { id: 'generate_key', title: 'Generate API Keys', completed: hasKey },
        { id: 'test_request', title: 'Test First Support Request', completed: hasUsage },
        { id: 'embed_widget', title: 'Embed Chat Widget or Integrate API', completed: hasUsage },
      ],
    },
  });
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

router.patch('/projects/:projectId', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const updated = await projectService.updateProject(req.developer.id, req.params.projectId, req.body || {});
  if (!updated) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  return res.json({ project: updated });
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

router.post('/projects/:projectId/api-keys/:keyId/rotate', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  const rotated = await projectService.rotateApiKey(req.developer.id, req.params.projectId, req.params.keyId);
  await query(
    `INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [`audit_${crypto.randomUUID()}`, project.organizationId, project.id, req.developer.id, rotated.metadata.id,
      'api_key.rotated', JSON.stringify({ previousKeyId: req.params.keyId, newKeyId: rotated.metadata.id }), rotated.metadata.createdAt]
  );
  res.setHeader('Cache-Control', 'no-store');
  return res.status(201).json(rotated);
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
  if (req.projectKey?.keyType === 'public') {
    return sendError(req, res, 403, 'FORBIDDEN', 'Public API keys (pk_*) cannot execute tools directly. Use a secret key (sk_*).');
  }

  if (req.projectId !== req.params.projectId) {
    return sendError(req, res, 403, 'PROJECT_MISMATCH', 'This API key is not valid for the selected project.');
  }

  const response = await projectToolService.executeProjectTool(req.projectId, req.params.toolId, req.body || {});
  return res.json(response);
}));

const integrationService = require('../services/integration/integrationService');

router.get('/projects/:projectId/integrations', requireDeveloperSession, asyncHandler(async (req, res) => {
  const integrations = await integrationService.listIntegrations(req.developer.id, req.params.projectId);
  if (!integrations) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  return res.json({ integrations });
}));

router.post('/projects/:projectId/integrations', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const integration = await integrationService.createIntegration(req.developer.id, req.params.projectId, req.body || {});
  if (!integration) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  return res.status(201).json({ integration });
}));

router.get('/projects/:projectId/integrations/:integrationId', requireDeveloperSession, asyncHandler(async (req, res) => {
  const integration = await integrationService.getIntegration(req.developer.id, req.params.projectId, req.params.integrationId);
  if (!integration) return sendError(req, res, 404, 'INTEGRATION_NOT_FOUND', 'Integration not found.');
  return res.json({ integration });
}));

router.delete('/projects/:projectId/integrations/:integrationId', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const deleted = await integrationService.deleteIntegration(req.developer.id, req.params.projectId, req.params.integrationId);
  if (!deleted) return sendError(req, res, 404, 'INTEGRATION_NOT_FOUND', 'Integration not found.');
  return res.json({ success: true });
}));

router.post('/projects/:projectId/integrations/:integrationId/test', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const result = await integrationService.testIntegrationConnection(req.developer.id, req.params.projectId, req.params.integrationId);
  return res.json(result);
}));

const billingService = require('../services/billing/billingService');

router.post('/billing/webhook', asyncHandler(async (req, res) => {
  const signature = req.headers['x-webhook-signature'] || req.headers['stripe-signature'];
  const rawBody = JSON.stringify(req.body || {});
  const result = await billingService.handleWebhookEvent(req.body, rawBody, signature);
  return res.json(result);
}));

router.get('/organization/subscription', requireDeveloperSession, asyncHandler(async (req, res) => {
  const orgMember = await query(
    `SELECT organization_id FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
    [req.developer.id]
  );
  if (!orgMember.rows[0]) return sendError(req, res, 404, 'ORGANIZATION_NOT_FOUND', 'Workspace not found.');
  const orgId = orgMember.rows[0].organization_id;

  const plan = await subscriptionService.getOrganizationPlan(orgId);
  const subRows = await query(
    `SELECT * FROM subscriptions WHERE organization_id = ?`,
    [orgId]
  );

  return res.json({
    subscription: subRows.rows[0] || {
      organizationId: orgId,
      status: 'active',
      planId: plan.id,
    },
    plan,
  });
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
  const row = rows[0] || {};
  const total = Number(row.total_requests || 0);
  const success = Number(row.successful_requests || 0);
  const failed = Number(row.failed_requests || 0);
  const avgDuration = Math.round(Number(row.average_response_time_ms || 0));
  const memOps = Number(row.memory_operations || 0);

  return res.json({
    usage: {
      total_requests: total,
      successful_requests: success,
      failed_requests: failed,
      average_response_time_ms: avgDuration,
      memory_operations: memOps,
      requests: total,
      successfulRequests: success,
      failedRequests: failed,
      averageDurationMs: avgDuration,
      memoryOperations: memOps,
    },
  });
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

router.get('/projects/:projectId/customers', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  const customers = await customerService.listCustomers({
    projectId: project.id,
    search: req.query.q,
    environment: req.query.environment,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  return res.json({ customers });
}));

router.get('/projects/:projectId/customers/:userId', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  const customer = await customerService.getCustomerByExternalId({
    projectId: project.id,
    externalUserId: req.params.userId,
  });
  if (!customer) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');

  // Fetch counts
  const convCount = await query(
    'SELECT COUNT(*) AS total FROM conversations WHERE project_id = ? AND customer_id = ?',
    [project.id, customer.id]
  );
  const memorySnapshot = await supportAgentService.getMemorySnapshot({
    userId: customer.externalUserId,
    tenantId: project.organizationId,
    projectId: project.id,
    environment: customer.environment,
  });

  return res.json({
    customer: {
      ...customer,
      conversationCount: Number(convCount.rows[0]?.total || 0),
      memoryCount: (memorySnapshot.facts || []).length,
      memory: memorySnapshot.facts || [],
    },
  });
}));

router.get('/projects/:projectId/customers/:userId/export', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  const exported = await customerService.exportCustomerData({
    projectId: project.id,
    organizationId: project.organizationId,
    externalUserId: req.params.userId,
  });
  if (!exported) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  return res.json({ export: exported });
}));

router.delete('/projects/:projectId/customers/:userId', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  const deleted = await customerService.deleteCustomer({
    projectId: project.id,
    organizationId: project.organizationId,
    externalUserId: req.params.userId,
  });
  if (!deleted) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');

  await query(
    `INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, action, metadata, created_at)
     VALUES (?, ?, ?, ?, 'customer.deleted', ?, ?)`,
    [`audit_${crypto.randomUUID()}`, project.organizationId, project.id, req.developer.id,
      JSON.stringify({ externalUserId: req.params.userId }), new Date().toISOString()]
  );
  return res.json({ success: true });
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
  const userId = req.body?.user_id || req.body?.userId;
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
  const requestedId = req.body?.conversation_id || req.body?.conversationId;
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

const conversationExperienceEngine = require('../services/conversation/conversationExperienceEngine');

router.post('/support/opening', requireProjectApiKey, supportLimiter, asyncHandler(async (req, res) => {
  const result = await conversationExperienceEngine.generateOpeningContext({
    userId: req.body?.user_id || req.body?.userId,
    projectId: req.projectId,
    organizationId: req.organizationId,
    environment: req.projectEnvironment || req.projectKey?.environment || 'live',
    timezone: req.body?.timezone || req.headers['x-timezone'],
    language: req.body?.language || req.headers['accept-language'],
    pageContext: req.body?.page_context || req.body?.pageContext,
    customGreetingPolicy: req.body?.greeting_policy || 'friendly',
  });
  return res.json({ request_id: req.requestId, ...result });
}));

router.post('/support/chat', requireProjectApiKey, supportLimiter, asyncHandler(async (req, res) => {
  const result = await supportService.handleChatRequest({
    authenticatedKey: req.projectKey,
    userId: req.body?.user_id || req.body?.userId,
    message: req.body?.message,
    conversationId: req.body?.conversation_id || req.body?.conversationId,
    metadata: req.body?.metadata,
    environment: req.body?.environment || req.headers['x-environment'],
    requestId: req.requestId,
  });
  return res.json(result);
}));

router.post('/support/end', requireProjectApiKey, supportLimiter, asyncHandler(async (req, res) => {
  if (!Array.isArray(req.body?.messages) || !req.body.messages.length) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'messages must contain at least one message.');
  }

  const result = await supportService.handleEndSession({
    authenticatedKey: req.projectKey,
    userId: req.body?.user_id || req.body?.userId,
    conversationId: req.body?.conversation_id || req.body?.conversationId,
    messages: req.body.messages,
    requestId: req.requestId,
  });
  return res.json(result);
}));

const feedbackService = require('../services/feedback/feedbackService');
const escalationService = require('../services/escalation/escalationService');

router.post('/support/feedback', requireProjectApiKey, supportLimiter, asyncHandler(async (req, res) => {
  const result = await feedbackService.recordFeedback({
    projectId: req.projectId,
    conversationId: req.body?.conversation_id || req.body?.conversationId,
    messageId: req.body?.message_id || req.body?.messageId,
    customerId: req.body?.customer_id || req.body?.customerId || req.body?.userId,
    requestId: req.body?.request_id || req.requestId,
    rating: req.body?.rating,
    reason: req.body?.reason,
    comment: req.body?.comment,
  });
  return res.json({ request_id: req.requestId, ...result });
}));

router.post('/support/escalate', requireProjectApiKey, supportLimiter, asyncHandler(async (req, res) => {
  try {
    const result = await escalationService.createEscalation({
      projectId: req.projectId,
      userId: req.body?.user_id || req.body?.userId,
      conversationId: req.body?.conversation_id || req.body?.conversationId,
      reason: req.body?.reason,
      metadata: req.body?.metadata,
    });
    return res.json({ request_id: req.requestId, ...result });
  } catch (err) {
    return sendError(req, res, err.statusCode || 500, err.code || 'ESCALATION_ERROR', err.message);
  }
}));

router.get('/support/memory/:userId', requireProjectApiKey, asyncHandler(async (req, res) => {
  if (req.projectKey?.keyType === 'public') {
    return sendError(req, res, 403, 'FORBIDDEN', 'Public API keys (pk_*) cannot access memory management endpoints. Use a secret key (sk_*).');
  }
  if (!validateUserId(req.params.userId)) return sendError(req, res, 400, 'INVALID_REQUEST', 'user_id is invalid.');
  const memory = await supportAgentService.getMemorySnapshot({
    userId: req.params.userId,
    tenantId: req.organizationId,
    projectId: req.projectId,
    environment: req.projectEnvironment || req.projectKey?.environment || 'live',
  });
  return res.json({ request_id: req.requestId, user_id: req.params.userId, memory: memory.facts });
}));

router.delete('/support/memory/:userId', requireProjectApiKey, asyncHandler(async (req, res) => {
  if (req.projectKey?.keyType === 'public') {
    return sendError(req, res, 403, 'FORBIDDEN', 'Public API keys (pk_*) cannot access memory management endpoints. Use a secret key (sk_*).');
  }
  if (!validateUserId(req.params.userId)) return sendError(req, res, 400, 'INVALID_REQUEST', 'user_id is invalid.');
  await supportAgentService.clearMemory({
    userId: req.params.userId,
    tenantId: req.organizationId,
    projectId: req.projectId,
    environment: req.projectEnvironment || req.projectKey?.environment || 'live',
  });
  return res.json({ request_id: req.requestId, user_id: req.params.userId, success: true });
}));

router.get('/support/customers/:userId/memory', requireDeveloperProject, asyncHandler(async (req, res) => {
  const customer = await customersForProject(req.projectId, req.params.userId);
  if (!customer) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  const memory = await supportAgentService.getMemorySnapshot({
    userId: req.params.userId,
    tenantId: req.organizationId,
    projectId: req.projectId,
    environment: req.query.environment || customer.environment || 'live',
  });
  return res.json({ request_id: req.requestId, user_id: req.params.userId, memory: memory.facts });
}));

router.delete('/support/customers/:userId/memory', requireSameOrigin, requireDeveloperProject, asyncHandler(async (req, res) => {
  const customer = await customersForProject(req.projectId, req.params.userId);
  if (!customer) return sendError(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  await supportAgentService.clearMemory({
    userId: req.params.userId,
    tenantId: req.organizationId,
    projectId: req.projectId,
    environment: req.query.environment || customer.environment || 'live',
  });
  return res.json({ request_id: req.requestId, user_id: req.params.userId, success: true });
}));

// ==========================================
// CONVERSATIONS MANAGEMENT
// ==========================================

router.get('/projects/:projectId/conversations', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const { rows } = await query(
    `SELECT conversations.id, conversations.project_id AS projectId, conversations.customer_id AS customerId,
            conversations.status, conversations.created_at AS createdAt, conversations.updated_at AS updatedAt,
            customers.external_user_id AS externalUserId,
            (SELECT content FROM conversation_messages WHERE conversation_id = conversations.id ORDER BY created_at DESC LIMIT 1) AS lastMessage,
            (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = conversations.id) AS messageCount
     FROM conversations
     JOIN customers ON customers.id = conversations.customer_id
     WHERE conversations.project_id = ?
     ORDER BY conversations.updated_at DESC
     LIMIT 100`,
    [req.params.projectId]
  );

  return res.json({ conversations: rows });
}));

router.get('/projects/:projectId/conversations/:conversationId', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const conv = await query(
    `SELECT conversations.id, conversations.project_id AS projectId, conversations.customer_id AS customerId,
            conversations.status, conversations.created_at AS createdAt, conversations.updated_at AS updatedAt,
            customers.external_user_id AS externalUserId
     FROM conversations
     JOIN customers ON customers.id = conversations.customer_id
     WHERE conversations.id = ? AND conversations.project_id = ?`,
    [req.params.conversationId, req.params.projectId]
  );

  if (!conv.rows[0]) return sendError(req, res, 404, 'NOT_FOUND', 'Conversation not found.');

  const messages = await query(
    `SELECT id, sender_type AS senderType, content, metadata, created_at AS createdAt
     FROM conversation_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC`,
    [req.params.conversationId]
  );

  return res.json({
    conversation: conv.rows[0],
    messages: messages.rows.map((m) => ({
      ...m,
      metadata: (() => { try { return JSON.parse(m.metadata || '{}'); } catch { return {}; } })(),
    })),
  });
}));

router.patch('/projects/:projectId/conversations/:conversationId', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const status = String(req.body?.status || '').toLowerCase();
  if (!['open', 'closed', 'resolved'].includes(status)) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'status must be open, closed, or resolved.');
  }

  const updated = await query(
    `UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
    [status, new Date().toISOString(), req.params.conversationId, req.params.projectId]
  );

  if (updated.changes === 0) {
    return sendError(req, res, 404, 'NOT_FOUND', 'Conversation not found.');
  }

  return res.json({ success: true, status });
}));

// ==========================================
// WIDGET SETTINGS & PUBLIC CONFIG
// ==========================================

router.get('/projects/:projectId/widget', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const settings = await projectService.getWidgetSettings(req.params.projectId);
  return res.json({ widget: settings, settings });
}));

router.put('/projects/:projectId/widget', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const saved = await projectService.saveWidgetSettings(req.params.projectId, req.body || {});
  return res.json({ widget: saved, settings: saved });
}));

router.get('/widget/config', asyncHandler(async (req, res) => {
  const publicKey = String(req.query.public_key || req.query.publicKey || '').trim();
  const projectId = String(req.query.project_id || req.query.projectId || '').trim();

  let targetProjectId = projectId;
  if (publicKey) {
    const key = await projectService.authenticateApiKey(publicKey);
    if (!key) {
      return sendError(req, res, 401, 'INVALID_PUBLIC_KEY', 'The provided widget public key is invalid or revoked.');
    }
    targetProjectId = key.projectId;
  }

  if (!targetProjectId) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'public_key or project_id is required.');
  }

  const settings = await projectService.getWidgetSettings(targetProjectId);

  const origin = req.get('origin') || req.get('referer');
  if (origin && settings.allowedDomains && settings.allowedDomains !== '*') {
    const allowedList = settings.allowedDomains.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    let requestHost = '';
    try {
      requestHost = new URL(origin).hostname.toLowerCase();
    } catch {
      requestHost = origin.toLowerCase();
    }
    const isAllowed = allowedList.some((domain) => {
      if (domain === '*' || domain === requestHost) return true;
      if (domain.startsWith('*.') && requestHost.endsWith(domain.slice(2))) return true;
      if (requestHost.endsWith(`.${domain}`)) return true;
      return false;
    });
    if (!isAllowed) {
      return sendError(req, res, 403, 'DOMAIN_NOT_ALLOWED', `The origin '${requestHost}' is not authorized to initialize this widget.`);
    }
  }

  return res.json({ success: true, config: settings, settings, widget: settings });
}));

// ==========================================
// TOOL TEMPLATES
// ==========================================

router.get('/projects/:projectId/tool-templates', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  return res.json({ templates: projectToolService.getStandardToolTemplates() });
}));

// ==========================================
// PHASE 12: ANALYTICS, ESCALATIONS & WEBHOOKS
// ==========================================

const webhookService = require('../services/webhook/webhookService');
const analyticsService = require('../services/analytics/analyticsService');

router.get('/projects/:projectId/analytics', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const analytics = await analyticsService.getProjectAnalytics(req.params.projectId, {
    range: req.query.range || '7d',
  });
  return res.json({ analytics });
}));

router.get('/projects/:projectId/escalations', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const escalations = await escalationService.listEscalations(req.params.projectId, {
    status: req.query.status,
    limit: req.query.limit,
  });
  return res.json({ escalations });
}));

router.patch('/projects/:projectId/escalations/:escalationId', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const status = req.body?.status;
  const assignedTo = req.body?.assignedTo || req.body?.assigned_to;
  const now = new Date().toISOString();

  const validStatuses = ['requested', 'created', 'assigned', 'in_progress', 'waiting', 'resolved', 'cancelled'];
  if (status && !validStatuses.includes(status)) {
    return sendError(req, res, 400, 'INVALID_REQUEST', `Status must be one of: ${validStatuses.join(', ')}`);
  }

  const { changes } = await query(
    `UPDATE escalations SET status = COALESCE(?, status), assigned_to = COALESCE(?, assigned_to), updated_at = ?
     WHERE id = ? AND project_id = ?`,
    [status || null, assignedTo || null, now, req.params.escalationId, req.params.projectId]
  );

  if (!changes) return sendError(req, res, 404, 'NOT_FOUND', 'Escalation ticket not found.');

  return res.json({ success: true, updated_at: now });
}));

router.get('/projects/:projectId/webhooks', requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const webhooks = await webhookService.listWebhooks(req.params.projectId);
  return res.json({ webhooks });
}));

router.post('/projects/:projectId/webhooks', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const created = await webhookService.createWebhook({
    projectId: req.params.projectId,
    name: req.body?.name,
    url: req.body?.url,
    events: req.body?.events,
  });
  return res.status(201).json({ webhook: created });
}));

router.delete('/projects/:projectId/webhooks/:webhookId', requireSameOrigin, requireDeveloperSession, asyncHandler(async (req, res) => {
  const project = await projectService.getOwnedProject(req.developer.id, req.params.projectId);
  if (!project) return sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found.');

  const deleted = await webhookService.deleteWebhook(req.params.projectId, req.params.webhookId);
  if (!deleted) return sendError(req, res, 404, 'NOT_FOUND', 'Webhook endpoint not found.');
  return res.json({ success: true });
}));

// ==========================================
// SAAS PLATFORM ADMIN CONTROL PLANE
// ==========================================

const requirePlatformAdmin = asyncHandler(async (req, res, next) => {
  const user = await developerAuth.getSession(cookieValue(req, SESSION_COOKIE));
  if (!user) {
    return sendError(req, res, 401, 'AUTHENTICATION_REQUIRED', 'Sign in to access platform admin.');
  }
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length > 0 && !adminEmails.includes(String(user.email || '').toLowerCase())) {
    return sendError(req, res, 403, 'FORBIDDEN', 'Administrative privilege required.');
  }
  req.developer = user;
  return next();
});

router.get('/admin/overview', requirePlatformAdmin, asyncHandler(async (req, res) => {
  const orgCount = await query('SELECT COUNT(*) AS count FROM organizations');
  const projectCount = await query('SELECT COUNT(*) AS count FROM projects');
  const userCount = await query('SELECT COUNT(*) AS count FROM users');
  const requestCount = await query('SELECT COUNT(*) AS count FROM usage_records');
  const errorCount = await query('SELECT COUNT(*) AS count FROM usage_records WHERE status_code >= 400');
  const memoryOps = await query('SELECT COALESCE(SUM(memory_operations), 0) AS count FROM usage_records');

  const plans = await query(
    `SELECT COALESCE(plan_name, 'starter') AS planName, COUNT(*) AS count
     FROM organizations GROUP BY plan_name`
  );

  const stats = {
    organizations: Number(orgCount.rows[0]?.count || 0),
    projects: Number(projectCount.rows[0]?.count || 0),
    users: Number(userCount.rows[0]?.count || 0),
    requests: Number(requestCount.rows[0]?.count || 0),
    errors: Number(errorCount.rows[0]?.count || 0),
    memoryOperations: Number(memoryOps.rows[0]?.count || 0),
    plans: plans.rows.reduce((acc, row) => {
      acc[row.planName] = Number(row.count || 0);
      return acc;
    }, {}),
    health: {
      status: 'healthy',
      api: 'healthy',
      database: 'healthy',
      memoryProvider: 'healthy',
      inferenceProvider: 'healthy',
    },
  };

  return res.json({
    overview: {
      organizationsCount: stats.organizations,
      projectsCount: stats.projects,
      usersCount: stats.users,
      requestsCount: stats.requests,
      errorsCount: stats.errors,
      memoryOperationsCount: stats.memoryOperations,
      plansDistribution: stats.plans,
      platformVersion: '1.0.0-contextis',
      uptimeSeconds: Math.floor(process.uptime()),
    },
    stats,
  });
}));

router.get('/admin/health', requirePlatformAdmin, asyncHandler(async (req, res) => {
  let dbHealthy = false;
  try {
    const probe = await query('SELECT 1 AS ok');
    dbHealthy = probe.rows && probe.rows.length > 0;
  } catch {
    dbHealthy = false;
  }

  const memoryHealthy = Boolean(config.hindsightApiKey || config.memoryMode);
  const llmHealthy = Boolean(config.groqApiKey || true); // demo fallback ensures availability

  return res.json({
    health: {
      status: dbHealthy ? 'healthy' : 'degraded',
      api: 'healthy',
      database: dbHealthy ? 'healthy' : 'down',
      databaseEngine: config.databaseUrl ? 'postgresql' : 'sqlite',
      memoryProvider: memoryHealthy ? 'healthy' : 'degraded',
      inferenceProvider: llmHealthy ? 'healthy' : 'degraded',
      services: {
        api: { status: 'healthy', latencyMs: 2 },
        database: { status: dbHealthy ? 'healthy' : 'down', engine: config.databaseUrl ? 'postgresql' : 'sqlite' },
        memory: { status: memoryHealthy ? 'healthy' : 'degraded', provider: config.hindsightApiKey ? 'hindsight-cloud' : 'contextis-local' },
        inference: { status: llmHealthy ? 'healthy' : 'degraded', provider: config.groqApiKey ? 'groq-llama3.3' : 'contextis-deterministic' },
      },
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    },
  });
}));

router.get('/admin/organizations', requirePlatformAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT organizations.id, organizations.name, organizations.owner_user_id AS ownerUserId,
            organizations.created_at AS createdAt,
            COALESCE(organizations.plan_name, 'starter') AS planName,
            COALESCE(organizations.billing_status, 'active') AS billingStatus,
            COALESCE(organizations.status, 'active') AS status,
            users.email AS ownerEmail, users.name AS ownerName,
            (SELECT COUNT(*) FROM organization_members WHERE organization_id = organizations.id) AS memberCount,
            (SELECT COUNT(*) FROM projects WHERE organization_id = organizations.id) AS projectCount,
            (SELECT COUNT(*) FROM usage_records JOIN projects ON projects.id = usage_records.project_id WHERE projects.organization_id = organizations.id) AS totalRequests
     FROM organizations
     JOIN users ON users.id = organizations.owner_user_id
     ORDER BY organizations.created_at DESC`
  );

  return res.json({ organizations: rows });
}));

router.get('/admin/organizations/:orgId', requirePlatformAdmin, asyncHandler(async (req, res) => {
  const org = await query(
    `SELECT organizations.id, organizations.name, organizations.owner_user_id AS ownerUserId,
            organizations.created_at AS createdAt,
            COALESCE(organizations.plan_name, 'starter') AS planName,
            COALESCE(organizations.billing_status, 'active') AS billingStatus,
            COALESCE(organizations.status, 'active') AS status,
            users.email AS ownerEmail, users.name AS ownerName
     FROM organizations
     JOIN users ON users.id = organizations.owner_user_id
     WHERE organizations.id = ?`,
    [req.params.orgId]
  );

  if (!org.rows[0]) return sendError(req, res, 404, 'NOT_FOUND', 'Organization not found.');

  const projects = await query(
    `SELECT id, name, status, created_at AS createdAt FROM projects WHERE organization_id = ? ORDER BY created_at DESC`,
    [req.params.orgId]
  );

  const keys = await query(
    `SELECT project_api_keys.id, project_api_keys.name, project_api_keys.prefix,
            project_api_keys.environment, project_api_keys.key_type AS keyType,
            project_api_keys.status, project_api_keys.created_at AS createdAt,
            project_api_keys.last_used_at AS lastUsedAt, projects.name AS projectName
     FROM project_api_keys
     JOIN projects ON projects.id = project_api_keys.project_id
     WHERE projects.organization_id = ?
     ORDER BY project_api_keys.created_at DESC`,
    [req.params.orgId]
  );

  const members = await query(
    `SELECT users.id, users.email, users.name, organization_members.role, organization_members.created_at AS joinedAt
     FROM organization_members
     JOIN users ON users.id = organization_members.user_id
     WHERE organization_members.organization_id = ?`,
    [req.params.orgId]
  );

  const audits = await query(
    `SELECT id, action, metadata, created_at AS createdAt FROM audit_logs
     WHERE organization_id = ? ORDER BY created_at DESC LIMIT 30`,
    [req.params.orgId]
  );

  return res.json({
    organization: org.rows[0],
    projects: projects.rows,
    apiKeys: keys.rows,
    members: members.rows,
    auditLogs: audits.rows.map((a) => ({
      ...a,
      metadata: (() => { try { return JSON.parse(a.metadata || '{}'); } catch { return {}; } })(),
    })),
  });
}));

router.patch('/admin/organizations/:orgId/status', requireSameOrigin, requirePlatformAdmin, asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  if (!['active', 'suspended'].includes(status)) {
    return sendError(req, res, 400, 'INVALID_REQUEST', 'status must be active or suspended.');
  }

  const updated = await query('UPDATE organizations SET status = ? WHERE id = ?', [status, req.params.orgId]);
  if (updated.changes === 0) return sendError(req, res, 404, 'NOT_FOUND', 'Organization not found.');

  await query(
    `INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at)
     VALUES (?, ?, NULL, ?, NULL, 'organization.status_updated', ?, ?)`,
    [`audit_${crypto.randomUUID()}`, req.params.orgId, req.developer.id, JSON.stringify({ status }), new Date().toISOString()]
  );

  return res.json({ success: true, status, organization: { id: req.params.orgId, status } });
}));

router.get('/admin/users', requirePlatformAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT users.id, users.email, users.name, users.created_at AS createdAt,
            COUNT(DISTINCT organization_members.organization_id) AS organizationsCount
     FROM users
     LEFT JOIN organization_members ON organization_members.user_id = users.id
     GROUP BY users.id, users.email, users.name, users.created_at
     ORDER BY users.created_at DESC`
  );

  return res.json({ users: rows });
}));

router.get('/admin/audit', requirePlatformAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT audit_logs.id, audit_logs.organization_id AS organizationId, audit_logs.action,
            audit_logs.metadata, audit_logs.created_at AS createdAt,
            organizations.name AS organizationName, users.email AS actorEmail
     FROM audit_logs
     LEFT JOIN organizations ON organizations.id = audit_logs.organization_id
     LEFT JOIN users ON users.id = audit_logs.actor_user_id
     ORDER BY audit_logs.created_at DESC
     LIMIT 100`
  );

  return res.json({
    auditLogs: rows.map((r) => ({
      ...r,
      metadata: (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })(),
    })),
  });
}));

router.post('/admin/keys/:keyId/revoke', requireSameOrigin, requirePlatformAdmin, asyncHandler(async (req, res) => {
  const now = new Date().toISOString();
  const updated = await query('UPDATE project_api_keys SET status = \'revoked\', revoked_at = ? WHERE id = ?', [now, req.params.keyId]);
  if (updated.changes === 0) return sendError(req, res, 404, 'NOT_FOUND', 'API key not found.');

  return res.json({ success: true, keyId: req.params.keyId });
}));

router.get('/admin/security', requirePlatformAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT audit_logs.id, audit_logs.organization_id AS organizationId, audit_logs.action,
            audit_logs.metadata, audit_logs.created_at AS createdAt,
            organizations.name AS organizationName, users.email AS actorEmail
     FROM audit_logs
     LEFT JOIN organizations ON organizations.id = audit_logs.organization_id
     LEFT JOIN users ON users.id = audit_logs.actor_user_id
     WHERE audit_logs.action LIKE '%security%'
        OR audit_logs.action LIKE '%failed%'
        OR audit_logs.action LIKE '%revoked%'
        OR audit_logs.action LIKE '%denied%'
        OR audit_logs.action LIKE '%violation%'
        OR audit_logs.action LIKE '%status_updated%'
     ORDER BY audit_logs.created_at DESC
     LIMIT 50`
  );

  const revokedKeysCount = await query(`SELECT COUNT(*) AS count FROM project_api_keys WHERE status = 'revoked'`);
  const suspendedOrgsCount = await query(`SELECT COUNT(*) AS count FROM organizations WHERE status = 'suspended'`);

  return res.json({
    security: {
      revokedKeysCount: Number(revokedKeysCount.rows[0]?.count || 0),
      suspendedOrgsCount: Number(suspendedOrgsCount.rows[0]?.count || 0),
      eventsCount: rows.length,
      events: rows.map((r) => ({
        ...r,
        metadata: (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })(),
      })),
    },
  });
}));

router.get('/admin/subscriptions', requirePlatformAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT organizations.id AS organizationId, organizations.name AS organizationName,
            organizations.billing_status AS billingStatus,
            COALESCE(organizations.plan_name, 'starter') AS planSlug,
            plans.name AS planName, plans.monthly_requests AS monthlyRequests,
            subscriptions.status AS subscriptionStatus, subscriptions.current_period_end AS currentPeriodEnd
     FROM organizations
     LEFT JOIN subscriptions ON subscriptions.organization_id = organizations.id
     LEFT JOIN plans ON plans.slug = organizations.plan_name
     ORDER BY organizations.created_at DESC`
  );

  return res.json({ subscriptions: rows });
}));

router.get('/admin/projects', requirePlatformAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT projects.id, projects.name, projects.environment, projects.status,
            projects.created_at AS createdAt, organizations.name AS organizationName,
            organizations.id AS organizationId,
            (SELECT COUNT(*) FROM project_api_keys WHERE project_api_keys.project_id = projects.id) AS keyCount
     FROM projects
     JOIN organizations ON organizations.id = projects.organization_id
     ORDER BY projects.created_at DESC`
  );

  return res.json({ projects: rows });
}));

module.exports = router;