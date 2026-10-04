require('dotenv').config();

const parseOrigins = (value = '') =>
  String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN || 'http://localhost:3000'),
  groqApiKey: process.env.GROQ_API_KEY || '',
  hindsightApiKey: process.env.HINDSIGHT_API_KEY || '',
  hindsightBaseUrl: process.env.HINDSIGHT_BASE_URL || 'https://api.hindsight.vectorize.io',
  memoryMode: String(process.env.MEMORY_MODE || 'on').toLowerCase() === 'on',
  supportApiKey: process.env.SUPPORT_API_KEY || '',
  billingWebhookSecret: process.env.BILLING_WEBHOOK_SECRET || '',
  databaseUrl: process.env.DATABASE_URL || '',
  apiKeyPepper: process.env.API_KEY_PEPPER || (process.env.NODE_ENV === 'production' ? '' : 'identity-centric-support-development-only'),
};

const validateRuntimeConfig = (runtime = config) => {
  if (String(runtime.nodeEnv || 'development').toLowerCase() !== 'production') {
    return runtime;
  }

  const requiredSecrets = [
    ['API_KEY_PEPPER', runtime.apiKeyPepper],
    ['BILLING_WEBHOOK_SECRET', runtime.billingWebhookSecret],
    ['SUPPORT_API_KEY', runtime.supportApiKey],
  ].filter(([, value]) => !String(value || '').trim());

  if (requiredSecrets.length > 0) {
    throw new Error(`Production deployment is missing required environment values: ${requiredSecrets.map(([key]) => key).join(', ')}.`);
  }

  return runtime;
};

module.exports = { config, parseOrigins, validateRuntimeConfig };
