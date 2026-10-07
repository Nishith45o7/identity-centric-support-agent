#!/bin/sh
set -e

# Run database migrations before server startup if enabled (default true)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running database migrations..."
  node src/db/migrate.js || {
    echo "Database migration failed! Halting container startup."
    exit 1
  }
fi

echo "Starting Contextis server in ${NODE_ENV:-production} mode..."
exec "$@"
