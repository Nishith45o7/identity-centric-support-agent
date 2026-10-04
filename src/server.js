const { app } = require('./app');
const { config, validateRuntimeConfig } = require('./config');
const { close: closeDatabase, ready: databaseReady } = require('./db');

const registerGracefulShutdown = (server) => {
  if (!server || typeof server.close !== 'function') {
    return () => {};
  }

  const handleShutdown = (signal) => {
    console.log(`Received ${signal}. Shutting down gracefully...`);

    server.close(async () => {
      await closeDatabase();
      console.log('HTTP server closed.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  return () => {
    process.removeListener('SIGINT', handleShutdown);
    process.removeListener('SIGTERM', handleShutdown);
  };
};

const startServer = (appInstance = app, port = config.port) => {
  const server = appInstance.listen(port, () => {
    console.log(`Identity-Centric Support Agent listening on http://localhost:${port}`);
  });

  registerGracefulShutdown(server);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Retrying on port ${nextPort}.`);
      return startServer(appInstance, nextPort);
    }

    console.error('Server startup failed:', error);
    process.exit(1);
  });

  return server;
};

if (require.main === module) {
  try {
    validateRuntimeConfig(config);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  databaseReady
    .then(() => startServer(app, config.port))
    .catch((error) => {
      console.error('Database initialization failed. Check DATABASE_URL and database connectivity.', error.code || '');
      process.exit(1);
    });
}

module.exports = { startServer, registerGracefulShutdown };
