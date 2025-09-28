import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationBuilder } from 'node-pg-migrate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationPath = path.join(__dirname, '..', 'sql', '02_add_sync_meta_device_columns.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(migrationSql);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_sync_meta_user_device;
    ALTER TABLE sync_meta DROP COLUMN IF EXISTS diff;
    ALTER TABLE sync_meta DROP COLUMN IF EXISTS device_id;
  `);
}
