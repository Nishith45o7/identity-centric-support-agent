-- Migration 008: Contextis Phase 9-12 Growth, Intelligence, Feedback, Webhooks & Escalation

-- 1. Conversation Escalation and Resolution Metadata
ALTER TABLE conversations ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'unresolved';
ALTER TABLE conversations ADD COLUMN escalation_reason TEXT;
ALTER TABLE conversations ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
CREATE INDEX IF NOT EXISTS conversations_status_idx ON conversations(project_id, status);

-- 2. Message Feedback Table
CREATE TABLE IF NOT EXISTS message_feedback (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT,
  customer_id TEXT,
  request_id TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  reason TEXT,
  comment TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_feedback_project_idx ON message_feedback(project_id, rating, created_at);

-- 3. Human Handoff / Escalations Table
CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  context_summary TEXT NOT NULL,
  actions_attempted TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'created', 'assigned', 'in_progress', 'waiting', 'resolved', 'cancelled')),
  assigned_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS escalations_project_status_idx ON escalations(project_id, status, created_at);

-- 4. Outbound Webhooks Configuration Table
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["conversation.created","conversation.resolved","conversation.escalated"]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webhooks_project_idx ON webhooks(project_id, status);

-- 5. Webhook Deliveries Table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('delivered', 'failed')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_idx ON webhook_deliveries(webhook_id, created_at);

-- 6. Widget Analytics Events Table
CREATE TABLE IF NOT EXISTS widget_analytics_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  session_id TEXT,
  customer_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS widget_analytics_project_idx ON widget_analytics_events(project_id, event_type, created_at);
