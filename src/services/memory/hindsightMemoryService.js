const crypto = require('crypto');
const { config } = require('../../config');
const { sanitizeFacts, sanitizeText, validateUserId } = require('../../utils/sanitizers');

class HindsightMemoryService {
  constructor() {
    this.banks = new Map();
    this.baseUrl = config.hindsightBaseUrl || 'https://api.hindsight.vectorize.io';
    this.apiKey = config.hindsightApiKey || '';
    this.allowRemote = config.nodeEnv !== 'test';
  }

  getApiKey() {
    return this.apiKey || config.hindsightApiKey || '';
  }

  isRemoteConfigured() {
    if (config.nodeEnv === 'test') {
      return this.allowRemote && Boolean(this.getApiKey());
    }

    return Boolean(this.getApiKey());
  }

  buildBankId(userId, tenantId = 'default', projectId = 'default', environment = 'live') {
    if (!validateUserId(userId)) {
      const err = new Error('Invalid user identifier.');
      err.code = 'INVALID_IDENTITY';
      err.statusCode = 400;
      throw err;
    }

    const normalizedEnv = String(environment || 'live').toLowerCase();
    const scope = [tenantId || 'default', projectId || 'default', normalizedEnv, String(userId).trim()].join('\u0000');
    const digest = crypto.createHash('sha256').update(scope).digest('hex');
    return `ctx_${normalizedEnv}_${digest}`;
  }

  getBank(userId, tenantId = 'default', projectId = 'default', environment = 'live') {
    const bankId = this.buildBankId(userId, tenantId, projectId, environment);
    if (!this.banks.has(bankId)) {
      this.banks.set(bankId, []);
    }

    return this.banks.get(bankId);
  }

