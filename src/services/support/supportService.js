const crypto = require('crypto');
const { query } = require('../../db');
const { config } = require('../../config');
const projectService = require('../project/projectService');
const customerService = require('../customer/customerService');
const conversationService = require('../conversation/conversationService');
const subscriptionService = require('../subscription/subscriptionService');
const memoryService = require('../memory/hindsightMemoryService');
const { generateSupportReply } = require('../llm/groqService');
const projectToolService = require('../tool/projectToolService');
const webhookService = require('../webhook/webhookService');
const { sanitizeText, sanitizeFacts, extractFactCandidates, validateUserId } = require('../../utils/sanitizers');

class SupportService {
  /**
   * Core orchestrator for the Contextis Support Engine
   */
  async handleChatRequest({
    rawApiKey,
    authenticatedKey,
    userId,
    message,
    conversationId,
    metadata = {},
    environment: reqEnvironment,
    requestId = `req_${crypto.randomUUID().replace(/-/g, '')}`,
  }) {
    const startedAt = Date.now();
    let statusCode = 200;
    let memoryOperations = 0;
    let toolExecutions = 0;

    // 1. Authenticate API Key if raw key provided
    let key = authenticatedKey;
    if (!key && rawApiKey) {
      key = await projectService.authenticateApiKey(rawApiKey);
    }

    if (!key) {
      const error = new Error('A valid project API key is required.');
      error.code = 'INVALID_API_KEY';
      error.statusCode = 401;
      error.requestId = requestId;
      throw error;
    }

    if (key.status !== 'active') {
      const error = new Error('This API key has been revoked.');
      error.code = 'REVOKED_API_KEY';
      error.statusCode = 401;
      error.requestId = requestId;
      throw error;
    }

    // 2. Validate Key Scope (support:write)
    const scopes = Array.isArray(key.scopes) ? key.scopes : [];
    if (!scopes.includes('*') && !scopes.includes('all') && !scopes.includes('support:write')) {
      const error = new Error("API key lacks required 'support:write' scope.");
      error.code = 'FORBIDDEN';
      error.statusCode = 403;
      error.requestId = requestId;
      throw error;
    }

    // 3. Resolve Organization and Project
    const { rows: orgRows } = await query(
      `SELECT id, name, slug, status, plan_name AS planName, billing_status AS billingStatus
       FROM organizations WHERE id = ?`,
      [key.organizationId]
    );
    const organization = orgRows[0];
    if (!organization) {
      const error = new Error('Organization not found.');
      error.code = 'NOT_FOUND';
      error.statusCode = 404;
      error.requestId = requestId;
      throw error;
    }

    if (organization.status === 'suspended') {
      const error = new Error('This organization has been suspended. Please contact platform support.');
      error.code = 'ORGANIZATION_SUSPENDED';
      error.statusCode = 403;
      error.requestId = requestId;
      throw error;
    }

    if (organization.status === 'deleted') {
      const error = new Error('This organization has been deleted.');
      error.code = 'ORGANIZATION_DELETED';
      error.statusCode = 403;
      error.requestId = requestId;
      throw error;
    }

    const { rows: projRows } = await query(
      `SELECT id, organization_id AS organizationId, name, environment, status
       FROM projects WHERE id = ?`,
      [key.projectId]
    );
    const project = projRows[0];
    if (!project || project.status !== 'active') {
      const error = new Error('Project is not active or does not exist.');
      error.code = 'PROJECT_ARCHIVED';
      error.statusCode = 403;
      error.requestId = requestId;
      throw error;
    }

    // Validate metadata if provided
    if (metadata !== null && metadata !== undefined && (typeof metadata !== 'object' || Array.isArray(metadata))) {
      const error = new Error('metadata must be a JSON object.');
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      error.requestId = requestId;
      throw error;
    }

    // Determine environment (inherit from key or project)
    const environment = key.environment || project.environment || 'live';
    const targetEnv = String(reqEnvironment || metadata?.environment || '').trim().toLowerCase();
    if (targetEnv && ['test', 'live'].includes(targetEnv) && targetEnv !== environment) {
      const error = new Error(`API key environment (${environment}) does not match requested environment (${targetEnv}).`);
      error.code = 'ENVIRONMENT_MISMATCH';
      error.statusCode = 400;
      error.requestId = requestId;
      throw error;
    }

    // 4. Validate Customer Identity
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId || !validateUserId(normalizedUserId)) {
      const error = new Error('A valid user_id is required (alphanumeric, dashes, underscores).');
      error.code = 'INVALID_IDENTITY';
      error.statusCode = 400;
      error.requestId = requestId;
      throw error;
    }

    // Validate message payload
    const cleanMessage = sanitizeText(message || '');
    if (!cleanMessage) {
      const error = new Error('A message is required.');
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      error.requestId = requestId;
      throw error;
    }

    if (cleanMessage.length > 8000) {
      const error = new Error('Message is too long (maximum 8,000 characters).');
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      error.requestId = requestId;
      throw error;
    }

