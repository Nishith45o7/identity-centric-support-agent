const express = require('express');
const router = express.Router();
const apiKeyService = require('../services/auth/apiKeyService');
const tenantService = require('../services/tenant/tenantService');
const auditService = require('../services/audit/auditService');
const supportAgentService = require('../services/supportAgent/supportAgentService');
const { getUserIdFromRequest, validateChatPayload, validateSessionPayload, validateMemoryRequest } = require('../validators/supportValidator');

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const resolveTenantId = (req) => {
  const candidate = req.body?.tenantId || req.body?.tenant_id || req.query?.tenantId || req.query?.tenant_id || req.headers['x-tenant-id'] || req.apiKey?.tenantId || 'default';
  return String(candidate || 'default').trim() || 'default';
};

const requireDeveloperKey = async (req, res, next) => {
  const publicWithoutKey = ['/developer/keys', '/developer/tenants', '/developer/summary', '/developer/audit'];
  const isBootstrap = publicWithoutKey.includes(req.path) && (!req.headers.authorization && !req.headers['x-api-key']);
  if (isBootstrap) {
    return next();
  }

  const candidate = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : req.headers['x-api-key'];
  const validKey = await apiKeyService.verifyKey(candidate);

  if (!validKey) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'A valid developer API key is required.' },
    });
  }

  req.apiKey = validKey;
  next();
};

const requireAdminRole = (req, res, next) => {
  if (!req.headers.authorization && !req.headers['x-api-key']) {
    return next();
  }

  if (!req.apiKey || req.apiKey.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin role required for this action.' },
    });
  }

  next();
};

router.use(asyncHandler(requireDeveloperKey));

router.post('/developer/tenants', requireAdminRole, asyncHandler(async (req, res) => {
  const tenantId = req.body?.tenantId || req.body?.tenant_id || 'default';
  const tenant = await tenantService.createTenant({
    tenantId,
    name: req.body?.name || 'Default Tenant',
    ownerEmail: req.body?.ownerEmail || req.body?.owner_email || null,
  });

  await auditService.record({
    type: 'tenant.created',
    tenantId,
    message: `Tenant ${tenantId} created`,
    metadata: { name: tenant.tenant.name, ownerEmail: tenant.tenant.ownerEmail },
  });

  return res.json({
    success: true,
    tenant: tenant.tenant,
  });
}));

router.get('/developer/tenants', asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    tenants: await tenantService.listTenants(),
  });
}));

router.get('/developer/summary', asyncHandler(async (req, res) => {
  const tenants = await tenantService.listTenants();
  const keys = await apiKeyService.listKeys();
  const events = await auditService.list(Number.MAX_SAFE_INTEGER);
  const summary = {
    tenantCount: tenants.length,
    activeKeyCount: keys.filter((key) => key.status === 'active').length,
    revokedKeyCount: keys.filter((key) => key.status === 'revoked').length,
    eventCount: events.length,
  };

  return res.json({
    success: true,
    summary,
  });
}));

router.get('/developer/audit', asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    events: await auditService.list(50),
  });
}));

router.post('/developer/keys', requireAdminRole, asyncHandler(async (req, res) => {
  const tenantId = req.body?.tenantId || req.body?.tenant_id || 'default';
  await tenantService.ensureTenant({
    tenantId,
    name: req.body?.tenantName || req.body?.tenant_name || 'Default Tenant',
    ownerEmail: req.body?.ownerEmail || req.body?.owner_email || null,
  });

  const created = await apiKeyService.createKey({
    name: req.body?.name || 'Developer App',
    environment: req.body?.environment || 'test',
    tenantId,
    role: req.body?.role || 'admin',
  });

  await auditService.record({
    type: 'key.created',
    tenantId,
    keyId: created.metadata.id,
    message: `Developer key created for tenant ${tenantId}`,
    metadata: { appName: created.metadata.name, environment: created.metadata.environment },
  });

  return res.json({
    success: true,
    key: created.key,
    metadata: created.metadata,
  });
}));

