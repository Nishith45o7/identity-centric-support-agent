const { logger } = require('../utils/logger');

const requestLogger = (req, res, next) => {
  const incomingId = req.get('x-request-id');
  const requestId = incomingId && /^req_[A-Za-z0-9_-]{4,64}$/.test(incomingId)
    ? incomingId
    : `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  logger.info('Incoming request', {
    requestId,
    method: req.method,
    url: req.originalUrl,
    userAgent: req.headers['user-agent'],
  });

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const responsePayload = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, requestId }
      : { requestId, payload };

    const statusCode = res.statusCode || 200;
    logger.info('Completed request', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode,
    });

    return originalJson(responsePayload);
  };

  next();
};

module.exports = requestLogger;
