const { query } = require('../../db');

const ROLE_LEVELS = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

const getMembership = async (userId, organizationId) => {
  if (!userId || !organizationId) return null;
  const { rows } = await query(
    `SELECT organization_id AS organizationId, user_id AS userId, role, created_at AS createdAt
     FROM organization_members
     WHERE user_id = ? AND organization_id = ?`,
    [userId, organizationId]
  );
  return rows[0] || null;
};

const requireOrgRole = async (userId, organizationId, minimumRole = 'viewer') => {
  const membership = await getMembership(userId, organizationId);
  if (!membership) {
    const error = new Error('You do not have access to this organization.');
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  const userLevel = ROLE_LEVELS[membership.role] || 0;
  const requiredLevel = ROLE_LEVELS[minimumRole] || 1;

  if (userLevel < requiredLevel) {
    const error = new Error(`Insufficient permissions: '${minimumRole}' role required, but your role is '${membership.role}'.`);
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  return membership;
};

const verifyProjectAccess = async (userId, projectId, minimumRole = 'viewer') => {
  if (!userId || !projectId) {
    const error = new Error('User ID and Project ID are required.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const { rows } = await query(
    `SELECT projects.id, projects.organization_id AS organizationId, projects.name,
            projects.status, projects.environment, organization_members.role
     FROM projects
     JOIN organization_members ON organization_members.organization_id = projects.organization_id
     WHERE organization_members.user_id = ? AND projects.id = ?`,
    [userId, projectId]
  );

  const project = rows[0];
  if (!project) {
    const error = new Error('Project not found or access denied.');
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const userLevel = ROLE_LEVELS[project.role] || 0;
  const requiredLevel = ROLE_LEVELS[minimumRole] || 1;
  if (userLevel < requiredLevel) {
    const error = new Error(`Insufficient permissions on this project: '${minimumRole}' role required.`);
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  return project;
};

const verifyCustomerAccess = async (projectId, customerId) => {
  const { rows } = await query(
    `SELECT id, project_id AS projectId, external_user_id AS externalUserId,
            environment, metadata, created_at AS createdAt, last_seen_at AS lastSeenAt
     FROM customers
     WHERE project_id = ? AND id = ?`,
    [projectId, customerId]
  );
  if (!rows[0]) {
    const error = new Error('Customer not found in this project.');
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  return rows[0];
};

const verifyConversationAccess = async (projectId, conversationId) => {
  const { rows } = await query(
    `SELECT id, project_id AS projectId, customer_id AS customerId,
            environment, status, created_at AS createdAt, updated_at AS updatedAt
     FROM conversations
     WHERE project_id = ? AND id = ?`,
    [projectId, conversationId]
  );
  if (!rows[0]) {
    const error = new Error('Conversation not found in this project.');
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  return rows[0];
};

const verifyToolAccess = async (projectId, toolId) => {
  const { rows } = await query(
    `SELECT id, project_id AS projectId, name, description, sensitivity, permissions, input_schema AS inputSchema, status
     FROM project_tools
     WHERE project_id = ? AND id = ?`,
    [projectId, toolId]
  );
  if (!rows[0]) {
    const error = new Error('Tool not found in this project.');
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  return rows[0];
};

const hasScope = (keyOrScopes, requiredScope) => {
  if (!requiredScope) return true;
  let scopes = [];
  if (Array.isArray(keyOrScopes)) {
    scopes = keyOrScopes;
  } else if (keyOrScopes && Array.isArray(keyOrScopes.scopes)) {
    scopes = keyOrScopes.scopes;
  } else if (typeof keyOrScopes?.scopes === 'string') {
    try { scopes = JSON.parse(keyOrScopes.scopes); } catch { scopes = []; }
  }

  if (scopes.includes('*') || scopes.includes('all')) return true;
  return scopes.includes(requiredScope);
};

const requireScope = (keyOrScopes, requiredScope) => {
  if (!hasScope(keyOrScopes, requiredScope)) {
    const error = new Error(`API key lacks required scope '${requiredScope}'.`);
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }
  return true;
};

module.exports = {
  ROLE_LEVELS,
  getMembership,
  requireOrgRole,
  verifyProjectAccess,
  verifyCustomerAccess,
  verifyConversationAccess,
  verifyToolAccess,
  hasScope,
  requireScope,
};
