const crypto = require('crypto');
const { query } = require('../../db');
const projectService = require('../project/projectService');

const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

const parseJsonField = (value, fallback) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
};

const normalizeToolName = (value) => {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_][a-z0-9_-]{1,62}$/.test(name)) {
    const error = new Error('Tool names must be lowercase alphanumeric with underscores and be 2-63 characters long.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }
  return name;
};

const normalizeSensitivity = (value) => {
  const sensitivity = String(value || 'READ').trim().toUpperCase();
  if (!['READ', 'WRITE', 'ADMIN'].includes(sensitivity)) {
    const error = new Error('Tool sensitivity must be READ, WRITE, or ADMIN.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }
  return sensitivity;
};

const normalizePermissions = (permissions) => {
  if (!Array.isArray(permissions)) {
    return [];
  }
  return permissions
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 30);
};

const validateInputSchema = (inputSchema) => {
  if (inputSchema === undefined || inputSchema === null) {
    return {};
  }

  if (typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    const error = new Error('inputSchema must be an object describing accepted fields.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const schema = { ...inputSchema };
  if (schema.type && schema.type !== 'object') {
    const error = new Error('The tool input schema must describe an object type.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    schema.properties = {};
  }
  if (!Array.isArray(schema.required)) {
    schema.required = [];
  }
  return schema;
};

const serializeTool = (tool) => ({
  ...tool,
  permissions: Array.isArray(tool.permissions) ? tool.permissions : parseJsonField(tool.permissions, []),
  inputSchema: typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
    ? tool.inputSchema
    : parseJsonField(tool.inputSchema, {}),
});

const getProjectTool = async (projectId, toolId) => {
  const { rows } = await query(
    `SELECT id, project_id AS projectId, created_by_user_id AS createdByUserId, name, description,
            sensitivity, permissions, input_schema AS inputSchema, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM project_tools
     WHERE project_id = ? AND id = ?`,
    [projectId, toolId]
  );

  if (!rows[0]) {
    return null;
  }

  return serializeTool(rows[0]);
};

const getOwnedProjectTool = async (userId, projectId, toolId) => {
  const project = await projectService.getOwnedProject(userId, projectId);
  if (!project) {
    return null;
  }
  return getProjectTool(projectId, toolId);
};

const createProjectTool = async (userId, projectId, payload = {}) => {
  const project = await projectService.getOwnedProject(userId, projectId);
  if (!project) {
    return null;
  }

  const name = normalizeToolName(payload.name);
  const description = String(payload.description || '').trim().slice(0, 500) || 'Project tool';
  const sensitivity = normalizeSensitivity(payload.sensitivity);
  const permissions = normalizePermissions(payload.permissions);
  const inputSchema = validateInputSchema(payload.inputSchema);
  const now = new Date().toISOString();
  const id = makeId('tool');

  await query(
    `INSERT INTO project_tools (id, project_id, created_by_user_id, name, description, sensitivity, permissions, input_schema, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)` ,
    [id, projectId, userId, name, description, sensitivity, JSON.stringify(permissions), JSON.stringify(inputSchema), now, now]
  );

  const tool = await getProjectTool(projectId, id);
  return tool;
};

const listProjectTools = async (userId, projectId) => {
  const project = await projectService.getOwnedProject(userId, projectId);
  if (!project) {
    return null;
  }

  const { rows } = await query(
    `SELECT id, project_id AS projectId, created_by_user_id AS createdByUserId, name, description,
            sensitivity, permissions, input_schema AS inputSchema, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM project_tools WHERE project_id = ? ORDER BY created_at DESC`,
    [projectId]
  );

  return rows.map(serializeTool);
};

const validatePayloadAgainstSchema = (data, schema) => {
  const payload = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(payload, field) || payload[field] === undefined || payload[field] === null || (typeof payload[field] === 'string' && !payload[field].trim())) {
      const error = new Error(`Missing required field: ${field}`);
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }
  }

  for (const [field, definition] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(payload, field) || payload[field] === undefined || payload[field] === null) {
      continue;
    }
    const expectedType = definition?.type;
    if (expectedType === 'string' && typeof payload[field] !== 'string') {
      const error = new Error(`Field ${field} must be a string.`);
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }
    if (expectedType === 'number' && typeof payload[field] !== 'number') {
      const error = new Error(`Field ${field} must be a number.`);
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }
    if (expectedType === 'boolean' && typeof payload[field] !== 'boolean') {
      const error = new Error(`Field ${field} must be a boolean.`);
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }
  }

  return payload;
};

const executeProjectTool = async (projectId, toolId, input = {}) => {
  const tool = await getProjectTool(projectId, toolId);
  if (!tool) {
    const error = new Error('Tool not found.');
    error.code = 'NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  if (tool.status !== 'active') {
    const error = new Error('This tool is currently disabled.');
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  const schema = typeof tool.inputSchema === 'object' && tool.inputSchema ? tool.inputSchema : {};
  const payload = validatePayloadAgainstSchema(input, schema);
  const permissions = Array.isArray(tool.permissions) ? tool.permissions : [];

  if (permissions.length === 0) {
    const error = new Error('This tool has no permissions configured.');
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  const response = {
    toolId: tool.id,
    toolName: tool.name,
    projectId,
    permissionScope: permissions,
    executedAt: new Date().toISOString(),
    result: {
      customerId: payload.customerId || null,
      status: 'ok',
      summary: `Tool ${tool.name} executed successfully.`,
    },
  };

  if (payload.customerId) {
    response.result.customerId = payload.customerId;
  }

  return response;
};

module.exports = {
  createProjectTool,
  listProjectTools,
  getProjectTool,
  getOwnedProjectTool,
  executeProjectTool,
  normalizeToolName,
  normalizeSensitivity,
  normalizePermissions,
  validateInputSchema,
  validatePayloadAgainstSchema,
};
