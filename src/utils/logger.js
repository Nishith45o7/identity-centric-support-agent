const logger = {
  info: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    console.log(JSON.stringify({ level: 'info', message, ...meta }));
  },
  warn: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    console.warn(JSON.stringify({ level: 'warn', message, ...meta }));
  },
  error: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    console.error(JSON.stringify({ level: 'error', message, ...meta }));
  },
};

module.exports = { logger };
