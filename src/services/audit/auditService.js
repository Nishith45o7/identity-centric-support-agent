const fs = require('fs');
const path = require('path');
const { isPostgres, query, ready } = require('../../db');

const legacyFile = path.join(process.cwd(), 'data', 'audit-events.json');

const writeLegacyFile = (entries) => {
  if (isPostgres) {
    return;
  }

  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, JSON.stringify(entries, null, 2), 'utf8');
};

class AuditService {
  constructor() {
    this.events = [];
    this.ready = ready.then(() => this.loadFromDisk());
  }

  async loadFromDisk() {
    const { rows } = await query(
      `SELECT id, type, tenant_id AS tenantId, key_id AS keyId, user_id AS userId, message, metadata, created_at AS createdAt
       FROM audit_events
       ORDER BY created_at ASC`
    );

    this.events = rows.map((event) => ({
      ...event,
      metadata: event.metadata ? JSON.parse(event.metadata) : {},
    }));

    writeLegacyFile(this.events);
  }

  async persist() {
    await this.loadFromDisk();
  }

  async record({ type, tenantId = 'default', keyId = null, userId = null, message = '', metadata = {} } = {}) {
    await this.ready;
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      type,
      tenantId,
      keyId,
      userId,
      message,
      metadata,
      createdAt: new Date().toISOString(),
    };

    await query(
      `INSERT INTO audit_events (id, type, tenant_id, key_id, user_id, message, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.type,
        event.tenantId,
        event.keyId,
        event.userId,
        event.message,
        JSON.stringify(event.metadata || {}),
        event.createdAt
      ]
    );

    await this.loadFromDisk();
    writeLegacyFile(this.events);
    return event;
  }

  async list(limit = 50) {
    await this.ready;
    return [...this.events].slice(-limit).reverse();
  }

  async getSummary() {
    await this.ready;
    const tenantCount = new Set(this.events.map((event) => event.tenantId).filter(Boolean)).size;
    const activeKeyCount = this.events.filter((event) => event.type === 'key.created').length;
    const revokedKeyCount = this.events.filter((event) => event.type === 'key.revoked').length;

    return {
      tenantCount: Math.max(tenantCount, 1),
      activeKeyCount,
      revokedKeyCount,
      eventCount: this.events.length,
      lastEventAt: this.events[this.events.length - 1]?.createdAt || null,
    };
  }
}

module.exports = new AuditService();
