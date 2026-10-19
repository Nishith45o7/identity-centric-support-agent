const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { getAbsoluteFSPath } = require('swagger-ui-dist');

const { config } = require('./config');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const notFoundHandler = require('./middleware/notFound');
const supportRoutes = require('./routes/supportRoutes');
const platformRoutes = require('./routes/platformRoutes');
const v1Routes = require('./routes/v1Routes');
const { health, ready, live } = require('./controllers/supportController');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

const requireSupportApiKey = (req, res, next) => {
  const configuredKey = config.supportApiKey || '';

  if (!configuredKey) {
    return next();
  }

  const providedKey = req.get('x-api-key') || req.get('authorization')?.replace('Bearer ', '') || '';

  if (providedKey !== configuredKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'A valid API key is required to access this resource.',
      },
    });
  }

  return next();
};

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hidePoweredBy: true,
}));
app.use((req, res, next) => {
  if (req.path.startsWith('/docs') || req.path.startsWith('/swagger-ui')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self';",
    );
  }

  next();
});

const isPublicCorsEndpoint = (reqPath) =>
  reqPath === '/widget.js' ||
  reqPath.startsWith('/widget') ||
  reqPath.startsWith('/v1/support/') ||
  reqPath.startsWith('/v1/public/') ||
  reqPath.startsWith('/api/') ||
  reqPath.startsWith('/swagger-ui') ||
  reqPath === '/health' ||
  reqPath === '/ready' ||
  reqPath === '/live' ||
  reqPath === '/docs' ||
  reqPath === '/staging';

app.use(
  cors((req, callback) => {
    const origin = req.header('Origin');

    if (!origin) {
      return callback(null, { origin: true, credentials: true });
    }

    if (isPublicCorsEndpoint(req.path)) {
      return callback(null, { origin: true, credentials: false });
    }

    if (config.corsOrigins.includes(origin)) {
      return callback(null, { origin: true, credentials: true });
    }

    return callback(null, { origin: false });
  }),
);

app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.nodeEnv === 'test' ? 10000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
    },
  },
});

app.use('/api', supportLimiter);
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/ready' || req.path === '/live' || req.path === '/openapi.json') {
    return next();
  }

  return requireSupportApiKey(req, res, next);
});
app.use('/api', supportRoutes);
app.use('/v1', platformRoutes);
app.use('/v1', v1Routes);
app.get('/widget/config', (req, res, next) => {
  req.url = `/widget/config${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
  return platformRoutes(req, res, next);
});

app.use('/swagger-ui', express.static(getAbsoluteFSPath()));
app.get('/health', health);
app.get('/ready', ready);
app.get('/live', live);
app.get('/staging', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/staging-demo.html'));
});
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/docs.html'));
});
app.get('/developer', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/developer.html'));
});
app.get('/widget', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/widget.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/signup.html'));
});
app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/home.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/home.html'));
});

app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/v1')) {
    return notFoundHandler(req, res);
  }

  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

module.exports = { app };