    try {
      // 5. Subscription Gating & Rate Limiting
      const plan = await subscriptionService.getOrganizationPlan(organization.id);
      await subscriptionService.checkPlanLimits(organization.id, 'requests', 1);
      subscriptionService.checkRateLimit(organization.id, plan.rateLimitPerMinute);

      // 6. Resolve Customer & Conversation
      const customer = await customerService.getOrCreateCustomer({
        projectId: project.id,
        externalUserId: normalizedUserId,
        environment,
        metadata,
      });

      const conversation = await conversationService.getOrCreateConversation({
        projectId: project.id,
        customerId: customer.id,
        environment,
        requestedId: conversationId,
      });

      // 7. Recall Memory
      let recalledFacts = [];
      const memoryEnabled = String(config.memoryMode).toLowerCase() !== 'off';
      if (memoryEnabled) {
        const recallResult = await memoryService.recall(
          normalizedUserId,
          cleanMessage,
          organization.id,
          project.id,
          environment
        );
        recalledFacts = recallResult.facts || [];
        memoryOperations += 1;
      }

      // 8. Generate Support Reply
      const replyResult = await generateSupportReply({
        message: cleanMessage,
        memoryFacts: recalledFacts,
        userId: normalizedUserId,
      });

      let finalReply = replyResult.reply;

      // 9. Extract and Retain Useful Facts
      if (memoryEnabled) {
        const extracted = extractFactCandidates(cleanMessage);
        const durableFacts = sanitizeFacts(extracted);
        if (durableFacts.length > 0) {
          await memoryService.retain(
            normalizedUserId,
            durableFacts,
            organization.id,
            project.id,
            environment
          );
          memoryOperations += 1;
        }
      }

      // 10. Persist Conversation Messages
      await conversationService.appendMessage({
        conversationId: conversation.id,
        projectId: project.id,
        senderType: 'customer',
        content: cleanMessage,
        metadata: { userId: normalizedUserId, environment },
        requestId,
      });

      await conversationService.appendMessage({
        conversationId: conversation.id,
        projectId: project.id,
        senderType: 'agent',
        content: finalReply,
        metadata: { memoryUsed: recalledFacts.length > 0, factsCount: recalledFacts.length },
        requestId,
      });

      // Dispatch Webhook Event (Non-blocking)
      try {
        webhookService.dispatch({
          projectId: project.id,
          event: 'conversation.created',
          data: {
            conversationId: conversation.id,
            customerId: normalizedUserId,
            requestId,
          },
        }).catch(() => {});
      } catch {
        // safe fallback
      }

      return {
        request_id: requestId,
        requestId,
        conversation_id: conversation.id,
        conversationId: conversation.id,
        user_id: normalizedUserId,
        userId: normalizedUserId,
        response: finalReply,
        reply: finalReply,
        memory_used: recalledFacts.length > 0,
        memoryUsed: recalledFacts.length > 0,
      };
    } catch (err) {
      statusCode = err.statusCode || 500;
      throw err;
    } finally {
      // 11. Record Usage
      try {
        const durationMs = Date.now() - startedAt;
        const usageId = `usg_${crypto.randomUUID().replace(/-/g, '')}`;
        await query(
          `INSERT INTO usage_records (id, project_id, organization_id, environment, api_key_id, request_id, endpoint, status_code, duration_ms, memory_operations, ai_requests, tool_executions, created_at)
           VALUES (?, ?, ?, ?, ?, ?, '/v1/support/chat', ?, ?, ?, 1, ?, ?)`,
          [
            usageId,
            project.id,
            organization.id,
            environment,
            key.id,
            requestId,
            statusCode,
            durationMs,
            memoryOperations,
            toolExecutions,
            new Date().toISOString(),
          ]
        );
      } catch {
        // Usage tracking should not fail request
      }
    }
  }

  /**
   * Finalize and close a conversation session
   */
  async handleEndSession({
    rawApiKey,
    authenticatedKey,
    userId,
    conversationId,
    messages = [],
    requestId = `req_${crypto.randomUUID().replace(/-/g, '')}`,
  }) {
    let key = authenticatedKey;
    if (!key && rawApiKey) {
      key = await projectService.authenticateApiKey(rawApiKey);
    }

    if (!key) {
      const error = new Error('A valid project API key is required.');
      error.code = 'INVALID_API_KEY';
      error.statusCode = 401;
      error.requestId = requestId;
      throw error;
    }

    const normalizedUserId = String(userId || '').trim();
    if (!validateUserId(normalizedUserId)) {
      const error = new Error('user_id is invalid.');
      error.code = 'INVALID_IDENTITY';
      error.statusCode = 400;
      error.requestId = requestId;
      throw error;
    }

    const environment = key.environment || 'live';
    const customer = await customerService.getOrCreateCustomer({
      projectId: key.projectId,
      externalUserId: normalizedUserId,
      environment,
    });

    const conversation = await conversationService.getOrCreateConversation({
      projectId: key.projectId,
      customerId: customer.id,
      environment,
      requestedId: conversationId,
    });

    // Retain any facts from provided messages
    const allText = (Array.isArray(messages) ? messages : []).map(sanitizeText).filter(Boolean).join(' ');
    const extracted = extractFactCandidates(allText);
    const durableFacts = sanitizeFacts(extracted);
    let factsStored = 0;

    if (durableFacts.length > 0) {
      await memoryService.retain(
        normalizedUserId,
        durableFacts,
        key.organizationId,
        key.projectId,
        environment
      );
      factsStored = durableFacts.length;
    }

    await conversationService.closeConversation({
      projectId: key.projectId,
      conversationId: conversation.id,
      resolutionStatus: 'closed',
    });

    await conversationService.appendMessage({
      conversationId: conversation.id,
      projectId: key.projectId,
      senderType: 'system',
      content: 'Conversation finalized and closed.',
      metadata: { factsStored },
      requestId,
    });

    return {
      request_id: requestId,
      requestId,
      conversation_id: conversation.id,
      conversationId: conversation.id,
      user_id: normalizedUserId,
      userId: normalizedUserId,
      facts_stored: factsStored,
      factsStored,
    };
  }
}

const supportService = new SupportService();
module.exports = supportService;
