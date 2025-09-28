const path = require('node:path');
const { getDatabaseUrl } = require('./scripts/getDatabaseUrl.cjs');

module.exports = {
  dir: 'migrations',
  migrationsTable: 'schema_migrations',
  databaseUrl: getDatabaseUrl(),
  tsconfig: path.join(__dirname, 'tsconfig.json'),
};
