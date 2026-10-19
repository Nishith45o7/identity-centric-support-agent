const crypto = require('crypto');
const { query } = require('../../db');

class FeedbackService {
  async recordFeedback({
    projectId,
    conversationId,
    messageId,
    customerId,
    requestId,
    rating,
    reason,
    comment,
  }) {
    const normalizedRating = String(rating || '').toLowerCase().trim();
    if (!['positive', 'negative'].includes(normalizedRating)) {
      const error = new Error("Rating must be 'positive' or 'negative'.");
      error.code = 'INVALID_REQUEST';
      error.statusCode = 400;
      throw error;
    }

    const feedbackId = `fbk_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();

    await query(
      `INSERT INTO message_feedback (id, project_id, conversation_id, message_id, customer_id, request_id, rating, reason, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        feedbackId,
        projectId,
        conversationId,
        messageId || null,
        customerId || null,
        requestId || null,
        normalizedRating,
        reason || null,
        comment || null,
        now,
      ]
    );

    // Dispatch Webhook Event (Non-blocking)
    try {
      const webhookService = require('../webhook/webhookService');
      webhookService.dispatch({
        projectId,
        event: 'feedback.created',
        data: {
          feedbackId,
          conversationId,
          customerId,
          rating: normalizedRating,
          reason,
        },
      }).catch(() => {});
    } catch {
      // safe fallback
    }

    return {
      id: feedbackId,
      projectId,
      conversationId,
      rating: normalizedRating,
      reason,
      createdAt: now,
    };
  }

  async getFeedbackSummary(projectId) {
    const { rows } = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN rating = 'positive' THEN 1 ELSE 0 END) AS positive,
         SUM(CASE WHEN rating = 'negative' THEN 1 ELSE 0 END) AS negative
       FROM message_feedback WHERE project_id = ?`,
      [projectId]
    );

    const total = Number(rows[0]?.total || 0);
    const positive = Number(rows[0]?.positive || 0);
    const negative = Number(rows[0]?.negative || 0);
    const satisfactionRate = total > 0 ? Math.round((positive / total) * 100) : 100;

    const reasons = await query(
      `SELECT reason, COUNT(*) AS count
       FROM message_feedback
       WHERE project_id = ? AND rating = 'negative' AND reason IS NOT NULL
       GROUP BY reason ORDER BY count DESC LIMIT 5`,
      [projectId]
    );

    return {
      total,
      positive,
      negative,
      satisfactionRate,
      topNegativeReasons: reasons.rows || [],
    };
  }
}

module.exports = new FeedbackService();
