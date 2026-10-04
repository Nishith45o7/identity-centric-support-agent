const { config } = require('../../config');
const { resolveIdentity } = require('../identity/identityService');
const memoryService = require('../memory/hindsightMemoryService');
const { generateSupportReply } = require('../llm/groqService');
const { sanitizeFacts, sanitizeText, extractFactCandidates } = require('../../utils/sanitizers');

const isMemoryEnabled = (value) => {
  if (typeof value === 'string') {
    return !['off', 'false', '0', 'no'].includes(value.trim().toLowerCase());
  }

  return value !== false;
};

const processSupportMessage = async ({ userId, message, memoryMode = config.memoryMode, tenantId = 'default', projectId = 'default' }) => {
  const resolvedUserId = resolveIdentity({ userId });
  const modeEnabled = isMemoryEnabled(memoryMode);

  let recalledFacts = [];
  if (modeEnabled) {
    const recallResult = await memoryService.recall(resolvedUserId, message, tenantId, projectId);
    recalledFacts = recallResult.facts;
  }

  const replyResult = await generateSupportReply({
    userId: resolvedUserId,
    message,
    memoryFacts: recalledFacts,
  });

  return {
    success: true,
    reply: replyResult.reply,
    memoryUsed: modeEnabled && recalledFacts.length > 0,
    recalledFacts,
    sessionId: `session_${Date.now()}_${resolvedUserId}`,
  };
};

const finalizeSession = async ({ userId, messages = [], tenantId = 'default', projectId = 'default' }) => {
  const resolvedUserId = resolveIdentity({ userId });
  const allText = messages.map((entry) => sanitizeText(entry)).filter(Boolean).join(' ');
  const extracted = extractFactCandidates(allText);
  const facts = sanitizeFacts(extracted);

  if (!facts.length) {
    return {
      success: true,
      factsStored: 0,
      message: 'No durable facts were extracted from the session.',
    };
  }

  await memoryService.retain(resolvedUserId, facts, tenantId, projectId);

  return {
    success: true,
    factsStored: facts.length,
    retainedFacts: facts,
  };
};

const getMemorySnapshot = async ({ userId, tenantId = 'default', projectId = 'default' }) => {
  const resolvedUserId = resolveIdentity({ userId });
  return memoryService.snapshot(resolvedUserId, tenantId, projectId);
};

const clearMemory = async ({ userId, tenantId = 'default', projectId = 'default' }) => {
  const resolvedUserId = resolveIdentity({ userId });
  return memoryService.clear(resolvedUserId, tenantId, projectId);
};

module.exports = {
  processSupportMessage,
  finalizeSession,
  getMemorySnapshot,
  clearMemory,
  isMemoryEnabled,
};
