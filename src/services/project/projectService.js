const crypto = require('crypto');
const { config } = require('../../config');
const { query } = require('../../db');

const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const hashApiKey = (key) => {
  if (!config.apiKeyPepper) {
    const error = new Error('API_KEY_PEPPER must be configured before issuing API keys.');
    error.code = 'CONFIGURATION_ERROR';
    error.statusCode = 503;
    throw error;
  }
  return crypto.createHmac('sha256', config.apiKeyPepper).update(key).digest('hex');
};

const validateProjectName = (name) => {
  const normalizedName = String(name || '').trim();
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    const error = new Error('Project name must be between 2 and 80 characters.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }
  return normalizedName;
};

const getOwnedProject = async (userId, projectId) => {
  const { rows } = await query(
    `SELECT projects.id, projects.organization_id AS organizationId, projects.name, projects.status,
            projects.settings, projects.created_at AS createdAt, projects.updated_at AS updatedAt
     FROM projects
     JOIN organization_members ON organization_members.organization_id = projects.organization_id
     WHERE organization_members.user_id = ? AND projects.id = ?`,
    [userId, projectId]
  );
  return rows[0] || null;
};

const createProject = async (userId, name) => {
  const normalizedName = validateProjectName(name);
  const memberships = await query(
    `SELECT organization_id AS organizationId FROM organization_members
     WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  const organizationId = memberships.rows[0]?.organizationId;
  if (!organizationId) {
    const error = new Error('A workspace is required before creating projects.');
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  const id = makeId('prj');
  const now = new Date().toISOString();
  await query(
    `INSERT INTO projects (id, organization_id, name, status, settings, created_at, updated_at)
     VALUES (?, ?, ?, 'active', '{}', ?, ?)`,
    [id, organizationId, normalizedName, now, now]
  );
  return getOwnedProject(userId, id);
};

const listProjects = async (userId) => {
  const { rows } = await query(
    `SELECT projects.id, projects.organization_id AS organizationId, projects.name, projects.status,
            projects.created_at AS createdAt, projects.updated_at AS updatedAt
     FROM projects
     JOIN organization_members ON organization_members.organization_id = projects.organization_id
     WHERE organization_members.user_id = ?
     ORDER BY projects.created_at DESC`,
    [userId]
  );
  return rows;
};

const deleteProject = async (userId, projectId) => {
  const { changes } = await query(
    `DELETE FROM projects WHERE id = ? AND organization_id IN (
       SELECT organization_id FROM organization_members WHERE user_id = ?
     )`,
    [projectId, userId]
  );
  return changes > 0;
};

const createApiKey = async (userId, projectId, { name, environment = 'test' } = {}) => {
  const project = await getOwnedProject(userId, projectId);
  if (!project) {
    return null;
  }
  const normalizedName = String(name || '').trim();
  const normalizedEnvironment = String(environment).toLowerCase();
  if (normalizedName.length < 1 || normalizedName.length > 100 || !['test', 'live'].includes(normalizedEnvironment)) {
    const error = new Error('Provide a key name and environment of test or live.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const rawKey = `sk_${normalizedEnvironment}_${crypto.randomBytes(32).toString('base64url')}`;
  const id = makeId('key');
  const prefix = rawKey.slice(0, 15);
  const createdAt = new Date().toISOString();
  await query(
    `INSERT INTO project_api_keys (id, project_id, created_by_user_id, name, prefix, environment, hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [id, projectId, userId, normalizedName, prefix, normalizedEnvironment, hashApiKey(rawKey), createdAt]
  );

  return {
    key: rawKey,
    metadata: { id, projectId, name: normalizedName, prefix, environment: normalizedEnvironment, status: 'active', createdAt, lastUsedAt: null },
  };
};

const listApiKeys = async (userId, projectId) => {
  if (!await getOwnedProject(userId, projectId)) {
    return null;
  }
  const { rows } = await query(
    `SELECT id, project_id AS projectId, name, prefix, environment, status,
            created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
     FROM project_api_keys WHERE project_id = ? ORDER BY created_at DESC`,
    [projectId]
  );
  return rows;
};

const revokeApiKey = async (userId, projectId, keyId) => {
  const revokedAt = new Date().toISOString();
  const result = await query(
    `UPDATE project_api_keys SET status = 'revoked', revoked_at = ?
     WHERE id = ? AND project_id = ? AND project_id IN (
       SELECT projects.id FROM projects
       JOIN organization_members ON organization_members.organization_id = projects.organization_id
       WHERE organization_members.user_id = ?
     ) AND status = 'active'`,
    [revokedAt, keyId, projectId, userId]
  );
  return result.changes > 0;
};

const authenticateApiKey = async (rawKey) => {
  if (!rawKey) {
    return null;
  }
  const hash = hashApiKey(String(rawKey).trim());
  const { rows } = await query(
    `SELECT project_api_keys.id, project_api_keys.project_id AS projectId,
            project_api_keys.environment, project_api_keys.status,
            projects.organization_id AS organizationId
     FROM project_api_keys
     JOIN projects ON projects.id = project_api_keys.project_id
     WHERE project_api_keys.hash = ? AND project_api_keys.status = 'active' AND projects.status = 'active'`,
    [hash]
  );
  const key = rows[0];
  if (!key) {
    return null;
  }
  await query('UPDATE project_api_keys SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), key.id]);
  return key;
};

module.exports = { createProject, listProjects, getOwnedProject, deleteProject, createApiKey, listApiKeys, revokeApiKey, authenticateApiKey, hashApiKey };