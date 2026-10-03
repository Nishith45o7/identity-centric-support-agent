const FILTER_PATTERNS = [
  { pattern: /passwords?\s*[:=]\s*[^\s,;]+/gi, replacement: 'password=[REDACTED]' },
  { pattern: /(api[_ -]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, replacement: '$1=[REDACTED]' },
  { pattern: /\b\d{13,19}\b/g, replacement: '[REDACTED_NUMBER]' },
  { pattern: /\b[A-Za-z0-9_\-]{32,}\b/g, replacement: '[REDACTED]' },
  { pattern: /\b(?:\d[ -]?){13,16}\b/g, replacement: '[REDACTED_CARD]' },
];

const sanitizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
};

const filterSensitiveText = (value) => {
  let sanitized = sanitizeText(value);

  for (const rule of FILTER_PATTERNS) {
    sanitized = sanitized.replace(rule.pattern, rule.replacement);
  }

  return sanitized;
};

const validateUserId = (value) => {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  return Boolean(trimmed) && /^[a-zA-Z0-9_-]+$/.test(trimmed);
};

const normalizeMemoryMode = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return ['on', 'true', '1', 'yes'].includes(value.trim().toLowerCase());
  }

  return true;
};

const sanitizeFact = (fact) => {
  if (!fact || typeof fact !== 'object') {
    return null;
  }

  const category = sanitizeText(fact.category || 'general');
  const rawFact = sanitizeText(fact.fact || fact.value || '');

  if (!category || !rawFact) {
    return null;
  }

  const cleaned = filterSensitiveText(rawFact);
  if (!cleaned || cleaned.length < 3) {
    return null;
  }

  return {
    category: category.toLowerCase(),
    fact: cleaned,
  };
};

const sanitizeFacts = (facts = []) => {
  const cleaned = [];
  const seen = new Set();

  for (const item of facts) {
    const sanitized = sanitizeFact(item);
    if (!sanitized) {
      continue;
    }

    const key = `${sanitized.category}:${sanitized.fact.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    cleaned.push(sanitized);
  }

  return cleaned;
};

const extractFactCandidates = (text) => {
  const snippets = sanitizeText(text || '');
  if (!snippets) {
    return [];
  }

  const patterns = [
    { category: 'device', regex: /(MacBook(?: Pro)?|ThinkPad|Dell|Laptop|iPhone|iPad|Windows|macOS|Linux|Android|printer)/gi },
    { category: 'issue', regex: /(404|login error|login issue|printer issue|error code|cannot log in|not working|failed login|authentication issue)/gi },
    { category: 'attempted_fix', regex: /(reset password|restarted|updated software|troubleshooting steps|reinstalled|password reset|tried.*fix)/gi },
    { category: 'status', regex: /(still happening|unresolved|resolved|working now|failed|not fixed)/gi },
  ];

  const factMap = new Map();

  for (const pattern of patterns) {
    const matches = [...new Set((snippets.match(pattern.regex) || []).map((item) => item.trim()))];
    for (const match of matches) {
      const cleaned = filterSensitiveText(match);
      factMap.set(`${pattern.category}:${cleaned.toLowerCase()}`, { category: pattern.category, fact: cleaned });
    }
  }

  return [...factMap.values()];
};

module.exports = {
  sanitizeText,
  filterSensitiveText,
  validateUserId,
  normalizeMemoryMode,
  sanitizeFact,
  sanitizeFacts,
  extractFactCandidates,
};
