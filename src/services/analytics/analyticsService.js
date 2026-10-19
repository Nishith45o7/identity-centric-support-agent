const { query } = require('../../db');

class AnalyticsService {
  /**
   * Resolves the start date for a time window filter
   */
  resolveRangeCutoff(range = '7d') {
    const now = new Date();
    switch (range) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      case '30d':
        return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      case '90d':
        return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      case '7d':
      default:
        return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  /**
   * Computes comprehensive AI support metrics for a project
   */
  async getProjectAnalytics(projectId, { range = '7d' } = {}) {
    const cutoff = this.resolveRangeCutoff(range);

    // 1. Conversations & Resolution Metrics
    const { rows: convRows } = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'resolved' OR resolution_status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
         SUM(CASE WHEN status = 'escalated' OR resolution_status = 'escalated' THEN 1 ELSE 0 END) AS escalated
       FROM conversations
       WHERE project_id = ? AND created_at >= ?`,
      [projectId, cutoff]
    );

    const totalConversations = Number(convRows[0]?.total || 0);
    const activeConversations = Number(convRows[0]?.active || 0);
    const resolvedConversations = Number(convRows[0]?.resolved || 0);
    const escalatedConversations = Number(convRows[0]?.escalated || 0);

    const resolutionRate = totalConversations > 0
      ? Math.round((resolvedConversations / totalConversations) * 100)
      : 100;

    const escalationRate = totalConversations > 0
      ? Math.round((escalatedConversations / totalConversations) * 100)
      : 0;

    // 2. Feedback & Satisfaction
    const { rows: feedbackRows } = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN rating = 'positive' THEN 1 ELSE 0 END) AS positive,
         SUM(CASE WHEN rating = 'negative' THEN 1 ELSE 0 END) AS negative
       FROM message_feedback
       WHERE project_id = ? AND created_at >= ?`,
      [projectId, cutoff]
    );

    const totalFeedback = Number(feedbackRows[0]?.total || 0);
    const positiveFeedback = Number(feedbackRows[0]?.positive || 0);
    const satisfactionRate = totalFeedback > 0
      ? Math.round((positiveFeedback / totalFeedback) * 100)
      : 100;

    // 3. Usage, API Requests, Latency, and Tool Executions
    const { rows: usageRows } = await query(
      `SELECT
         COUNT(*) AS totalRequests,
         COALESCE(AVG(duration_ms), 0) AS avgDuration,
         COALESCE(SUM(tool_executions), 0) AS toolExecutions,
         COALESCE(SUM(memory_operations), 0) AS memoryOperations
       FROM usage_records
       WHERE project_id = ? AND created_at >= ?`,
      [projectId, cutoff]
    );

    const totalRequests = Number(usageRows[0]?.totalRequests || 0);
    const avgLatencyMs = Math.round(Number(usageRows[0]?.avgDuration || 0));
    const toolExecutions = Number(usageRows[0]?.toolExecutions || 0);
    const memoryOperations = Number(usageRows[0]?.memoryOperations || 0);

    // 4. Escalations Breakdown
    const { rows: escRows } = await query(
      `SELECT status, COUNT(*) AS count
       FROM escalations
       WHERE project_id = ? AND created_at >= ?
       GROUP BY status`,
      [projectId, cutoff]
    );

    const escalationsByStatus = {};
    for (const row of escRows) {
      escalationsByStatus[row.status] = Number(row.count || 0);
    }

    return {
      projectId,
      range,
      overview: {
        totalConversations,
        activeConversations,
        resolvedConversations,
        escalatedConversations,
        resolutionRate,
        escalationRate,
        satisfactionRate,
        totalFeedback,
        totalRequests,
        avgLatencyMs,
        toolExecutions,
        memoryOperations,
      },
      escalations: escalationsByStatus,
    };
  }
}

module.exports = new AnalyticsService();
