const { sanitizeText, validateUserId } = require('../utils/sanitizers');

const getUserIdFromRequest = (req) => {
  const candidate = req.body?.userId || req.body?.user_id || req.query?.userId || req.query?.user_id || req.params?.userId || req.headers['x-user-id'];
  return candidate;
};

const validateChatPayload = (req, res, next) => {
  const message = sanitizeText(req.body?.message || '');
  const userId = getUserIdFromRequest(req);

  if (!message) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'A message is required.' },
    });
  }

  if (message.length > 1500) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Message is too long.' },
    });
  }

  if (userId && !validateUserId(String(userId))) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_IDENTITY', message: 'The supplied user ID is invalid.' },
    });
  }

  req.body.message = message;
  next();
};

const validateSessionPayload = (req, res, next) => {
  const userId = getUserIdFromRequest(req);
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

  if (!userId || !validateUserId(String(userId))) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_IDENTITY', message: 'A valid userId is required.' },
    });
  }

  if (!messages.length) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'At least one message is required to finalize a session.' },
    });
  }

  req.body.messages = messages.map((entry) => sanitizeText(entry)).filter(Boolean);
  next();
};

const validateMemoryRequest = (req, res, next) => {
  const userId = getUserIdFromRequest(req);

  if (!userId || !validateUserId(String(userId))) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_IDENTITY', message: 'A valid userId is required.' },
    });
  }

  next();
};

module.exports = {
  validateChatPayload,
  validateSessionPayload,
  validateMemoryRequest,
  getUserIdFromRequest,
};
