const { query } = require('../../db');

const PLAN_FALLBACKS = {
  free: {
    id: 'plan_free',
    name: 'Free',
    slug: 'free',
    maxProjects: 1,
    maxApiKeys: 2,
    maxCustomers: 50,
    monthlyRequests: 1000,
    memoryOperations: 500,
    toolExecutions: 200,
    teamMembers: 1,
    rateLimitPerMinute: 30,
  },
  starter: {
    id: 'plan_starter',
    name: 'Starter',
    slug: 'starter',
    maxProjects: 3,
    maxApiKeys: 5,
    maxCustomers: 250,
    monthlyRequests: 10000,
    memoryOperations: 5000,
    toolExecutions: 2000,
    teamMembers: 3,
    rateLimitPerMinute: 60,
  },
  pro: {
    id: 'plan_pro',
    name: 'Pro',
    slug: 'pro',
    maxProjects: 10,
    maxApiKeys: 20,
    maxCustomers: 2500,
    monthlyRequests: 50000,
    memoryOperations: 25000,
    toolExecutions: 10000,
    teamMembers: 10,
    rateLimitPerMinute: 180,
  },
  growth: {
    id: 'plan_growth',
    name: 'Growth',
    slug: 'growth',
    maxProjects: 10,
    maxApiKeys: 20,
    maxCustomers: 5000,
    monthlyRequests: 100000,
    memoryOperations: 50000,
    toolExecutions: 20000,
    teamMembers: 10,
    rateLimitPerMinute: 300,
  },
  scale: {
    id: 'plan_scale',
    name: 'Scale',
    slug: 'scale',
    maxProjects: 50,
    maxApiKeys: 100,
    maxCustomers: 50000,
    monthlyRequests: 1000000,
    memoryOperations: 500000,
    toolExecutions: 200000,
    teamMembers: 50,
    rateLimitPerMinute: 1200,
  },
  business: {
    id: 'plan_business',
    name: 'Business',
    slug: 'business',
    maxProjects: 50,
    maxApiKeys: 100,
    maxCustomers: 50000,
    monthlyRequests: 500000,
    memoryOperations: 250000,
    toolExecutions: 100000,
    teamMembers: 30,
    rateLimitPerMinute: 600,
  },
  enterprise: {
    id: 'plan_enterprise',
    name: 'Enterprise',
    slug: 'enterprise',
    maxProjects: 9999,
    maxApiKeys: 9999,
    maxCustomers: 999999,
    monthlyRequests: 10000000,
    memoryOperations: 5000000,
    toolExecutions: 2000000,
    teamMembers: 999,
    rateLimitPerMinute: 5000,
  },
};

const mapPlanRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    maxProjects: Number(row.max_projects || row.maxProjects || 1),
    maxApiKeys: Number(row.max_api_keys || row.maxApiKeys || 2),
    maxCustomers: Number(row.max_customers || row.maxCustomers || 100),
    monthlyRequests: Number(row.monthly_requests || row.monthlyRequests || 10000),
    memoryOperations: Number(row.memory_operations || row.memoryOperations || 5000),
    toolExecutions: Number(row.tool_executions || row.toolExecutions || 2000),
    teamMembers: Number(row.team_members || row.teamMembers || 3),
    rateLimitPerMinute: Number(row.rate_limit_per_minute || row.rateLimitPerMinute || 60),
    isActive: Boolean(row.is_active ?? 1),
  };
};

