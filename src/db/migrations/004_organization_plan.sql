ALTER TABLE organizations ADD COLUMN plan_name TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE organizations ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'active';
