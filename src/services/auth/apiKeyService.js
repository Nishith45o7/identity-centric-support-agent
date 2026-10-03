const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isPostgres, query, ready } = require('../../db');

const pepper = process.env.API_KEY_PEPPER || 'identity-centric-support';
const legacyFile = path.join(process.cwd(), 'data', 'api-keys.json');

const hashValue = (value) => crypto.createHmac('sha256', pepper).update(String(value).trim()).digest('hex');

const writeLegacyFile = (entries) => {
  if (isPostgres) {
    return;
  }

  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, JSON.stringify(entries, null, 2), 'utf8');
};

class ApiKeyService {
  constructor() {
    this.keys = new Map();
    this.ready = ready.then(() => this.loadFromDisk());
  }

  async loadFromDisk() {
    this.keys.clear();

    const { rows } = await query(
      `SELECT id, name, environment, tenant_id AS tenantId, role, status, created_at AS createdAt, last_used_at AS lastUsedAt, hash
       FROM api_keys
       ORDER BY created_at ASC`
    );

    for (const entry of rows) {
      this.keys.set(entry.id, entry);
    }

    writeLegacyFile(Array.from(this.keys.values()).map(({ hash, ...entry }) => ({ ...entry })));
  }

  async persist() {
    await this.loadFromDisk();
  }

  async reset() {
    await this.ready;
    await query('DELETE FROM api_keys');
    this.keys.clear();
    writeLegacyFile([]);
  }

  async createKey({ name = 'Developer App', environment = 'test', tenantId = 'default', role = 'admin' } = {}) {
    await this.ready;
    const normalizedEnv = String(environment).toLowerCase() === 'live' ? 'live' : 'test';
    const normalizedRole = ['admin', 'viewer'].includes(String(role).toLowerCase()) ? String(role).toLowerCase() : 'admin';
    const rawKey = `sk_${normalizedEnv}_${crypto.randomBytes(18).toString('hex')}`;
    const id = `key_${crypto.randomBytes(8).toString('hex')}`;
    const metadata = {
      id,
      name: String(name || 'Developer App').trim() || 'Developer App',
      environment: normalizedEnv,
      tenantId: String(tenantId || 'default').trim() || 'default',
      role: normalizedRole,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    await query(
      `INSERT INTO api_keys (id, name, environment, tenant_id, role, status, created_at, last_used_at, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
      metadata.id,
      metadata.name,
      metadata.environment,
      metadata.tenantId,
      metadata.role,
      metadata.status,
      metadata.createdAt,
      metadata.lastUsedAt,
      hashValue(rawKey)
      ]
    );

    await this.loadFromDisk();
    writeLegacyFile(Array.from(this.keys.values()).map(({ hash, ...entry }) => ({ ...entry })));

    return {
      key: rawKey,
      metadata: { ...metadata },
    };
  }

  async verifyKey(rawKey) {
    await this.ready;
    if (!rawKey) {
      return null;
    }

    const normalized = String(rawKey).trim();
    const hash = hashValue(normalized);
    const { rows } = await query(
      `SELECT id, name, environment, tenant_id AS tenantId, role, status, created_at AS createdAt, last_used_at AS lastUsedAt
       FROM api_keys
       WHERE hash = ? AND status = 'active'`,
      [hash]
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    await query('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
    await this.loadFromDisk();
    writeLegacyFile(Array.from(this.keys.values()).map(({ hash, ...entry }) => ({ ...entry })));

    return {
      id: row.id,
      name: row.name,
      environment: row.environment,
      tenantId: row.tenantId,
      role: row.role || 'admin',
      status: row.status,
    };
  }

  async listKeys() {
    await this.ready;
    return Array.from(this.keys.values()).map(({ hash, ...entry }) => ({ ...entry }));
  }

  async updateRole(keyId, role) {
    await this.ready;
    const normalizedRole = ['admin', 'viewer'].includes(String(role).toLowerCase()) ? String(role).toLowerCase() : 'admin';
    const existing = this.keys.get(keyId);
    if (!existing) {
      return null;
    }

    await query('UPDATE api_keys SET role = ? WHERE id = ?', [normalizedRole, keyId]);
    await this.loadFromDisk();
    writeLegacyFile(Array.from(this.keys.values()).map(({ hash, ...entry }) => ({ ...entry })));
    return { metadata: this.keys.get(keyId) };
  }

  async revokeKey(keyId) {
    await this.ready;
    const result = await query("UPDATE api_keys SET status = 'revoked' WHERE id = ?", [keyId]);
    await this.loadFromDisk();
    writeLegacyFile(Array.from(this.keys.values()).map(({ hash, ...entry }) => ({ ...entry })));
    return result.changes > 0;
  }
}

module.exports = new ApiKeyService();
