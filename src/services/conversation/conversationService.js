const crypto = require('crypto');
const { query } = require('../../db');
const { sanitizeText } = require('../../utils/sanitizers');

const getOrCreateConversation = async ({ projectId, customerId, environment = 'live', requestedId }) => {
  if (!projectId || !customerId) {
    const error = new Error('projectId and customerId are required.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const normalizedEnv = ['test', 'live'].includes(String(environment).toLowerCase())
    ? String(environment).toLowerCase()
    : 'live';

  if (requestedId !== undefined && requestedId !== null && requestedId !== '') {
    const convId = String(requestedId).trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(convId)) {
      const error = new Error('conversation_id is invalid (1-128 alphanumeric, dashes, underscores).');
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }

    const { rows } = await query(
      `SELECT id, project_id AS projectId, customer_id AS customerId, environment, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM conversations WHERE id = ?`,
      [convId]
    );

    if (rows[0]) {
      if (rows[0].projectId !== projectId || rows[0].customerId !== customerId) {
        const error = new Error('conversation_id does not belong to this project or customer.');
        error.code = 'FORBIDDEN';
        error.statusCode = 403;
        throw error;
      }
      return rows[0];
    }

    // Insert with requested ID
    const now = new Date().toISOString();
    await query(
      `INSERT INTO conversations (id, project_id, customer_id, environment, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      [convId, projectId, customerId, normalizedEnv, now, now]
    );

    return {
      id: convId,
      projectId,
      customerId,
      environment: normalizedEnv,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
  }

  // Generate new conversation
  const id = `conv_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO conversations (id, project_id, customer_id, environment, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?)`,
    [id, projectId, customerId, normalizedEnv, now, now]
  );

  return {
    id,
    projectId,
    customerId,
    environment: normalizedEnv,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
};

const appendMessage = async ({ conversationId, projectId, senderType, content, metadata = {}, requestId }) => {
  const allowedSenders = ['customer', 'agent', 'system', 'tool'];
  const normalizedSender = String(senderType || 'system').toLowerCase();
  if (!allowedSenders.includes(normalizedSender)) {
    throw new Error(`Invalid sender_type '${senderType}'. Must be customer, agent, system, or tool.`);
  }

  const cleanContent = sanitizeText(content || '');
  if (!cleanContent) {
    throw new Error('Message content cannot be empty.');
  }

  const id = `msg_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  const safeMeta = typeof metadata === 'object' && metadata ? JSON.stringify(metadata) : '{}';

  await query(
    `INSERT INTO conversation_messages (id, conversation_id, project_id, sender_type, content, metadata, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, conversationId, projectId, normalizedSender, cleanContent, safeMeta, requestId || null, now]
  );

  // Touch conversation updated_at
  await query(
    `UPDATE conversations SET updated_at = ? WHERE id = ? AND project_id = ?`,
    [now, conversationId, projectId]
  );

  return {
    id,
    conversationId,
    projectId,
    senderType: normalizedSender,
    content: cleanContent,
    requestId: requestId || null,
    createdAt: now,
  };
};

const getConversationTranscript = async ({ projectId, conversationId }) => {
  const { rows: convRows } = await query(
    `SELECT conversations.id, conversations.project_id AS projectId, conversations.customer_id AS customerId,
            conversations.environment, conversations.status, conversations.created_at AS createdAt,
            conversations.updated_at AS updatedAt, customers.external_user_id AS externalUserId
     FROM conversations
     JOIN customers ON customers.id = conversations.customer_id
     WHERE conversations.id = ? AND conversations.project_id = ?`,
    [conversationId, projectId]
  );

  if (!convRows[0]) {
    return null;
  }

  const { rows: msgRows } = await query(
    `SELECT id, conversation_id AS conversationId, sender_type AS senderType,
            content, metadata, request_id AS requestId, created_at AS createdAt
     FROM conversation_messages
     WHERE conversation_id = ? AND project_id = ?
     ORDER BY created_at ASC`,
    [conversationId, projectId]
  );

  return {
    conversation: convRows[0],
    messages: msgRows.map((m) => ({
      ...m,
      metadata: (() => { try { return JSON.parse(m.metadata); } catch { return {}; } })(),
    })),
  };
};

const listConversations = async ({ projectId, customerId, environment, status, limit = 50, offset = 0 } = {}) => {
  const safeLimit = Math.min(Math.max(1, Number(limit || 50)), 100);
  const safeOffset = Math.max(0, Number(offset || 0));

  let sql = `
    SELECT conversations.id, conversations.project_id AS projectId, conversations.customer_id AS customerId,
           conversations.environment, conversations.status, conversations.created_at AS createdAt,
           conversations.updated_at AS updatedAt, customers.external_user_id AS externalUserId,
           (SELECT COUNT(*) FROM conversation_messages WHERE conversation_messages.conversation_id = conversations.id) AS messageCount
    FROM conversations
    JOIN customers ON customers.id = conversations.customer_id
    WHERE conversations.project_id = ?
  `;
  const params = [projectId];

  if (customerId) {
    sql += ` AND conversations.customer_id = ?`;
    params.push(customerId);
  }

  if (environment && ['test', 'live'].includes(environment)) {
    sql += ` AND conversations.environment = ?`;
    params.push(environment);
  }

  if (status && ['open', 'closed', 'resolved'].includes(status)) {
    sql += ` AND conversations.status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY conversations.updated_at DESC LIMIT ? OFFSET ?`;
  params.push(safeLimit, safeOffset);

  const { rows } = await query(sql, params);
  return rows.map((r) => ({
    ...r,
    messageCount: Number(r.messageCount || 0),
  }));
};

const closeConversation = async ({ projectId, conversationId, resolutionStatus = 'closed' }) => {
  const now = new Date().toISOString();
  const { changes } = await query(
    `UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
    [resolutionStatus, now, conversationId, projectId]
  );
  return changes > 0;
};

module.exports = {
  getOrCreateConversation,
  appendMessage,
  getConversationTranscript,
  listConversations,
  closeConversation,
};
