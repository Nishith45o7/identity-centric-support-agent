const { query } = require('../../db');
const memoryService = require('../memory/hindsightMemoryService');
const projectToolService = require('../tool/projectToolService');

class ConversationExperienceEngine {
  /**
   * Resolves the customer's local time-of-day period
   * (morning: 5-11, afternoon: 12-16, evening: 17-21, night: 22-4)
   */
  resolveTimeContext(timezone) {
    let hour = new Date().getHours();
    if (timezone && typeof timezone === 'string') {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone.trim(),
          hour: 'numeric',
          hour12: false,
        });
        const parts = formatter.format(new Date());
        const parsedHour = parseInt(parts, 10);
        if (!isNaN(parsedHour)) {
          hour = parsedHour;
        }
      } catch {
        // Fallback to server local hour if invalid timezone
      }
    }

    if (hour >= 5 && hour < 12) return { period: 'morning', salutation: 'Good morning' };
    if (hour >= 12 && hour < 17) return { period: 'afternoon', salutation: 'Good afternoon' };
    if (hour >= 17 && hour < 22) return { period: 'evening', salutation: 'Good evening' };
    return { period: 'night', salutation: 'Hello' };
  }

  /**
   * Generates dynamic opening context, greeting, and suggested actions
   */
  async generateOpeningContext({
    userId,
    projectId,
    organizationId,
    environment = 'live',
    timezone = '',
    language = 'en',
    pageContext = {},
    customGreetingPolicy = 'friendly',
  }) {
    const normalizedUserId = String(userId || '').trim();
    const timeInfo = this.resolveTimeContext(timezone);

    // 1. Resolve Project and Business Info
    const { rows: projRows } = await query(
      `SELECT projects.id, projects.name, projects.organization_id, organizations.name AS orgName
       FROM projects
       JOIN organizations ON organizations.id = projects.organization_id
       WHERE projects.id = ?`,
      [projectId]
    );
    const project = projRows[0] || { name: 'Support', orgName: 'our team' };
    const businessName = project.name || project.orgName || 'Support';

    // 2. Resolve Customer Presence & History
    let customer = null;
    let previousConversations = [];
    let unresolvedConversation = null;

    if (normalizedUserId) {
      const { rows: custRows } = await query(
        `SELECT id, external_user_id, metadata, created_at, last_seen_at
         FROM customers WHERE project_id = ? AND external_user_id = ?`,
        [projectId, normalizedUserId]
      );
      customer = custRows[0] || null;

      if (customer) {
        const { rows: convRows } = await query(
          `SELECT id, status, resolution_status, escalation_reason, created_at, updated_at
           FROM conversations
           WHERE project_id = ? AND customer_id = ?
           ORDER BY updated_at DESC LIMIT 5`,
          [projectId, customer.id]
        );
        previousConversations = convRows || [];
        unresolvedConversation = previousConversations.find(
          (c) => c.status === 'open' || c.resolution_status === 'unresolved'
        );
      }
    }

    // 3. Recall Customer Facts from Memory
    let recalledFacts = [];
    if (normalizedUserId && organizationId) {
      try {
        const memorySnap = await memoryService.recall(
          normalizedUserId,
          '',
          organizationId,
          projectId,
          environment
        );
        recalledFacts = memorySnap.facts || [];
      } catch {
        recalledFacts = [];
      }
    }

    // Extract useful attributes from memory facts
    let customerName = '';
    let knownDevice = '';
    let knownIssue = '';

    for (const item of recalledFacts) {
      const category = String(item.category || '').toLowerCase();
      const fact = String(item.fact || '');
      if (category === 'name' || category === 'identity') {
        customerName = fact;
      } else if (category === 'device' || category === 'hardware') {
        knownDevice = fact;
      } else if (category === 'issue' || category === 'problem') {
        knownIssue = fact;
      }
    }

    // Check customer metadata for name
    if (!customerName && customer && customer.metadata) {
      try {
        const meta = typeof customer.metadata === 'string' ? JSON.parse(customer.metadata) : customer.metadata;
        customerName = meta.name || meta.fullName || meta.first_name || '';
      } catch {
        // ignore
      }
    }

    const isReturning = Boolean(customer && (previousConversations.length > 0 || recalledFacts.length > 0));
    const customerType = isReturning ? 'returning' : 'first_time';

    // 4. Determine Dynamic Greeting (Strict Hierarchy)
    let greeting = '';
    const displayName = customerName ? `, ${customerName}` : '';

    if (isReturning && (knownIssue || unresolvedConversation)) {
      const issueRef = knownIssue || unresolvedConversation?.escalation_reason || 'your previous issue';
      greeting = `Welcome back${displayName}! Are you still having trouble with ${issueRef}, or can I help with something new?`;
    } else if (isReturning && knownDevice) {
      greeting = `Welcome back${displayName}! How can I assist you with your ${knownDevice} today?`;
    } else if (isReturning) {
      greeting = `${timeInfo.salutation}${displayName}! Great to see you again at ${businessName}. How can I assist you today?`;
    } else {
      greeting = `${timeInfo.salutation}! Welcome to ${businessName} support. How can I help you today?`;
    }

    // 5. Build Dynamic Suggested Actions based on Tools & Context
    const suggestedActions = [];

    if (isReturning && (knownIssue || unresolvedConversation)) {
      suggestedActions.push({
        id: 'action_continue_issue',
        label: 'Continue previous issue',
        prompt: `I would like an update on my previous issue: ${knownIssue || 'unresolved issue'}.`,
      });
    }

    // Query active tools for this project
    try {
      const tools = await projectToolService.listProjectTools(projectId);
      for (const tool of tools) {
        if (tool.status !== 'active') continue;
        const name = tool.name.toLowerCase();
        if (name === 'track_order' || name === 'get_order') {
          suggestedActions.push({
            id: 'action_track_order',
            label: 'Track my order',
            prompt: 'Can you help me check the status of my order?',
          });
        } else if (name === 'send_password_reset') {
          suggestedActions.push({
            id: 'action_reset_password',
            label: 'Reset password',
            prompt: 'I forgot my password and need help resetting it.',
          });
        } else if (name === 'create_ticket') {
          suggestedActions.push({
            id: 'action_open_ticket',
            label: 'Contact human support',
            prompt: 'I would like to escalate my issue to a human support agent.',
          });
        }
      }
    } catch {
      // fallback suggestions if tools query fails
    }

    if (suggestedActions.length === 0) {
      suggestedActions.push(
        { id: 'action_troubleshoot', label: 'Troubleshoot an issue', prompt: 'I am running into a technical issue.' },
        { id: 'action_account', label: 'Account assistance', prompt: 'I need help with my account.' }
      );
    }

    return {
      customerType,
      timeContext: timeInfo.period,
      salutation: timeInfo.salutation,
      greeting,
      customerName: customerName || null,
      suggestedActions: suggestedActions.slice(0, 4),
      contextSummary: {
        hasMemory: recalledFacts.length > 0,
        unresolvedIssue: Boolean(knownIssue || unresolvedConversation),
        knownDevice: knownDevice || null,
        conversationsCount: previousConversations.length,
      },
    };
  }
}

module.exports = new ConversationExperienceEngine();
