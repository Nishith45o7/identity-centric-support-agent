const { config } = require('../config');
const packageJson = require('../../package.json');
const { resolveIdentity } = require('../services/identity/identityService');
const memoryService = require('../services/memory/hindsightMemoryService');
const { processSupportMessage, finalizeSession } = require('../services/supportAgent/supportAgentService');

const health = (req, res) => {
  res.json({
    success: true,
    service: packageJson.name,
    version: packageJson.version,
    status: 'healthy',
    memoryMode: config.memoryMode,
    port: config.port,
    nodeEnv: config.nodeEnv,
    hindsightConfigured: Boolean(config.hindsightApiKey),
    groqConfigured: Boolean(config.groqApiKey),
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    pid: process.pid,
    requestId: req.requestId,
  });
};

const ready = async (req, res) => {
  try {
    const { query } = require('../db');
    await query('SELECT 1');
    res.json({
      success: true,
      service: packageJson.name,
      version: packageJson.version,
      status: 'ready',
      ready: true,
      database: 'connected',
      memoryMode: config.memoryMode,
      nodeEnv: config.nodeEnv,
      port: config.port,
      hindsightConfigured: Boolean(config.hindsightApiKey),
      groqConfigured: Boolean(config.groqApiKey),
      uptimeSeconds: Number(process.uptime().toFixed(2)),
      requestId: req.requestId,
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      service: packageJson.name,
      version: packageJson.version,
      status: 'not_ready',
      ready: false,
      database: 'disconnected',
      error: 'Database probe failed',
      requestId: req.requestId,
    });
  }
};

const live = (req, res) => {
  res.json({
    success: true,
    service: packageJson.name,
    version: packageJson.version,
    status: 'alive',
    alive: true,
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    pid: process.pid,
    requestId: req.requestId,
  });
};

const chat = async (req, res, next) => {
  try {
    const userId = resolveIdentity({ userId: req.body.userId || req.body.user_id || req.query.userId || req.query.user_id, authUserId: req.user?.id });
    const memoryMode = req.body.memoryMode !== undefined ? req.body.memoryMode : config.memoryMode;
    const tenantId = req.body.tenantId || req.body.tenant_id || req.query.tenantId || req.query.tenant_id || 'default';

    const result = await processSupportMessage({
      userId,
      message: req.body.message,
      memoryMode,
      tenantId,
    });

    res.json({ ...result, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
};

const endSession = async (req, res, next) => {
  try {
    const userId = resolveIdentity({ userId: req.body.userId || req.body.user_id || req.query.userId || req.query.user_id });
    const tenantId = req.body.tenantId || req.body.tenant_id || req.query.tenantId || req.query.tenant_id || 'default';
    const result = await finalizeSession({ userId, messages: req.body.messages, tenantId });
    res.json({ ...result, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
};

const getMemory = async (req, res, next) => {
  try {
    const userId = resolveIdentity({ userId: req.body.userId || req.body.user_id || req.query.userId || req.query.user_id || req.headers['x-user-id'] });
    const tenantId = req.body.tenantId || req.body.tenant_id || req.query.tenantId || req.query.tenant_id || req.headers['x-tenant-id'] || 'default';
    const snapshot = await memoryService.snapshot(userId, tenantId);
    res.json({
      success: true,
      userId,
      tenantId,
      memory: snapshot.facts,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
};

const clearMemory = async (req, res, next) => {
  try {
    const userId = resolveIdentity({ userId: req.body.userId || req.body.user_id || req.query.userId || req.query.user_id || req.headers['x-user-id'] });
    const tenantId = req.body.tenantId || req.body.tenant_id || req.query.tenantId || req.query.tenant_id || req.headers['x-tenant-id'] || 'default';
    const result = await memoryService.clear(userId, tenantId);
    res.json({ success: true, ...result, tenantId, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
};

module.exports = { health, ready, live, chat, endSession, getMemory, clearMemory };
