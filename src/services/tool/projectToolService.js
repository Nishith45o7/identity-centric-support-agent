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
  if (!['READ', 'WRITE', 'SENSITIVE', 'ADMIN'].includes(sensitivity)) {
    const error = new Error('Tool sensitivity must be READ, WRITE, SENSITIVE, or ADMIN.');
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

  const dbSensitivity = sensitivity === 'SENSITIVE' ? 'WRITE' : sensitivity;
  await query(
    `INSERT INTO project_tools (id, project_id, created_by_user_id, name, description, sensitivity, permissions, input_schema, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)` ,
    [id, projectId, userId, name, description, dbSensitivity, JSON.stringify(permissions), JSON.stringify(inputSchema), now, now]
  );

  const tool = await getProjectTool(projectId, id);
  if (tool && sensitivity === 'SENSITIVE') {
    tool.sensitivity = 'SENSITIVE';
  }
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

  // Security guardrail: The AI/support platform must NEVER accept or process passwords
  if (input && (input.password || input.new_password || input.secret || input.auth_token)) {
    const error = new Error('Security policy violation: Passwords and auth tokens must never be supplied to support tools.');
    error.code = 'SECURITY_VIOLATION';
    error.statusCode = 400;
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

  // Business Action Simulators
  let actionResult = {
    customerId: payload.customerId || null,
    status: 'ok',
    summary: `Tool ${tool.name} executed successfully.`,
  };

  if (tool.name === 'send_password_reset') {
    const email = String(payload.email || payload.customerId || '').trim();
    actionResult = {
      customerId: payload.customerId || email,
      status: 'dispatched',
      summary: `Password reset verification email dispatched to verified address. The support agent does not handle credentials.`,
      dispatchMethod: 'email_otp_link',
      verified: true,
    };
  } else if (tool.name === 'track_order' || tool.name === 'get_order') {
    actionResult = {
      customerId: payload.customerId || null,
      orderId: payload.orderId || 'ord_9842',
      status: 'shipped',
      carrier: 'FedEx Express',
      trackingNumber: 'FX-98421049281',
      estimatedDelivery: 'Tomorrow by 5:00 PM',
      summary: `Order ord_9842 is currently in transit with FedEx Express.`,
    };
  } else if (tool.name === 'cancel_order') {
    actionResult = {
      customerId: payload.customerId || null,
      orderId: payload.orderId || 'ord_9842',
      status: 'cancelled',
      refundCents: 4999,
      summary: `Order cancellation successful and refund issued.`,
    };
  } else if (tool.name === 'create_ticket') {
    actionResult = {
      customerId: payload.customerId || null,
      ticketId: `tkt_${Date.now().toString(36)}`,
      status: 'open',
      priority: payload.priority || 'normal',
      summary: `Support escalation ticket opened successfully.`,
    };
  }

  const response = {
    toolId: tool.id,
    toolName: tool.name,
    projectId,
    permissionScope: permissions,
    executedAt: new Date().toISOString(),
    result: actionResult,
  };

  return response;
};

const getStandardToolTemplates = () => [
  {
    name: 'get_order',
    description: 'Retrieve order status, shipment tracking, and line items.',
    sensitivity: 'READ',
    permissions: ['orders:read'],
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        customerId: { type: 'string' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'track_order',
    description: 'Track real-time shipment status and carrier estimation.',
    sensitivity: 'READ',
    permissions: ['orders:read', 'tracking:read'],
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an unfulfilled order upon customer request.',
    sensitivity: 'WRITE',
    permissions: ['orders:write'],
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'create_ticket',
    description: 'Escalate an issue to the human support engineering team.',
    sensitivity: 'WRITE',
    permissions: ['support:write'],
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        subject: { type: 'string' },
        priority: { type: 'string' },
      },
      required: ['customerId', 'subject'],
    },
  },
  {
    name: 'send_password_reset',
    description: 'Trigger secure password reset workflow without exposing credentials.',
    sensitivity: 'SENSITIVE',
    permissions: ['auth:reset'],
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        customerId: { type: 'string' },
      },
      required: ['email'],
    },
  },
];

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
  getStandardToolTemplates,
};
