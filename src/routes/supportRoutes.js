const express = require('express');

const { health, ready, live, chat, endSession, getMemory, clearMemory } = require('../controllers/supportController');
const { validateChatPayload, validateSessionPayload, validateMemoryRequest } = require('../validators/supportValidator');

const router = express.Router();

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Identity-Centric Support Agent API',
    version: '1.0.0',
    description: 'Secure, identity-aware customer support endpoints with per-user memory and request tracing.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development server' }],
  paths: {
    '/health': {
      get: {
        summary: 'Returns application health and configuration state',
        responses: {
          200: { description: 'Healthy application response' },
        },
      },
    },
    '/ready': {
      get: {
        summary: 'Returns readiness status for orchestration probes',
        responses: {
          200: { description: 'Application is ready to accept traffic' },
        },
      },
    },
    '/live': {
      get: {
        summary: 'Returns liveness status for process monitoring',
        responses: {
          200: { description: 'Application is alive and responsive' },
        },
      },
    },
    '/support/chat': {
      post: {
        summary: 'Send a support message for a customer identity',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {
          200: { description: 'Support reply with memory context' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/support/end': {
      post: {
        summary: 'Finalize a support session and retain extracted facts',
        responses: {
          200: { description: 'Session facts stored' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/support/memory': {
      get: {
        summary: 'Fetch remembered facts for a user',
        responses: { 200: { description: 'User memory snapshot' } },
      },
      delete: {
        summary: 'Clear remembered facts for a user',
        responses: { 200: { description: 'Memory cleared' } },
      },
    },
  },
};

router.get('/openapi.json', (req, res) => {
  res.json(openApiSpec);
});

router.get('/health', health);
router.get('/ready', ready);
router.get('/live', live);
router.post('/support/chat', validateChatPayload, chat);
router.post('/support/end', validateSessionPayload, endSession);
router.get('/support/memory', validateMemoryRequest, getMemory);
router.delete('/support/memory', validateMemoryRequest, clearMemory);

module.exports = router;
