-- Migration 006: Contextis Platform Expansion
-- Adds conversation messages, widget configuration, public keys support, and platform administration.

ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system', 'tool')),
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS widget_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL DEFAULT 'Contextis Support',
  welcome_message TEXT NOT NULL DEFAULT 'Hi! How can we help you today?',
  accent_color TEXT NOT NULL DEFAULT '#38bdf8',
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('light', 'dark', 'auto')),
  position TEXT NOT NULL DEFAULT 'bottom-right' CHECK (position IN ('bottom-right', 'bottom-left')),
  placeholder TEXT NOT NULL DEFAULT 'Type your message...',
  allowed_domains TEXT NOT NULL DEFAULT '*',
  updated_at TEXT NOT NULL
);

ALTER TABLE project_api_keys ADD COLUMN key_type TEXT NOT NULL DEFAULT 'secret' CHECK (key_type IN ('secret', 'public'));
ALTER TABLE project_api_keys ADD COLUMN scopes TEXT NOT NULL DEFAULT '["support:read","support:write","memory:read"]';

CREATE INDEX IF NOT EXISTS conversation_messages_conv_idx ON conversation_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS conversation_messages_project_idx ON conversation_messages(project_id, created_at);
CREATE INDEX IF NOT EXISTS project_api_keys_type_idx ON project_api_keys(project_id, key_type, environment, status);
