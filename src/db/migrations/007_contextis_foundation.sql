-- Migration 007: Contextis Phase 1 Core Foundation
-- Upgrades multi-tenancy, environment isolation, plan limits, subscriptions, and integrations.

-- 1. Rebuild organizations to support slug, updated_at, and status in ('active', 'suspended', 'deleted')
CREATE TABLE IF NOT EXISTS organizations_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  plan_name TEXT NOT NULL DEFAULT 'starter',
  billing_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO organizations_v2 (id, name, slug, owner_user_id, status, plan_name, billing_status, created_at, updated_at)
  SELECT id, name, LOWER(REPLACE(REPLACE(name, ' ', '-'), '''', '')), owner_user_id, status, plan_name, billing_status, created_at, created_at FROM organizations;

DROP TABLE organizations;
ALTER TABLE organizations_v2 RENAME TO organizations;
CREATE INDEX IF NOT EXISTS organizations_slug_idx ON organizations(slug);

-- 2. Rebuild organization_members to support viewer role in addition to owner, admin, member
CREATE TABLE IF NOT EXISTS organization_members_v2 (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

INSERT OR IGNORE INTO organization_members_v2 SELECT organization_id, user_id, role, created_at FROM organization_members;
DROP TABLE organization_members;
ALTER TABLE organization_members_v2 RENAME TO organization_members;
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members(user_id, organization_id);

-- 3. Projects environment and slug
ALTER TABLE projects ADD COLUMN slug TEXT;
ALTER TABLE projects ADD COLUMN environment TEXT NOT NULL DEFAULT 'live';
CREATE INDEX IF NOT EXISTS projects_env_idx ON projects(organization_id, environment, status);

-- 4. Environment separation for customers and conversations
ALTER TABLE customers ADD COLUMN environment TEXT NOT NULL DEFAULT 'live';
CREATE INDEX IF NOT EXISTS customers_project_env_idx ON customers(project_id, environment, external_user_id);

ALTER TABLE conversations ADD COLUMN environment TEXT NOT NULL DEFAULT 'live';
CREATE INDEX IF NOT EXISTS conversations_project_env_idx ON conversations(project_id, environment, customer_id);

-- 5. Message request tracking
ALTER TABLE conversation_messages ADD COLUMN request_id TEXT;

-- 6. Usage records enriched dimensions
ALTER TABLE usage_records ADD COLUMN organization_id TEXT;
ALTER TABLE usage_records ADD COLUMN environment TEXT NOT NULL DEFAULT 'live';
ALTER TABLE usage_records ADD COLUMN ai_requests INTEGER NOT NULL DEFAULT 1;
ALTER TABLE usage_records ADD COLUMN tool_executions INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS usage_records_org_env_idx ON usage_records(organization_id, environment, created_at);

-- 7. Plans table
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

INSERT OR IGNORE INTO plans (id, name, slug, max_projects, max_api_keys, max_customers, monthly_requests, memory_operations, tool_executions, team_members, rate_limit_per_minute, is_active, created_at)
VALUES
  ('plan_free', 'Free', 'free', 1, 2, 50, 1000, 500, 200, 1, 30, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_starter', 'Starter', 'starter', 3, 5, 250, 10000, 5000, 2000, 3, 60, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_pro', 'Pro', 'pro', 10, 20, 2500, 50000, 25000, 10000, 10, 180, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_growth', 'Growth', 'growth', 10, 20, 5000, 100000, 50000, 20000, 10, 300, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_scale', 'Scale', 'scale', 50, 100, 50000, 1000000, 500000, 200000, 50, 1200, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_business', 'Business', 'business', 50, 100, 50000, 500000, 250000, 100000, 30, 600, 1, '2026-01-01T00:00:00.000Z'),
  ('plan_enterprise', 'Enterprise', 'enterprise', 9999, 9999, 999999, 10000000, 5000000, 2000000, 999, 5000, 1, '2026-01-01T00:00:00.000Z');

-- 8. Subscriptions table
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

-- 9. Integrations table
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
