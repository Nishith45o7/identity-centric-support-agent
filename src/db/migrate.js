const { close, migrate } = require('./index');

migrate()
  .then(() => console.log('Database migrations are up to date.'))
  .catch((error) => {
    console.error('Database migration failed.', error.code || '');
    process.exitCode = 1;
  })
  .finally(close);