const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { config } = require('../config');

const dataDir = path.join(process.cwd(), 'data');
const dbFile = path.join(dataDir, 'identity_support.sqlite');
const isPostgres = Boolean(config.databaseUrl);

fs.mkdirSync(dataDir, { recursive: true });

const db = isPostgres ? null : new DatabaseSync(dbFile);

const schema = [
  `CREATE TABLE IF NOT EXISTS tenants (
    tenant_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_email TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    environment TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    hash TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    tenant_id TEXT,
    key_id TEXT,
    user_id TEXT,
    message TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  )`,
];

const readLegacyJson = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const migrateLegacyData = (querySync) => {
  const tenantCount = querySync('SELECT COUNT(*) AS count FROM tenants').rows[0].count;
  if (tenantCount === 0) {
    const legacyTenants = readLegacyJson(path.join(dataDir, 'tenants.json'));
    for (const tenant of legacyTenants) {
      if (tenant && tenant.tenantId) {
        const createdAt = tenant.createdAt || new Date().toISOString();
        querySync(
          'INSERT INTO tenants (tenant_id, name, owner_email, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tenant_id) DO NOTHING',
          [tenant.tenantId, tenant.name || tenant.tenantId, tenant.ownerEmail || null, tenant.status || 'active', createdAt]
        );
      }
    }
  }

  const keyCount = querySync('SELECT COUNT(*) AS count FROM api_keys').rows[0].count;
  if (keyCount === 0) {
    const legacyKeys = readLegacyJson(path.join(dataDir, 'api-keys.json'));
    for (const entry of legacyKeys) {
      if (entry && entry.id && entry.hash) {
        querySync(
          'INSERT INTO api_keys (id, name, environment, tenant_id, role, status, created_at, last_used_at, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
          [
          entry.id,
          entry.name || 'Developer App',
          entry.environment || 'test',
          entry.tenantId || 'default',
          entry.role || 'admin',
          entry.status || 'active',
          entry.createdAt || new Date().toISOString(),
          entry.lastUsedAt || null,
          entry.hash,
          ]
        );
      }
    }
  }

  const eventCount = querySync('SELECT COUNT(*) AS count FROM audit_events').rows[0].count;
  if (eventCount === 0) {
    const legacyEvents = readLegacyJson(path.join(dataDir, 'audit-events.json'));
    for (const event of legacyEvents) {
      if (event && event.id) {
        querySync(
          'INSERT INTO audit_events (id, type, tenant_id, key_id, user_id, message, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
          [
          event.id,
          event.type || 'event',
          event.tenantId || 'default',
          event.keyId || null,
          event.userId || null,
          event.message || '',
          JSON.stringify(event.metadata || {}),
          event.createdAt || new Date().toISOString(),
          ]
        );
      }
    }
  }
};

const querySync = (sql, params = []) => {
  const statement = db.prepare(sql);
  if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
    const rows = statement.all(...params);
    return { rows, rowCount: rows.length, changes: rows.length };
  }

  const result = statement.run(...params);
  return { rows: [], rowCount: result.changes, changes: result.changes };
};

if (!isPostgres) {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (const statement of schema) {
    db.exec(statement);
  }
  migrateLegacyData(querySync);
}

let pool;
const postgresQuery = async (sql, params = []) => {
  let parameterIndex = 0;
  const statement = sql.replace(/\?/g, () => `$${++parameterIndex}`);
  const result = await pool.query(statement, params);
  return { rows: result.rows, rowCount: result.rowCount, changes: result.rowCount };
};

const importSqliteRegistry = async () => {
  if (!fs.existsSync(dbFile)) {
    return;
  }

  const source = new DatabaseSync(dbFile);
  try {
    const tables = [
      ['tenants', ['tenant_id', 'name', 'owner_email', 'status', 'created_at']],
      ['api_keys', ['id', 'name', 'environment', 'tenant_id', 'role', 'status', 'created_at', 'last_used_at', 'hash']],
      ['audit_events', ['id', 'type', 'tenant_id', 'key_id', 'user_id', 'message', 'metadata', 'created_at']],
    ];

    for (const [table, columns] of tables) {
      const targetCount = await postgresQuery(`SELECT COUNT(*)::int AS count FROM ${table}`);
      if (targetCount.rows[0].count > 0) {
        continue;
      }

      const rows = source.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
      const placeholders = columns.map(() => '?').join(', ');
      for (const row of rows) {
        await postgresQuery(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          columns.map((column) => row[column])
        );
      }
    }
  } finally {
    source.close();
  }
};

const migrateLegacyDataPostgres = async () => {
  const tenantCount = await postgresQuery('SELECT COUNT(*)::int AS count FROM tenants');
  if (tenantCount.rows[0].count === 0) {
    for (const tenant of readLegacyJson(path.join(dataDir, 'tenants.json'))) {
      if (tenant?.tenantId) {
        await postgresQuery(
          'INSERT INTO tenants (tenant_id, name, owner_email, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tenant_id) DO NOTHING',
          [tenant.tenantId, tenant.name || tenant.tenantId, tenant.ownerEmail || null, tenant.status || 'active', tenant.createdAt || new Date().toISOString()]
        );
      }
    }
  }

  const eventCount = await postgresQuery('SELECT COUNT(*)::int AS count FROM audit_events');
  if (eventCount.rows[0].count === 0) {
    for (const event of readLegacyJson(path.join(dataDir, 'audit-events.json'))) {
      if (event?.id) {
        await postgresQuery(
          'INSERT INTO audit_events (id, type, tenant_id, key_id, user_id, message, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
          [event.id, event.type || 'event', event.tenantId || 'default', event.keyId || null, event.userId || null, event.message || '', JSON.stringify(event.metadata || {}), event.createdAt || new Date().toISOString()]
        );
      }
    }
  }
};

const initializePostgres = async () => {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

  for (const statement of schema) {
    await pool.query(statement);
  }

  await importSqliteRegistry();
  await migrateLegacyDataPostgres();
};

const ready = isPostgres ? initializePostgres() : Promise.resolve();

const query = async (sql, params = []) => {
  if (isPostgres) {
    await ready;
    return postgresQuery(sql, params);
  }

  return querySync(sql, params);
};

const close = async () => {
  if (pool) {
    await pool.end();
  }
};

module.exports = { db, dataDir, dbFile, isPostgres, query, ready, close };
