CREATE TABLE IF NOT EXISTS project_tools (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sensitivity TEXT NOT NULL DEFAULT 'READ' CHECK (sensitivity IN ('READ', 'WRITE', 'ADMIN')),
  permissions TEXT NOT NULL DEFAULT '[]',
  input_schema TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS project_tools_project_idx ON project_tools(project_id, status, created_at);
CREATE INDEX IF NOT EXISTS project_tools_name_idx ON project_tools(project_id, name);