  async request(path, { method = 'GET', body } = {}) {
    const apiKey = this.getApiKey();
    const headers = {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const contentType = response.headers && response.headers.get ? response.headers.get('content-type') : '';
    const payload = contentType && contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      const err = new Error(`Hindsight request failed with status ${response.status}.`);
      err.statusCode = response.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  async remoteRecall(userId, query = '', tenantId = 'default', projectId = 'default', environment = 'live') {
    if (!this.isRemoteConfigured()) {
      return [];
    }

    const bankId = this.buildBankId(userId, tenantId, projectId, environment);
    const sanitizedQuery = sanitizeText(query || '');

    try {
      const data = await this.request(`/v1/default/banks/${bankId}/memories/recall`, {
        method: 'POST',
        body: {
          query: sanitizedQuery,
          types: ['world', 'experience', 'observation'],
          budget: 'mid',
          max_tokens: 4096,
        },
      });

      const results = Array.isArray(data && data.results) ? data.results : [];
      const remoteFacts = results
        .map((result) => {
          const factText = sanitizeText(result.text || result.fact || result.content || result.context || '');
          if (!factText) {
            return null;
          }

          return {
            category: result.type || result.category || 'experience',
            fact: factText,
          };
        })
        .filter(Boolean);

      if (remoteFacts.length) {
        this.getBank(userId, tenantId, projectId, environment).push(...remoteFacts.filter((fact) => !this.getBank(userId, tenantId, projectId, environment).some((existing) => existing.category === fact.category && existing.fact === fact.fact)));
      }

      return remoteFacts;
    } catch (error) {
      console.warn('Hindsight recall failed, falling back to local memory.', error.message);
      return [];
    }
  }

  async remoteRetain(userId, facts = [], tenantId = 'default', projectId = 'default', environment = 'live') {
    if (!this.isRemoteConfigured()) {
      return { success: false, skipped: true };
    }

    const bankId = this.buildBankId(userId, tenantId, projectId, environment);
    const sanitized = sanitizeFacts(facts)
      .map((fact) => ({
        content: sanitizeText(fact.fact || ''),
        context: sanitizeText(fact.category || 'support_context'),
        metadata: {
          externalIdentityHash: crypto.createHash('sha256').update(String(userId)).digest('hex'),
          category: sanitizeText(fact.category || 'support_context'),
          source: 'identity-centric-support',
        },
        tags: ['identity-centric-support', `user:${bankId}`],
      }))
      .filter((item) => item.content);

    if (!sanitized.length) {
      return { success: false, skipped: true };
    }

    try {
      return await this.request(`/v1/default/banks/${bankId}/memories`, {
        method: 'POST',
        body: {
          items: sanitized,
          async: false,
        },
      });
    } catch (error) {
      console.warn('Hindsight retain failed, keeping local memory only.', error.message);
      return { success: false, fallback: true };
    }
  }

  async recall(userId, query = '', tenantId = 'default', projectId = 'default', environment = 'live') {
    const bank = this.getBank(userId, tenantId, projectId, environment);
    const search = sanitizeText(query || '').toLowerCase();

    const baseFacts = !search
      ? [...bank]
      : bank.filter((fact) => {
          const combined = `${fact.category || ''} ${fact.fact || ''}`.toLowerCase();
          const factText = (fact.fact || '').toLowerCase();
          if (combined.includes(search) || (factText && search.includes(factText))) {
            return true;
          }
          const words = search
            .split(/\s+/)
            .map((w) => w.replace(/[^a-z0-9]/g, ''))
            .filter((w) => w.length > 3);
          return words.some((w) => combined.includes(w));
        });

    if (this.isRemoteConfigured()) {
      const remoteFacts = await this.remoteRecall(userId, query, tenantId, projectId, environment);
      const merged = [...baseFacts, ...remoteFacts];
      const deduped = [];
      const seen = new Set();

      for (const fact of merged) {
        const key = `${fact.category || 'experience'}:${fact.fact}`.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(fact);
        }
      }

      return { facts: deduped };
    }

    return { facts: baseFacts };
  }

  async retain(userId, facts = [], tenantId = 'default', projectId = 'default', environment = 'live') {
    const bank = this.getBank(userId, tenantId, projectId, environment);
    const sanitized = sanitizeFacts(facts);

    for (const fact of sanitized) {
      const duplicate = bank.some(
        (existing) => existing.category === fact.category && existing.fact === fact.fact,
      );

      if (!duplicate) {
        bank.push(fact);
      }
    }

    if (this.isRemoteConfigured()) {
      await this.remoteRetain(userId, sanitized, tenantId, projectId, environment);
    }

    return { facts: [...bank] };
  }

  async clear(userId, tenantId = 'default', projectId = 'default', environment = 'live') {
    const bankId = this.buildBankId(userId, tenantId, projectId, environment);
    this.banks.delete(bankId);

    if (this.isRemoteConfigured()) {
      try {
        await this.request(`/v1/default/banks/${bankId}/memories`, { method: 'DELETE' });
      } catch (error) {
        const failure = new Error('Customer memory could not be deleted from the memory provider.');
        failure.code = 'MEMORY_ERROR';
        failure.statusCode = 502;
        throw failure;
      }
    }

    return { success: true, message: 'Customer memory cleared.' };
  }

  async deleteFact(userId, factTextOrCategory, tenantId = 'default', projectId = 'default', environment = 'live') {
    const bank = this.getBank(userId, tenantId, projectId, environment);
    const beforeLen = bank.length;
    const remaining = bank.filter((f) => f.fact !== factTextOrCategory && f.category !== factTextOrCategory);
    const bankId = this.buildBankId(userId, tenantId, projectId, environment);
    this.banks.set(bankId, remaining);
    return beforeLen > remaining.length;
  }

  async snapshot(userId, tenantId = 'default', projectId = 'default', environment = 'live') {
    const recalled = await this.recall(userId, '', tenantId, projectId, environment);
    return { userId, tenantId, facts: recalled.facts };
  }
}

const memoryService = new HindsightMemoryService();
module.exports = memoryService;
