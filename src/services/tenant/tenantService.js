const fs = require('fs');
const path = require('path');
const { isPostgres, query, ready } = require('../../db');

const legacyFile = path.join(process.cwd(), 'data', 'tenants.json');

const writeLegacyFile = (entries) => {
  if (isPostgres) {
    return;
  }

  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, JSON.stringify(entries, null, 2), 'utf8');
};

class TenantService {
  constructor() {
    this.tenants = new Map();
    this.ready = ready.then(() => this.loadFromDisk());
  }

  async loadFromDisk() {
    this.tenants.clear();
    const { rows } = await query(
      `SELECT tenant_id AS tenantId, name, owner_email AS ownerEmail, status, created_at AS createdAt
       FROM tenants
       ORDER BY created_at ASC`
    );

    for (const tenant of rows) {
      this.tenants.set(tenant.tenantId, tenant);
    }

    writeLegacyFile(Array.from(this.tenants.values()));
  }

  async persist() {
    await this.loadFromDisk();
  }

  normalizeTenantId(tenantId) {
    const value = String(tenantId || 'default').trim();
    return value || 'default';
  }

  async createTenant({ tenantId, name, ownerEmail } = {}) {
    await this.ready;
    const normalizedTenantId = this.normalizeTenantId(tenantId);
    const tenant = {
      tenantId: normalizedTenantId,
      name: String(name || normalizedTenantId).trim() || normalizedTenantId,
      ownerEmail: ownerEmail ? String(ownerEmail).trim() : null,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    await query(
      `INSERT INTO tenants (tenant_id, name, owner_email, status, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         name = excluded.name,
         owner_email = excluded.owner_email,
         status = excluded.status,
        created_at = excluded.created_at`,
      [
        tenant.tenantId,
        tenant.name,
        tenant.ownerEmail,
        tenant.status,
        tenant.createdAt
      ]
    );

    await this.loadFromDisk();
    writeLegacyFile(Array.from(this.tenants.values()));
    return { tenant };
  }

  async ensureTenant({ tenantId, name, ownerEmail } = {}) {
    await this.ready;
    const normalizedTenantId = this.normalizeTenantId(tenantId);
    if (this.tenants.has(normalizedTenantId)) {
      return { tenant: this.tenants.get(normalizedTenantId) };
    }

    return this.createTenant({ tenantId: normalizedTenantId, name, ownerEmail });
  }

  async getTenant(tenantId) {
    await this.ready;
    const normalizedTenantId = this.normalizeTenantId(tenantId);
    return this.tenants.get(normalizedTenantId) || null;
  }

  async updateTenant({ tenantId, name, ownerEmail, status } = {}) {
    await this.ready;
    const normalizedTenantId = this.normalizeTenantId(tenantId);
    const existing = this.tenants.get(normalizedTenantId);
    if (!existing) {
      return null;
    }

    const payload = {
      tenantId: normalizedTenantId,
      name: name ? String(name).trim() || normalizedTenantId : existing.name,
      ownerEmail: ownerEmail !== undefined ? (String(ownerEmail).trim() || null) : existing.ownerEmail,
      status: status ? String(status).trim() : existing.status,
    };

    await query(
      `UPDATE tenants
       SET name = ?, owner_email = ?, status = ?
       WHERE tenant_id = ?`,
      [payload.name, payload.ownerEmail, payload.status, normalizedTenantId]
    );

    await this.loadFromDisk();
    writeLegacyFile(Array.from(this.tenants.values()));
    return { tenant: this.tenants.get(normalizedTenantId) };
  }

  async listTenants() {
    await this.ready;
    return Array.from(this.tenants.values());
  }
}

module.exports = new TenantService();
