const { validateUserId } = require('../../utils/sanitizers');

const resolveIdentity = ({ userId, authUserId } = {}) => {
  const candidate = authUserId || userId;

  if (!validateUserId(candidate)) {
    const err = new Error('Invalid identity supplied.');
    err.code = 'INVALID_IDENTITY';
    err.statusCode = 400;
    throw err;
  }

  return candidate.trim();
};

module.exports = { resolveIdentity };
