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
    `SELECT projects.id, projects.organization_id AS organizationId, projects.name,
            projects.slug, projects.environment, projects.status,
            projects.settings, projects.created_at AS createdAt, projects.updated_at AS updatedAt
     FROM projects
     JOIN organization_members ON organization_members.organization_id = projects.organization_id
     WHERE organization_members.user_id = ? AND projects.id = ?`,
    [userId, projectId]
  );
  return rows[0] || null;
};

const createProject = async (userId, payloadOrName, maybeEnvironment) => {
  const name = typeof payloadOrName === 'object' && payloadOrName ? payloadOrName.name : payloadOrName;
  const rawEnv = typeof payloadOrName === 'object' && payloadOrName ? payloadOrName.environment : maybeEnvironment;
  const environment = ['test', 'live'].includes(String(rawEnv).toLowerCase()) ? String(rawEnv).toLowerCase() : 'live';

  const normalizedName = validateProjectName(name);
  const targetOrgId = typeof payloadOrName === 'object' && payloadOrName ? payloadOrName.organizationId : null;
  const memberships = await query(
    targetOrgId
      ? `SELECT organization_id AS organizationId, role FROM organization_members WHERE user_id = ? AND organization_id = ?`
      : `SELECT organization_id AS organizationId, role FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
    targetOrgId ? [userId, targetOrgId] : [userId]
  );
  const membership = memberships.rows[0];
  if (!membership) {
    const error = new Error('A workspace is required before creating projects.');
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  if (membership.role === 'viewer') {
    const error = new Error('Viewers are not permitted to create projects.');
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  const organizationId = membership.organizationId;
  const { rows: orgRows } = await query('SELECT status FROM organizations WHERE id = ?', [organizationId]);
  if (orgRows[0]?.status === 'suspended') {
    const error = new Error('Cannot create projects while organization is suspended.');
    error.code = 'ORGANIZATION_SUSPENDED';
    error.statusCode = 403;
    throw error;
  }
  if (orgRows[0]?.status === 'deleted') {
    const error = new Error('Cannot create projects on a deleted organization.');
    error.code = 'ORGANIZATION_DELETED';
    error.statusCode = 403;
    throw error;
  }

  // Enforce plan limits on project count
  const subscriptionService = require('../subscription/subscriptionService');
  await subscriptionService.checkPlanLimits(organizationId, 'projects', 1);

  const slug = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const id = makeId('prj');
  const now = new Date().toISOString();
  await query(
    `INSERT INTO projects (id, organization_id, name, slug, environment, status, settings, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', '{}', ?, ?)`,
    [id, organizationId, normalizedName, slug, environment, now, now]
  );

  // Initialize default widget settings
  await query(
    `INSERT INTO widget_settings (project_id, agent_name, welcome_message, accent_color, theme, position, placeholder, allowed_domains, updated_at)
     VALUES (?, 'Contextis Support', 'Hi! How can we help you today?', '#38bdf8', 'dark', 'bottom-right', 'Type your message...', '*', ?)
     ON CONFLICT (project_id) DO NOTHING`,
    [id, now]
  );

  return getOwnedProject(userId, id);
};

const listProjects = async (userId) => {
  const { rows } = await query(
    `SELECT projects.id, projects.organization_id AS organizationId, projects.name,
            projects.slug, projects.environment, projects.status,
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

const DEFAULT_SECRET_SCOPES = [
  'support:read',
  'support:write',
  'customers:read',
  'customers:write',
  'conversations:read',
  'memory:read',
  'memory:write',
  'tools:execute',
  'usage:read',
];

const DEFAULT_PUBLIC_SCOPES = [
  'support:read',
  'support:write',
  'widget:load',
];

const createApiKey = async (userId, projectId, { name, environment = 'test', type = 'secret', scopes } = {}) => {
  const project = await getOwnedProject(userId, projectId);
  if (!project) {
    return null;
  }

  const membership = await query(
    `SELECT role FROM organization_members WHERE user_id = ? AND organization_id = ?`,
    [userId, project.organizationId]
  );
  if (membership.rows[0]?.role === 'viewer') {
    const error = new Error('Viewers are not permitted to generate API keys.');
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  const subscriptionService = require('../subscription/subscriptionService');
  await subscriptionService.checkPlanLimits(project.organizationId, 'api_keys', 1);

  const normalizedName = String(name || '').trim();
  const normalizedEnvironment = String(environment).toLowerCase();
  const normalizedType = String(type || 'secret').toLowerCase() === 'public' ? 'public' : 'secret';

  if (normalizedName.length < 1 || normalizedName.length > 100 || !['test', 'live'].includes(normalizedEnvironment)) {
    const error = new Error('Provide a key name and environment of test or live.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const prefixChar = normalizedType === 'public' ? 'pk' : 'sk';
  const rawKey = `${prefixChar}_${normalizedEnvironment}_${crypto.randomBytes(32).toString('base64url')}`;
  const id = makeId('key');
  const prefix = rawKey.slice(0, 15);
  const createdAt = new Date().toISOString();

  const keyScopes = Array.isArray(scopes) && scopes.length > 0
    ? scopes
    : (normalizedType === 'public' ? DEFAULT_PUBLIC_SCOPES : DEFAULT_SECRET_SCOPES);

  await query(
    `INSERT INTO project_api_keys (id, project_id, created_by_user_id, name, prefix, environment, hash, status, key_type, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [id, projectId, userId, normalizedName, prefix, normalizedEnvironment, hashApiKey(rawKey), normalizedType, JSON.stringify(keyScopes), createdAt]
  );

  return {
    key: rawKey,
    metadata: {
      id,
      projectId,
      name: normalizedName,
      prefix,
      environment: normalizedEnvironment,
      keyType: normalizedType,
      scopes: keyScopes,
      status: 'active',
      createdAt,
      lastUsedAt: null,
    },
  };
};

const listApiKeys = async (userId, projectId) => {
  if (!await getOwnedProject(userId, projectId)) {
    return null;
  }
  const { rows } = await query(
    `SELECT id, project_id AS projectId, name, prefix, environment, status,
            COALESCE(key_type, 'secret') AS keyType, COALESCE(scopes, '[]') AS scopes,
            created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
     FROM project_api_keys WHERE project_id = ? ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map((row) => ({
    ...row,
    scopes: (() => {
      try { return JSON.parse(row.scopes); } catch { return []; }
    })(),
  }));
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
            COALESCE(project_api_keys.key_type, 'secret') AS keyType,
            COALESCE(project_api_keys.scopes, '[]') AS scopes,
            projects.organization_id AS organizationId,
            projects.status AS projectStatus,
            COALESCE(organizations.status, 'active') AS organizationStatus
     FROM project_api_keys
     JOIN projects ON projects.id = project_api_keys.project_id
     JOIN organizations ON organizations.id = projects.organization_id
     WHERE project_api_keys.hash = ?`,
    [hash]
  );
  const key = rows[0];
  if (!key) {
    return null;
  }
  if (key.status === 'active' && key.projectStatus === 'active' && key.organizationStatus === 'active') {
    await query('UPDATE project_api_keys SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), key.id]);
  }
  return {
    ...key,
    scopes: (() => {
      try { return JSON.parse(key.scopes); } catch { return []; }
    })(),
  };
};

const getWidgetSettings = async (projectId) => {
  const { rows } = await query(
    `SELECT project_id AS projectId, agent_name AS agentName, welcome_message AS welcomeMessage,
            accent_color AS accentColor, theme, position, placeholder, allowed_domains AS allowedDomains,
            updated_at AS updatedAt
     FROM widget_settings WHERE project_id = ?`,
    [projectId]
  );

  if (rows[0]) {
    return rows[0];
  }

  return {
    projectId,
    agentName: 'Contextis Support',
    welcomeMessage: 'Hi! How can we help you today?',
    accentColor: '#38bdf8',
    theme: 'dark',
    position: 'bottom-right',
    placeholder: 'Type your message...',
    allowedDomains: '*',
    updatedAt: new Date().toISOString(),
  };
};

const saveWidgetSettings = async (projectId, settings = {}) => {
  const now = new Date().toISOString();
  const agentName = String(settings.agentName || settings.agent_name || 'Contextis Support').trim().slice(0, 100);
  const welcomeMessage = String(settings.welcomeMessage || settings.welcome_message || 'Hi! How can we help you today?').trim().slice(0, 500);
  const accentColor = String(settings.accentColor || settings.accent_color || '#38bdf8').trim();
  const theme = ['light', 'dark', 'auto'].includes(settings.theme) ? settings.theme : 'dark';
  const position = ['bottom-right', 'bottom-left'].includes(settings.position) ? settings.position : 'bottom-right';
  const placeholder = String(settings.placeholder || 'Type your message...').trim().slice(0, 100);
  const allowedDomains = String(settings.allowedDomains || settings.allowed_domains || '*').trim();

  await query(
    `INSERT INTO widget_settings (project_id, agent_name, welcome_message, accent_color, theme, position, placeholder, allowed_domains, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       agent_name = excluded.agent_name,
       welcome_message = excluded.welcome_message,
       accent_color = excluded.accent_color,
       theme = excluded.theme,
       position = excluded.position,
       placeholder = excluded.placeholder,
       allowed_domains = excluded.allowed_domains,
       updated_at = excluded.updated_at`,
    [projectId, agentName, welcomeMessage, accentColor, theme, position, placeholder, allowedDomains, now]
  );

  return getWidgetSettings(projectId);
};

const updateProject = async (userId, projectId, updates = {}) => {
  const project = await getOwnedProject(userId, projectId);
  if (!project) return null;

  const now = new Date().toISOString();
  let name = project.name;
  let environment = project.environment;
  let status = project.status;

  if (updates.name !== undefined) {
    name = validateProjectName(updates.name);
  }
  if (updates.environment !== undefined) {
    const normEnv = String(updates.environment).toLowerCase();
    if (!['test', 'live'].includes(normEnv)) {
      const error = new Error('environment must be test or live.');
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }
    environment = normEnv;
  }
  if (updates.status !== undefined) {
    const normStatus = String(updates.status).toLowerCase();
    if (!['active', 'archived'].includes(normStatus)) {
      const error = new Error('status must be active or archived.');
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }
    status = normStatus;
  }

  await query(
    `UPDATE projects SET name = ?, environment = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    [name, environment, status, now, projectId]
  );

  return getOwnedProject(userId, projectId);
};

const rotateApiKey = async (userId, projectId, keyId) => {
  const project = await getOwnedProject(userId, projectId);
  if (!project) return null;

  const existing = await query(
    `SELECT id, name, environment, key_type, scopes, status FROM project_api_keys
     WHERE id = ? AND project_id = ?`,
    [keyId, projectId]
  );
  if (!existing.rows[0]) {
    const error = new Error('API key not found.');
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  // Revoke existing
  await revokeApiKey(userId, projectId, keyId);

  // Parse existing scopes
  const parsedScopes = (() => {
    try { return JSON.parse(existing.rows[0].scopes); } catch { return []; }
  })();

  // Create rotated key
  const newKey = await createApiKey(userId, projectId, {
    name: `${existing.rows[0].name} (Rotated)`,
    environment: existing.rows[0].environment,
    type: existing.rows[0].key_type,
    scopes: parsedScopes,
  });

  return newKey;
};

module.exports = {
  createProject,
  listProjects,
  getOwnedProject,
  updateProject,
  deleteProject,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  authenticateApiKey,
  hashApiKey,
  getWidgetSettings,
  saveWidgetSettings,
};