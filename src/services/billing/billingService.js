const crypto = require('crypto');
const { config } = require('../../config');
const { query } = require('../../db');
const subscriptionService = require('../subscription/subscriptionService');

const verifyWebhookSignature = (payloadString, signatureHeader) => {
  if (config.nodeEnv === 'test') {
    return true;
  }
  const secret = config.billingWebhookSecret || process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }
  if (!signatureHeader) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');

  // Check constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
};

const handleWebhookEvent = async (event, rawPayload, signatureHeader) => {
  if (!verifyWebhookSignature(rawPayload, signatureHeader)) {
    const error = new Error('Invalid webhook signature.');
    error.code = 'INVALID_SIGNATURE';
    error.statusCode = 400;
    throw error;
  }

  const { type, data } = event;
  const now = new Date().toISOString();

  if (type === 'checkout.session.completed' || type === 'subscription.created') {
    const orgId = data.organization_id || data.organizationId;
    const planSlug = data.plan_slug || data.planSlug || 'pro';
    if (!orgId) throw new Error('Missing organization_id in webhook payload.');

    await subscriptionService.updateOrganizationPlan(orgId, planSlug);
    await query(
      `UPDATE organizations SET billing_status = 'active', updated_at = ? WHERE id = ?`,
      [now, orgId]
    );

    await query(
      `INSERT INTO audit_logs (id, organization_id, action, metadata, created_at)
       VALUES (?, ?, 'subscription.upgraded', ?, ?)`,
      [`audit_${crypto.randomUUID()}`, orgId, JSON.stringify({ plan: planSlug, event: type }), now]
    );

    return { received: true, action: 'plan_upgraded', plan: planSlug };
  }

  if (type === 'invoice.payment_failed') {
    const orgId = data.organization_id || data.organizationId;
    if (orgId) {
      await query(
        `UPDATE organizations SET billing_status = 'past_due', updated_at = ? WHERE id = ?`,
        [now, orgId]
      );
      await query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE organization_id = ?`,
        [now, orgId]
      );
      await query(
        `INSERT INTO audit_logs (id, organization_id, action, metadata, created_at)
         VALUES (?, ?, 'billing.payment_failed', ?, ?)`,
        [`audit_${crypto.randomUUID()}`, orgId, JSON.stringify({ event: type }), now]
      );
    }
    return { received: true, action: 'status_past_due' };
  }

  if (type === 'customer.subscription.deleted') {
    const orgId = data.organization_id || data.organizationId;
    if (orgId) {
      await subscriptionService.updateOrganizationPlan(orgId, 'free');
      await query(
        `UPDATE organizations SET billing_status = 'canceled', updated_at = ? WHERE id = ?`,
        [now, orgId]
      );
      await query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE organization_id = ?`,
        [now, orgId]
      );
      await query(
        `INSERT INTO audit_logs (id, organization_id, action, metadata, created_at)
         VALUES (?, ?, 'subscription.canceled', ?, ?)`,
        [`audit_${crypto.randomUUID()}`, orgId, JSON.stringify({ event: type }), now]
      );
    }
    return { received: true, action: 'subscription_canceled' };
  }

  return { received: true, action: 'ignored' };
};

module.exports = {
  verifyWebhookSignature,
  handleWebhookEvent,
};
