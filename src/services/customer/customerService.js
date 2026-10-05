const crypto = require('crypto');
const { query } = require('../../db');
const { validateUserId, sanitizeText } = require('../../utils/sanitizers');

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

const getOrCreateCustomer = async ({ projectId, externalUserId, environment = 'live', metadata = {} }) => {
  if (!projectId) {
    const error = new Error('projectId is required.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const normalizedUserId = String(externalUserId || '').trim();
  if (!normalizedUserId || !validateUserId(normalizedUserId)) {
    const error = new Error('A valid external user_id is required (alphanumeric, dashes, underscores).');
    error.code = 'INVALID_IDENTITY';
    error.statusCode = 400;
    throw error;
  }

  const normalizedEnv = ['test', 'live'].includes(String(environment).toLowerCase())
    ? String(environment).toLowerCase()
    : 'live';

  const now = new Date().toISOString();
  const safeMeta = sanitizeMetadata(metadata);
  const newId = `cus_${crypto.randomUUID().replace(/-/g, '')}`;

  await query(
    `INSERT INTO customers (id, project_id, external_user_id, environment, metadata, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id, external_user_id) DO UPDATE SET
       environment = excluded.environment,
       metadata = excluded.metadata,
       last_seen_at = excluded.last_seen_at`,
    [newId, projectId, normalizedUserId, normalizedEnv, safeMeta, now, now]
  );

  const { rows } = await query(
    `SELECT id, project_id AS projectId, external_user_id AS externalUserId,
            environment, metadata, created_at AS createdAt, last_seen_at AS lastSeenAt
     FROM customers
     WHERE project_id = ? AND external_user_id = ?`,
    [projectId, normalizedUserId]
  );

  return rows[0];
};

const getCustomerByExternalId = async ({ projectId, externalUserId }) => {
  if (!projectId || !externalUserId) return null;
  const { rows } = await query(
    `SELECT id, project_id AS projectId, external_user_id AS externalUserId,
            environment, metadata, created_at AS createdAt, last_seen_at AS lastSeenAt
     FROM customers
     WHERE project_id = ? AND external_user_id = ?`,
    [projectId, String(externalUserId).trim()]
  );
  return rows[0] || null;
};

const getCustomerById = async ({ projectId, customerId }) => {
  if (!projectId || !customerId) return null;
  const { rows } = await query(
    `SELECT id, project_id AS projectId, external_user_id AS externalUserId,
            environment, metadata, created_at AS createdAt, last_seen_at AS lastSeenAt
     FROM customers
     WHERE project_id = ? AND id = ?`,
    [projectId, customerId]
  );
  return rows[0] || null;
};

const listCustomers = async ({ projectId, environment, limit = 50, offset = 0, search } = {}) => {
  const safeLimit = Math.min(Math.max(1, Number(limit || 50)), 100);
  const safeOffset = Math.max(0, Number(offset || 0));

  let sql = `
    SELECT id, project_id AS projectId, external_user_id AS externalUserId,
           environment, metadata, created_at AS createdAt, last_seen_at AS lastSeenAt
    FROM customers
    WHERE project_id = ?
  `;
  const params = [projectId];

  if (environment && ['test', 'live'].includes(environment)) {
    sql += ` AND environment = ?`;
    params.push(environment);
  }

  if (search) {
    sql += ` AND external_user_id LIKE ?`;
    params.push(`%${search.trim()}%`);
  }

  sql += ` ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`;
  params.push(safeLimit, safeOffset);

  const { rows } = await query(sql, params);
  return rows.map((r) => ({
    ...r,
    metadata: (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })(),
  }));
};

const deleteCustomer = async ({ projectId, organizationId, externalUserId, environment = 'live' }) => {
  const customer = await getCustomerByExternalId({ projectId, externalUserId });
  if (!customer) return false;

  // Delete messages
  await query(
    `DELETE FROM conversation_messages WHERE project_id = ? AND conversation_id IN (
       SELECT id FROM conversations WHERE project_id = ? AND customer_id = ?
     )`,
    [projectId, projectId, customer.id]
  );

  // Delete conversations
  await query(
    `DELETE FROM conversations WHERE project_id = ? AND customer_id = ?`,
    [projectId, customer.id]
  );

  // Delete customer record
  const { changes } = await query(
    `DELETE FROM customers WHERE project_id = ? AND id = ?`,
    [projectId, customer.id]
  );

  // Clear memory
  try {
    const memoryService = require('../memory/hindsightMemoryService');
    await memoryService.clear(externalUserId, organizationId || 'default', projectId, environment);
  } catch {
    // Memory deletion failure shouldn't abort customer deletion
  }

  return changes > 0;
};

const exportCustomerData = async ({ projectId, organizationId, externalUserId, environment = 'live' }) => {
  const customer = await getCustomerByExternalId({ projectId, externalUserId });
  if (!customer) return null;

  const convs = await query(
    `SELECT id, environment, status, created_at AS createdAt, updated_at AS updatedAt
     FROM conversations WHERE project_id = ? AND customer_id = ? ORDER BY created_at DESC`,
    [projectId, customer.id]
  );

  const msgs = await query(
    `SELECT id, conversation_id AS conversationId, sender_type AS senderType, content,
            request_id AS requestId, created_at AS createdAt
     FROM conversation_messages
     WHERE project_id = ? AND conversation_id IN (
       SELECT id FROM conversations WHERE project_id = ? AND customer_id = ?
     ) ORDER BY created_at ASC`,
    [projectId, projectId, customer.id]
  );

  let memoryFacts = [];
  try {
    const memoryService = require('../memory/hindsightMemoryService');
    const mem = await memoryService.recall(externalUserId, '', organizationId || 'default', projectId, environment);
    memoryFacts = mem.facts || [];
  } catch {
    memoryFacts = [];
  }

  return {
    customer,
    conversations: convs.rows,
    messages: msgs.rows,
    memory: memoryFacts,
  };
};

module.exports = {
  getOrCreateCustomer,
  getCustomerByExternalId,
  getCustomerById,
  listCustomers,
  deleteCustomer,
  exportCustomerData,
};
