const crypto = require('crypto');
const { query } = require('../../db');

class WebhookService {
  /**
   * Generates HMAC-SHA256 signature for webhook payload
   */
  signPayload(payloadString, secret) {
    const hmac = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
    return `sha256=${hmac}`;
  }

  /**
   * Creates a new webhook endpoint for a project
   */
  async createWebhook({ projectId, name, url, events = ['conversation.created', 'conversation.resolved', 'conversation.escalated'] }) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      const error = new Error('A valid HTTPS/HTTP webhook URL is required.');
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }

    const webhookId = `whk_${crypto.randomUUID().replace(/-/g, '')}`;
    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
    const now = new Date().toISOString();
    const normalizedEvents = Array.isArray(events) ? JSON.stringify(events) : JSON.stringify([events]);

    await query(
      `INSERT INTO webhooks (id, project_id, name, url, secret, events, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [webhookId, projectId, name || 'Production Webhook', url.trim(), secret, normalizedEvents, now, now]
    );

    return {
      id: webhookId,
      projectId,
      name: name || 'Production Webhook',
      url: url.trim(),
      secret, // Reveal secret once upon creation
      events: JSON.parse(normalizedEvents),
      status: 'active',
      createdAt: now,
    };
  }

  /**
   * Lists webhooks for a project (masking secrets)
   */
  async listWebhooks(projectId) {
    const { rows } = await query(
      `SELECT id, project_id AS projectId, name, url, events, status, created_at AS createdAt, updated_at AS updatedAt
       FROM webhooks WHERE project_id = ? ORDER BY created_at DESC`,
      [projectId]
    );

    return (rows || []).map((w) => ({
      ...w,
      events: typeof w.events === 'string' ? JSON.parse(w.events) : w.events,
    }));
  }

  /**
   * Deletes a webhook endpoint
   */
  async deleteWebhook(projectId, webhookId) {
    const { changes } = await query(
      `DELETE FROM webhooks WHERE id = ? AND project_id = ?`,
      [webhookId, projectId]
    );
    return changes > 0;
  }

  /**
   * Dispatches an event payload to all subscribed webhooks for a project
   */
  async dispatch({ projectId, event, data = {} }) {
    const { rows: webhooks } = await query(
      `SELECT id, url, secret, events FROM webhooks WHERE project_id = ? AND status = 'active'`,
      [projectId]
    );

    if (!webhooks || webhooks.length === 0) {
      return { dispatched: 0 };
    }

    const matchingWebhooks = webhooks.filter((w) => {
      try {
        const eventsList = typeof w.events === 'string' ? JSON.parse(w.events) : w.events;
        return Array.isArray(eventsList) && (eventsList.includes(event) || eventsList.includes('*'));
      } catch {
        return false;
      }
    });

    const now = new Date().toISOString();
    const payloadObject = {
      id: `evt_${crypto.randomUUID().replace(/-/g, '')}`,
      event,
      timestamp: now,
      data,
    };
    const payloadString = JSON.stringify(payloadObject);

    const deliveryPromises = matchingWebhooks.map(async (webhook) => {
      const deliveryId = `del_${crypto.randomUUID().replace(/-/g, '')}`;
      const signature = this.signPayload(payloadString, webhook.secret);
      let statusCode = null;
      let responseBody = null;
      let status = 'failed';

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Contextis-Signature': signature,
            'X-Contextis-Event': event,
            'User-Agent': 'Contextis-Webhooks/1.0',
          },
          body: payloadString,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        statusCode = res.status;
        status = res.ok ? 'delivered' : 'failed';
        responseBody = await res.text().catch(() => '');
      } catch (err) {
        status = 'failed';
        responseBody = err.message;
      }

      await query(
        `INSERT INTO webhook_deliveries (id, webhook_id, project_id, event, payload, status_code, response_body, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          deliveryId,
          webhook.id,
          projectId,
          event,
          payloadString,
          statusCode,
          responseBody ? String(responseBody).slice(0, 1000) : null,
          status,
          now,
        ]
      );

      return { deliveryId, webhookId: webhook.id, status, statusCode };
    });

    const results = await Promise.allSettled(deliveryPromises);
    return {
      dispatched: matchingWebhooks.length,
      deliveries: results.map((r) => (r.status === 'fulfilled' ? r.value : { status: 'rejected' })),
    };
  }
}

module.exports = new WebhookService();