const listPublicPlans = async () => {
  let dbPlans = [];
  try {
    const { rows } = await query(
      `SELECT * FROM plans WHERE is_active = 1 ORDER BY monthly_requests ASC`
    );
    if (rows && rows.length > 0) {
      dbPlans = rows.map(mapPlanRow);
    }
  } catch {
    // fallback to static plan definitions
  }

  const baseList = dbPlans.length > 0
    ? dbPlans
    : [PLAN_FALLBACKS.free, PLAN_FALLBACKS.starter, PLAN_FALLBACKS.pro, PLAN_FALLBACKS.business, PLAN_FALLBACKS.enterprise];

  const pricingTable = {
    free: { price: 0, priceDisplay: '$0', period: 'forever', highlighted: false, cta: 'Start Free' },
    starter: { price: 29, priceDisplay: '$29', period: 'month', highlighted: false, cta: 'Get Started' },
    pro: { price: 79, priceDisplay: '$79', period: 'month', highlighted: true, cta: 'Start Pro Trial' },
    growth: { price: 149, priceDisplay: '$149', period: 'month', highlighted: false, cta: 'Upgrade to Growth' },
    business: { price: 299, priceDisplay: '$299', period: 'month', highlighted: false, cta: 'Contact Sales' },
    enterprise: { price: null, priceDisplay: 'Custom', period: 'annual', highlighted: false, cta: 'Talk to Enterprise' },
  };

  return baseList.map((plan) => {
    const priceMeta = pricingTable[plan.slug] || { price: 0, priceDisplay: '$0', period: 'month', highlighted: false, cta: 'Get Started' };
    return {
      ...plan,
      ...priceMeta,
      features: [
        `${plan.monthlyRequests.toLocaleString()} monthly AI requests`,
        `${plan.maxProjects === 9999 ? 'Unlimited' : plan.maxProjects} project${plan.maxProjects === 1 ? '' : 's'}`,
        `${plan.maxApiKeys === 9999 ? 'Unlimited' : plan.maxApiKeys} API keys`,
        `${plan.maxCustomers.toLocaleString()} unique customers remembered`,
        `${plan.memoryOperations.toLocaleString()} persistent memory operations`,
        `${plan.toolExecutions.toLocaleString()} business tool executions`,
        `${plan.rateLimitPerMinute} requests / min rate limit`,
        plan.slug === 'enterprise' ? 'Custom SLA & dedicated engineer' : 'Community & email support',
      ],
    };
  });
};

const getPlan = async (slugOrId) => {
  const normalized = String(slugOrId || 'starter').trim().toLowerCase();
  try {
    const { rows } = await query(
      `SELECT * FROM plans WHERE slug = ? OR id = ? LIMIT 1`,
      [normalized, normalized]
    );
    if (rows[0]) {
      return mapPlanRow(rows[0]);
    }
  } catch {
    // DB not ready or fallback
  }

  return PLAN_FALLBACKS[normalized] || PLAN_FALLBACKS.starter;
};

const getOrganizationPlan = async (organizationId) => {
  try {
    const { rows } = await query(
      `SELECT organizations.plan_name AS orgPlan,
              plans.id, plans.name, plans.slug, plans.max_projects, plans.max_api_keys,
              plans.max_customers, plans.monthly_requests, plans.memory_operations,
              plans.tool_executions, plans.team_members, plans.rate_limit_per_minute,
              subscriptions.status AS subscriptionStatus
       FROM organizations
       LEFT JOIN subscriptions ON subscriptions.organization_id = organizations.id
       LEFT JOIN plans ON plans.id = subscriptions.plan_id OR plans.slug = organizations.plan_name
       WHERE organizations.id = ?`,
      [organizationId]
    );

    if (rows[0] && rows[0].slug) {
      return {
        ...mapPlanRow(rows[0]),
        subscriptionStatus: rows[0].subscriptionStatus || 'active',
      };
    }

    const orgPlanSlug = rows[0]?.orgPlan || 'starter';
    return await getPlan(orgPlanSlug);
  } catch {
    return PLAN_FALLBACKS.starter;
  }
};

