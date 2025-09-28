import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationBuilder } from 'node-pg-migrate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const coreSchemaPath = path.join(__dirname, '..', 'sql', '01_core_schema.sql');
const coreSchemaSql = readFileSync(coreSchemaPath, 'utf8');

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(coreSchemaSql);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TRIGGER IF EXISTS update_decks_updated_at ON decks;
    DROP TRIGGER IF EXISTS update_notes_updated_at ON notes;
    DROP TRIGGER IF EXISTS update_cards_updated_at ON cards;
    DROP FUNCTION IF EXISTS update_updated_at_column();

    DROP TABLE IF EXISTS device_sync_progress CASCADE;
    DROP TABLE IF EXISTS sync_meta CASCADE;
    DROP TABLE IF EXISTS review_logs CASCADE;
    DROP TABLE IF EXISTS cards CASCADE;
    DROP TABLE IF EXISTS notes CASCADE;
    DROP TABLE IF EXISTS decks CASCADE;

    DROP EXTENSION IF EXISTS "uuid-ossp";
  `);
}
