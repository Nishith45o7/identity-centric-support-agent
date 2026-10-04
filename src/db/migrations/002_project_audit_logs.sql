CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  api_key_id TEXT REFERENCES project_api_keys(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_project_created_idx ON audit_logs(project_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_organization_created_idx ON audit_logs(organization_id, created_at);