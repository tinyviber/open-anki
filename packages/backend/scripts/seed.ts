import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getDatabaseUrl } = require('./getDatabaseUrl.cjs') as {
  getDatabaseUrl: () => string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSeeds() {
  const connectionString = getDatabaseUrl();
  const client = new Client({ connectionString });

  const seedsDirectory = path.join(__dirname, '..', 'sql', 'seeds');
  const seedFiles = readdirSync(seedsDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (seedFiles.length === 0) {
    console.log('No seed files found. Skipping.');
    return;
  }

  console.log(`Applying ${seedFiles.length} seed file(s) to ${connectionString}`);

  await client.connect();

  try {
    for (const file of seedFiles) {
      const filePath = path.join(seedsDirectory, file);
      const sql = readFileSync(filePath, 'utf8');
      if (!sql.trim()) {
        continue;
      }

      console.log(`\n→ Running seed ${file}`);
      await client.query(sql);
    }

    console.log('\n✓ Seed data applied successfully');
  } catch (error) {
    console.error('\n✗ Failed to apply seeds', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

runSeeds();