router.get('/developer/keys', asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    keys: await apiKeyService.listKeys(),
  });
}));

router.patch('/developer/keys/:keyId/role', requireAdminRole, asyncHandler(async (req, res) => {
  const nextRole = req.body?.role || 'admin';
  const updated = await apiKeyService.updateRole(req.params.keyId, nextRole);

  if (!updated) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'API key not found.' },
    });
  }

  await auditService.record({
    type: 'key.role_updated',
    keyId: req.params.keyId,
    message: `Developer key ${req.params.keyId} role updated to ${updated.metadata.role}`,
    metadata: { role: updated.metadata.role },
  });

  return res.json({
    success: true,
    metadata: updated.metadata,
  });
}));

router.patch('/developer/tenants/:tenantId', requireAdminRole, asyncHandler(async (req, res) => {
  const tenant = await tenantService.updateTenant({
    tenantId: req.params.tenantId,
    name: req.body?.name,
    ownerEmail: req.body?.ownerEmail || req.body?.owner_email,
    status: req.body?.status,
  });

  if (!tenant) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Tenant not found.' },
    });
  }

  await auditService.record({
    type: 'tenant.updated',
    tenantId: req.params.tenantId,
    message: `Tenant ${req.params.tenantId} updated`,
    metadata: { name: tenant.tenant.name, ownerEmail: tenant.tenant.ownerEmail, status: tenant.tenant.status },
  });

  return res.json({
    success: true,
    tenant: tenant.tenant,
  });
}));

router.delete('/developer/keys/:keyId', requireAdminRole, asyncHandler(async (req, res) => {
  const revoked = await apiKeyService.revokeKey(req.params.keyId);
  if (!revoked) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'API key not found.' },
    });
  }

  await auditService.record({
    type: 'key.revoked',
    keyId: req.params.keyId,
    message: `Developer key ${req.params.keyId} revoked`,
  });

  return res.json({
    success: true,
    message: 'API key revoked.',
    keyId: req.params.keyId,
  });
}));

router.post('/support/chat', validateChatPayload, async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req) || req.body.user_id;
    const tenantId = resolveTenantId(req);
    const result = await supportAgentService.processSupportMessage({
      userId,
      rawMessage: req.body.message,
      tenantId,
      requestId: req.id,
    });

    await auditService.record({
      type: 'support.chat',
      tenantId,
      userId,
      message: 'Support chat request processed',
      metadata: { sessionId: result.sessionId },
    });

    return res.json({
      success: true,
      message: result.reply,
      sessionId: result.sessionId,
      tenantId,
      userId,
      facts: result.facts || [],
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/support/end', validateSessionPayload, async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req) || req.body.user_id;
    const tenantId = resolveTenantId(req);
    const result = await supportAgentService.finalizeSession({
      userId,
      messages: req.body.messages,
      tenantId,
      requestId: req.id,
    });

    await auditService.record({
      type: 'support.session_closed',
      tenantId,
      userId,
      message: 'Support session closed',
      metadata: { factsStored: result.factsStored || 0 },
    });

    return res.json({
      success: true,
      summary: result.summary,
      facts: result.facts || [],
      tenantId,
      userId,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/support/memory/:userId', validateMemoryRequest, async (req, res, next) => {
  try {
    const userId = req.params.userId || getUserIdFromRequest(req);
    const tenantId = resolveTenantId(req);
    const memory = await supportAgentService.getMemorySnapshot({
      userId,
      tenantId,
    });

    return res.json({
      success: true,
      tenantId,
      userId,
      memory,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/support/memory/:userId', validateMemoryRequest, async (req, res, next) => {
  try {
    const userId = req.params.userId || getUserIdFromRequest(req);
    const tenantId = resolveTenantId(req);
    await supportAgentService.clearMemory({
      userId,
      tenantId,
    });

    return res.json({
      success: true,
      tenantId,
      userId,
      message: 'Memory cleared for this tenant/user.'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
