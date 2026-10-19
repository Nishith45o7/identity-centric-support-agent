const crypto = require('crypto');
const { query } = require('../../db');
const memoryService = require('../memory/hindsightMemoryService');

class EscalationService {
  /**
   * Creates a structured human handoff / escalation ticket with complete context
   */
  async createEscalation({
    projectId,
    userId,
    conversationId,
    reason = 'Customer requested human agent',
    metadata = {},
  }) {
    const { rows: projRows } = await query(
      `SELECT projects.id, projects.organization_id AS organizationId, projects.name, projects.environment
       FROM projects WHERE projects.id = ?`,
      [projectId]
    );
    const project = projRows[0];
    if (!project) {
      const error = new Error('Project not found.');
      error.code = 'NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    // 1. Resolve Customer
    const { rows: custRows } = await query(
      `SELECT id, external_user_id, metadata FROM customers WHERE project_id = ? AND external_user_id = ?`,
      [projectId, userId]
    );
    const customer = custRows[0];
    const customerId = customer ? customer.id : `cus_${crypto.randomUUID()}`;

    // 2. Fetch Conversation Messages History
    let messages = [];
    if (conversationId) {
      const { rows: msgRows } = await query(
        `SELECT id, sender_type, content, metadata, created_at
         FROM conversation_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC`,
        [conversationId]
      );
      messages = msgRows || [];
    }

    // 3. Recall Customer Memory
    let memoryFacts = [];
    try {
      const memorySnap = await memoryService.recall(
        userId,
        '',
        project.organizationId,
        projectId,
        project.environment || 'live'
      );
      memoryFacts = memorySnap.facts || [];
    } catch {
      memoryFacts = [];
    }

    // 4. Construct Context Dossier for Human Agent
    const conversationSummary = messages
      .slice(-6)
      .map((m) => `${m.sender_type.toUpperCase()}: ${m.content}`)
      .join('\n');

    const durableContext = memoryFacts
      .map((f) => `• [${f.category}] ${f.fact}`)
      .join('\n') || 'None recorded.';

    const contextSummary = `=== CONTEXTIS ESCALATION DOSSIER ===
Customer ID: ${userId}
Project: ${project.name} (${project.environment})
Reason: ${reason}

=== RECENT CONVERSATION ===
${conversationSummary || 'No conversation transcript yet.'}

=== DURABLE CUSTOMER MEMORY ===
${durableContext}`;

    const escalationId = `esc_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();

    // 5. Insert Escalation Record
    await query(
      `INSERT INTO escalations (id, project_id, conversation_id, customer_id, reason, context_summary, actions_attempted, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
      [
        escalationId,
        projectId,
        conversationId || `conv_esc_${Date.now()}`,
        customerId,
        reason,
        contextSummary,
        JSON.stringify(messages.map((m) => ({ id: m.id, type: m.sender_type, timestamp: m.created_at }))),
        now,
        now,
      ]
    );

    // 6. Update Conversation State
    if (conversationId) {
      await query(
        `UPDATE conversations SET resolution_status = 'escalated', escalation_reason = ?, updated_at = ?
         WHERE id = ?`,
        [reason, now, conversationId]
      );
    }

    // 7. Dispatch Webhook Event (Non-blocking)
    try {
      const webhookService = require('../webhook/webhookService');
      webhookService.dispatch({
        projectId,
        event: 'conversation.escalated',
        data: {
          escalationId,
          conversationId,
          customerId: userId,
          reason,
          status: 'requested',
        },
      }).catch(() => {});
    } catch {
      // safe fallback
    }

    return {
      id: escalationId,
      projectId,
      conversationId,
      customerId: userId,
      status: 'requested',
      reason,
      contextSummary,
      createdAt: now,
    };
  }

  /**
   * Lists escalations for developer workspace
   */
  async listEscalations(projectId, { status, limit = 50 } = {}) {
    let sql = `SELECT * FROM escalations WHERE project_id = ?`;
    const params = [projectId];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(Math.min(Number(limit) || 50, 100));

    const { rows } = await query(sql, params);
    return rows.map((r) => ({
      ...r,
      actionsAttempted: (() => { try { return JSON.parse(r.actions_attempted || '[]'); } catch { return []; } })(),
    }));
  }

  /**
   * Updates escalation status (e.g., assigned, in_progress, resolved)
   */
  async updateStatus(projectId, escalationId, status, assignedTo = null) {
    const validStatuses = ['requested', 'created', 'assigned', 'in_progress', 'waiting', 'resolved', 'cancelled'];
    if (!validStatuses.includes(status)) {
      const error = new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }

    const now = new Date().toISOString();
    const updated = await query(
      `UPDATE escalations SET status = ?, assigned_to = COALESCE(?, assigned_to), updated_at = ?
       WHERE id = ? AND project_id = ?`,
      [status, assignedTo, now, escalationId, projectId]
    );

    if (updated.changes === 0) {
      const error = new Error('Escalation not found.');
      error.code = 'NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    return { success: true, escalationId, status, updatedAt: now };
  }
}

module.exports = new EscalationService();
