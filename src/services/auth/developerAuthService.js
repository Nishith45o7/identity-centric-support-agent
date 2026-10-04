const crypto = require('crypto');
const { promisify } = require('util');
const { query, transaction } = require('../../db');

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const hashSessionToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
};

const verifyPassword = async (password, encoded) => {
  const [scheme, n, r, p, saltValue, keyValue] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltValue || !keyValue) {
    return false;
  }

  const expected = Buffer.from(keyValue, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const createSession = async (userId, execute = query) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS).toISOString();
  await execute(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [hashSessionToken(token), userId, expiresAt, createdAt.toISOString()]
  );
  return { token, expiresAt };
};

const signup = async ({ email, password, name } = {}) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedName = String(name || '').trim();

  if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) {
    const error = new Error('Enter a valid email address.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    const error = new Error('Password must be between 12 and 256 characters.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }
  if (normalizedName.length < 1 || normalizedName.length > 120) {
    const error = new Error('Name must be between 1 and 120 characters.');
    error.code = 'INVALID_REQUEST';
    error.statusCode = 400;
    throw error;
  }

  const passwordHash = await hashPassword(password);
  const userId = makeId('usr');
  const organizationId = makeId('org');
  const now = new Date().toISOString();
  const session = await transaction(async (execute) => {
    await execute(
      'INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, normalizedEmail, passwordHash, normalizedName, now, now]
    );
    await execute(
      'INSERT INTO organizations (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)',
      [organizationId, `${normalizedName}'s Workspace`, userId, now]
    );
    await execute(
      'INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
      [organizationId, userId, 'owner', now]
    );
    await execute(
      'INSERT INTO audit_logs (id, organization_id, project_id, actor_user_id, api_key_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [`audit_${crypto.randomUUID()}`, organizationId, null, userId, null, 'organization.created', JSON.stringify({ name: `${normalizedName}'s Workspace`, ownerEmail: normalizedEmail, planName: 'starter' }), now]
    );
    return createSession(userId, execute);
  });

  return {
    user: { id: userId, email: normalizedEmail, name: normalizedName },
    session,
  };
};

const login = async ({ email, password } = {}) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const { rows } = await query(
    'SELECT id, email, password_hash, name FROM users WHERE email = ?',
    [normalizedEmail]
  );
  const user = rows[0];
  const passwordMatches = user && typeof password === 'string'
    ? await verifyPassword(password, user.password_hash)
    : false;

  if (!passwordMatches) {
    const error = new Error('Email or password is incorrect.');
    error.code = 'AUTHENTICATION_REQUIRED';
    error.statusCode = 401;
    throw error;
  }

  const session = await createSession(user.id);
  return {
    user: { id: user.id, email: user.email, name: user.name },
    session,
  };
};

const getSession = async (token) => {
  if (!token || token.length > 128) {
    return null;
  }

  const { rows } = await query(
    `SELECT users.id, users.email, users.name, sessions.expires_at AS expiresAt
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    [hashSessionToken(token), new Date().toISOString()]
  );
  return rows[0] ? { id: rows[0].id, email: rows[0].email, name: rows[0].name, expiresAt: rows[0].expiresAt } : null;
};

const logout = async (token) => {
  if (!token || token.length > 128) {
    return;
  }
  await query('DELETE FROM sessions WHERE token_hash = ?', [hashSessionToken(token)]);
};

module.exports = { signup, login, getSession, logout, hashPassword, verifyPassword };