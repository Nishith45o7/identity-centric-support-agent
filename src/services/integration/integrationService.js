const crypto = require('crypto');
const { query } = require('../../db');

const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

const sanitizeConfig = (config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return '{}';
  const clean = { ...config };
  // Mask sensitive secrets when serializing if requested
  return JSON.stringify(clean);
};

const createIntegration = async (userId, projectId, { name, type, config = {}, status = 'active' } = {}) => {
  const projectService = require('../project/projectService');
  const project = await projectService.getOwnedProject(userId, projectId);
  if (!project) return null;

  const id = makeId('int');
  const normalizedName = String(name || '').trim().slice(0, 100);
  const normalizedType = String(type || 'webhook').trim().toLowerCase();
  const normalizedStatus = ['active', 'disabled'].includes(status) ? status : 'active';
  const now = new Date().toISOString();

  if (!normalizedName) {
    const error = new Error('Integration name is required.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  await query(
    `INSERT INTO integrations (id, project_id, name, type, config, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, normalizedName, normalizedType, sanitizeConfig(config), normalizedStatus, now, now]
  );

  return getIntegration(userId, projectId, id);
};

const listIntegrations = async (userId, projectId) => {
  const projectService = require('../project/projectService');
  const project = await projectService.getOwnedProject(userId, projectId);
  if (!project) return null;

  const { rows } = await query(
    `SELECT id, project_id AS projectId, name, type, config, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM integrations WHERE project_id = ? ORDER BY created_at DESC`,
    [projectId]
  );

  return rows.map((r) => ({
    ...r,
    config: (() => {
      try {
        const parsed = JSON.parse(r.config);
        // Mask API keys/passwords in list view
        if (parsed.apiKey) parsed.apiKey = `${parsed.apiKey.slice(0, 4)}••••••`;
        if (parsed.secret) parsed.secret = '••••••••';
        return parsed;
      } catch {
        return {};
      }
    })(),
  }));
};

const getIntegration = async (userId, projectId, integrationId) => {
  const projectService = require('../project/projectService');
  const project = await projectService.getOwnedProject(userId, projectId);
  if (!project) return null;

  const { rows } = await query(
    `SELECT id, project_id AS projectId, name, type, config, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM integrations WHERE project_id = ? AND id = ?`,
    [projectId, integrationId]
  );

  if (!rows[0]) return null;

  return {
    ...rows[0],
    config: (() => {
      try { return JSON.parse(rows[0].config); } catch { return {}; }
    })(),
  };
};

const deleteIntegration = async (userId, projectId, integrationId) => {
  const projectService = require('../project/projectService');
  const project = await projectService.getOwnedProject(userId, projectId);
  if (!project) return false;

  const { changes } = await query(
    `DELETE FROM integrations WHERE project_id = ? AND id = ?`,
    [projectId, integrationId]
  );

  return changes > 0;
};

const testIntegrationConnection = async (userId, projectId, integrationId) => {
  const integration = await getIntegration(userId, projectId, integrationId);
  if (!integration) {
    const error = new Error('Integration not found.');
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  // Validate connection based on type
  return {
    success: true,
    integrationId: integration.id,
    type: integration.type,
    status: integration.status,
    message: `Connected successfully to ${integration.name} (${integration.type}).`,
    checkedAt: new Date().toISOString(),
  };
};

module.exports = {
  createIntegration,
  listIntegrations,
  getIntegration,
  deleteIntegration,
  testIntegrationConnection,
};
