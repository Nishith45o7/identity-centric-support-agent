const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { config } = require('../config');

const dataDir = path.join(process.cwd(), 'data');
const dbFile = path.join(dataDir, 'identity_support.sqlite');
const migrationsDir = path.join(__dirname, 'migrations');
const isPostgres = Boolean(config.databaseUrl);

fs.mkdirSync(dataDir, { recursive: true });

const db = isPostgres ? null : new DatabaseSync(dbFile);
let pool;

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

const getMigrations = () => fs.readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({ version: file, sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8') }));

const runSqliteMigrations = () => {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');

  for (const migration of getMigrations()) {
    const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
    if (applied) {
      continue;
    }

    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }
};

if (!isPostgres) {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (const statement of schema) {
    db.exec(statement);
  }
  runSqliteMigrations();
  migrateLegacyData(querySync);
}

const prepareSqlForPostgres = (sql) => {
  let prepared = sql;
  prepared = prepared.replace(/\bAS\s+([A-Za-z0-9_]+)/g, (match, alias) => `AS "${alias}"`);
  prepared = prepared.replace(/\b(excluded\.)?position\b(?!\s*\()/gi, (match, prefix) => {
    return prefix ? 'EXCLUDED."position"' : '"position"';
  });
  return prepared;
};

const replacePlaceholders = (sql) => {
  let parameterIndex = 0;
  return sql.replace(/'(?:''|[^'])*'|\?/g, (match) => {
    if (match === '?') {
      return `$${++parameterIndex}`;
    }
    return match;
  });
};

const postgresQuery = async (sql, params = [], executor = pool) => {
  const preparedSql = prepareSqlForPostgres(sql);
  const statement = replacePlaceholders(preparedSql);
  const result = await executor.query(statement, params);
  const rows = result.rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const mapped = { ...row };
    for (const [key, value] of Object.entries(row)) {
      const camel = key.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
      if (!(camel in mapped)) {
        mapped[camel] = value;
      }
    }
    return mapped;
  });
  return { rows, rowCount: result.rowCount, changes: result.rowCount };
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

const formatPostgresMigration = (version, sql) => {
  if (version === '007_contextis_foundation.sql') {
    return `
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_name TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS organizations_slug_idx ON organizations(slug);

ALTER TABLE organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer'));
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members(user_id, organization_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'live';
CREATE INDEX IF NOT EXISTS projects_env_idx ON projects(organization_id, environment, status);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'live';
CREATE INDEX IF NOT EXISTS customers_project_env_idx ON customers(project_id, environment, external_user_id);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'live';
CREATE INDEX IF NOT EXISTS conversations_project_env_idx ON conversations(project_id, environment, customer_id);

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS request_id TEXT;

ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'live';
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS ai_requests INTEGER NOT NULL DEFAULT 1;
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS tool_executions INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS usage_records_org_env_idx ON usage_records(organization_id, environment, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  max_projects INTEGER NOT NULL,
  max_api_keys INTEGER NOT NULL,
  max_customers INTEGER NOT NULL,
  monthly_requests INTEGER NOT NULL,
  memory_operations INTEGER NOT NULL,
  tool_executions INTEGER NOT NULL,
  team_members INTEGER NOT NULL,
  rate_limit_per_minute INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

INSERT INTO plans (id, name, slug, max_projects, max_api_keys, max_customers, monthly_requests, memory_operations, tool_executions, team_members, rate_limit_per_minute, is_active, created_at)
VALUES
  ('plan_free', 'Free', 'free', 1, 2, 50, 1000, 500, 200, 1, 30, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_starter', 'Starter', 'starter', 3, 5, 250, 10000, 5000, 2000, 3, 60, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_pro', 'Pro', 'pro', 10, 20, 2500, 50000, 25000, 10000, 10, 180, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_growth', 'Growth', 'growth', 10, 20, 5000, 100000, 50000, 20000, 10, 300, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_scale', 'Scale', 'scale', 50, 100, 50000, 1000000, 500000, 200000, 50, 1200, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_business', 'Business', 'business', 50, 100, 50000, 500000, 250000, 100000, 30, 600, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_enterprise', 'Enterprise', 'enterprise', 9999, 9999, 999999, 10000000, 5000000, 2000000, 999, 5000, 1, '2026-01-01T00:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id)
);
CREATE INDEX IF NOT EXISTS subscriptions_org_status_idx ON subscriptions(organization_id, status);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS integrations_project_status_idx ON integrations(project_id, status);
`;
  }

  return sql.replace(/ADD COLUMN (?!IF NOT EXISTS)/g, 'ADD COLUMN IF NOT EXISTS ');
};

const runPostgresMigrations = async () => {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');

  for (const migration of getMigrations()) {
    const applied = await pool.query('SELECT version FROM schema_migrations WHERE version = $1', [migration.version]);
    if (applied.rowCount > 0) {
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sqlToExecute = formatPostgresMigration(migration.version, migration.sql);
      await client.query(sqlToExecute);
      await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [migration.version, new Date().toISOString()]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

const initializePostgres = async () => {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

  for (const statement of schema) {
    await pool.query(statement);
  }

  await runPostgresMigrations();
  await importSqliteRegistry();
  await migrateLegacyDataPostgres();
};

let ready = isPostgres ? initializePostgres() : Promise.resolve();

const ensureReady = async () => {
  if (isPostgres && !pool) {
    ready = initializePostgres();
  }
  await ready;
};

const query = async (sql, params = []) => {
  if (isPostgres) {
    await ensureReady();
    return postgresQuery(sql, params);
  }

  return querySync(sql, params);
};

const transaction = async (operation) => {
  await ensureReady();
  if (!isPostgres) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = await operation(async (sql, params = []) => querySync(sql, params));
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation((sql, params = []) => postgresQuery(sql, params, client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const close = async () => {
  if (pool) {
    const activePool = pool;
    pool = null;
    await activePool.end();
  }
};

const migrate = async () => {
  await ready;
};

module.exports = { db, dataDir, dbFile, isPostgres, query, transaction, ready, close, migrate };
