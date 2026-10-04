const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { query } = require('../db');
const developerAuth = require('../services/auth/developerAuthService');
const projectService = require('../services/project/projectService');
const memoryService = require('../services/memory/hindsightMemoryService');
const supportAgentService = require('../services/supportAgent/supportAgentService');
const { sanitizeText, validateUserId } = require('../utils/sanitizers');

const router = express.Router();
const SESSION_COOKIE = 'ics_session';
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

const requireProjectApiKey = asyncHandler(async (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const rawKey = authorization.startsWith('Bearer ') ? authorization.slice(7) : req.get('x-api-key');
  const key = await projectService.authenticateApiKey(rawKey);
  if (!key) {
    return sendError(req, res, 401, 'INVALID_API_KEY', 'A valid project API key is required.');
  }
  req.projectKey = key;
  req.projectId = key.projectId;
  req.organizationId = key.organizationId;
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
  limit: (req) => req.projectKey?.environment === 'live' ? 300 : 120,
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