const checkPlanLimits = async (organizationId, limitType, countToAdd = 1) => {
  const plan = await getOrganizationPlan(organizationId);

  if (limitType === 'projects') {
    const { rows } = await query(
      `SELECT COUNT(*) AS count FROM projects WHERE organization_id = ? AND status = 'active'`,
      [organizationId]
    );
    const current = Number(rows[0]?.count || 0);
    if (current + countToAdd > plan.maxProjects) {
      const error = new Error(`Plan limit reached: your ${plan.name} plan allows up to ${plan.maxProjects} projects.`);
      error.code = 'QUOTA_EXCEEDED';
      error.statusCode = 403;
      throw error;
    }
  } else if (limitType === 'api_keys') {
    const { rows } = await query(
      `SELECT COUNT(*) AS count FROM project_api_keys
       JOIN projects ON projects.id = project_api_keys.project_id
       WHERE projects.organization_id = ? AND project_api_keys.status = 'active'`,
      [organizationId]
    );
    const current = Number(rows[0]?.count || 0);
    if (current + countToAdd > plan.maxApiKeys) {
      const error = new Error(`Plan limit reached: your ${plan.name} plan allows up to ${plan.maxApiKeys} active API keys.`);
      error.code = 'QUOTA_EXCEEDED';
      error.statusCode = 403;
      throw error;
    }
  } else if (limitType === 'team_members') {
    const { rows } = await query(
      `SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = ?`,
      [organizationId]
    );
    const current = Number(rows[0]?.count || 0);
    if (current + countToAdd > plan.teamMembers) {
      const error = new Error(`Plan limit reached: your ${plan.name} plan allows up to ${plan.teamMembers} team members.`);
      error.code = 'QUOTA_EXCEEDED';
      error.statusCode = 403;
      throw error;
    }
  } else if (limitType === 'customers') {
    const { rows } = await query(
      `SELECT COUNT(*) AS count FROM customers
       JOIN projects ON projects.id = customers.project_id
       WHERE projects.organization_id = ?`,
      [organizationId]
    );
    const current = Number(rows[0]?.count || 0);
    if (current + countToAdd > plan.maxCustomers) {
      const error = new Error(`Plan limit reached: your ${plan.name} plan allows up to ${plan.maxCustomers} customers.`);
      error.code = 'QUOTA_EXCEEDED';
      error.statusCode = 403;
      throw error;
    }
  } else if (limitType === 'requests') {
    // Check monthly request volume
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { rows } = await query(
      `SELECT COUNT(*) AS count FROM usage_records
       WHERE (organization_id = ? OR project_id IN (SELECT id FROM projects WHERE organization_id = ?))
         AND created_at >= ?`,
      [organizationId, organizationId, since]
    );
    const current = Number(rows[0]?.count || 0);
    if (current + countToAdd > plan.monthlyRequests) {
      const error = new Error(`Monthly quota exceeded: your ${plan.name} plan has used ${current}/${plan.monthlyRequests} requests this period.`);
      error.code = 'QUOTA_EXCEEDED';
      error.statusCode = 429;
      throw error;
    }
  }

  return true;
};

// In-memory sliding rate limiter per organization
const rateLimitBuckets = new Map();
const checkRateLimit = (organizationId, limitPerMinute) => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = Math.max(1, Number(limitPerMinute || 60));

  let bucket = rateLimitBuckets.get(organizationId);
  if (!bucket) {
    bucket = [];
    rateLimitBuckets.set(organizationId, bucket);
  }

  // Remove timestamps outside window
  const cutoff = now - windowMs;
  while (bucket.length > 0 && bucket[0] < cutoff) {
    bucket.shift();
  }

  if (bucket.length >= limit) {
    const error = new Error(`Rate limit exceeded (${limit} req/min). Please try again shortly.`);
    error.code = 'RATE_LIMITED';
    error.statusCode = 429;
    throw error;
  }

  bucket.push(now);
  return { allowed: true, remaining: limit - bucket.length };
};

const updateOrganizationPlan = async (organizationId, planSlug) => {
  const plan = await getPlan(planSlug);
  const now = new Date().toISOString();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await query(
    `UPDATE organizations SET plan_name = ?, updated_at = ? WHERE id = ?`,
    [plan.slug, now, organizationId]
  );

  const subId = `sub_${organizationId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}_${Date.now().toString(36)}`;
  await query(
    `INSERT INTO subscriptions (id, organization_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
     ON CONFLICT (organization_id) DO UPDATE SET
       plan_id = excluded.plan_id,
       status = 'active',
       current_period_end = excluded.current_period_end,
       updated_at = excluded.updated_at`,
    [subId, organizationId, plan.id, now, periodEnd, now, now]
  );

  return plan;
};

module.exports = {
  getPlan,
  getOrganizationPlan,
  listPublicPlans,
  checkPlanLimits,
  checkRateLimit,
  updateOrganizationPlan,
  PLAN_FALLBACKS,
};
