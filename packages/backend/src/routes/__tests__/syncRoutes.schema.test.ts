import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { newDb } from 'pg-mem';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { syncRoutes } from '../syncRoutes.js';
import { setTestPool } from '../../db/database.js';

const TEST_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEST_DEVICE_ID = 'real-schema-device';
const TEST_DECK_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function loadCoreSchemaStatements(): string[] {
  const schemaPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../sql/01_core_schema.sql'
  );
  const raw = readFileSync(schemaPath, 'utf-8');
  const withoutComments = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const withoutFunctions = withoutComments.replace(
    /create\s+or\s+replace\s+function[\s\S]*?\$\$\s*language\s+'plpgsql';/gi,
    ''
  );

  return withoutFunctions
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`)
    .filter((statement) => {
      const normalized = statement.trim().toLowerCase();
      if (normalized.startsWith('create extension')) {
        return false;
      }
      if (normalized.startsWith('alter table') && normalized.includes('enable row level security')) {
        return false;
      }
      if (normalized.startsWith('create policy')) {
        return false;
      }
      if (normalized.startsWith('create trigger')) {
        return false;
      }
      return true;
    });
}

describe('syncRoutes with core schema DDL', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: 'uuid' as any,
      implementation: () => randomUUID(),
    });
    const adapter = db.adapters.createPg();
    pool = new adapter.Pool();

    const schemaStatements = loadCoreSchemaStatements();
    for (const statement of schemaStatements) {
      await pool.query(statement);
    }

    setTestPool(pool as any);

    app = Fastify({ logger: false });
    app.decorateRequest('user', null);
    app.addHook('preHandler', (request: any, _reply, done) => {
      request.user = { id: TEST_USER_ID };
      done();
    });
    await app.register(syncRoutes);
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (typeof address === 'object' && address) {
      baseUrl = `http://${address.address}:${address.port}`;
    } else if (typeof address === 'string') {
      baseUrl = address;
    } else {
      throw new Error('Failed to determine Fastify server address for tests');
    }
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM review_logs;');
    await pool.query('DELETE FROM cards;');
    await pool.query('DELETE FROM notes;');
    await pool.query('DELETE FROM decks;');
    await pool.query('DELETE FROM sync_meta;');
    await pool.query('DELETE FROM device_sync_progress;');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    setTestPool(null);
  });

  it('accepts push inserts using columns defined in the core schema', async () => {
    const pushResponse = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: TEST_DEVICE_ID,
        ops: [
          {
            entityId: TEST_DECK_ID,
            entityType: 'deck',
            version: 1,
            op: 'create',
            timestamp: Date.now(),
            diff: { name: { from: null, to: 'Deck Name' } },
            payload: {
              name: 'Deck Name',
              description: null,
              config: {},
            },
          },
        ],
      }),
    });

    expect(pushResponse.status).toBe(200);
    const pushBody = await pushResponse.json();
    expect(pushBody.currentVersion).toBe(1);

    const metaRows = await pool.query(
      'SELECT entity_id::text AS entity_id, device_id, diff FROM sync_meta'
    );
    expect(metaRows.rows).toEqual([
      {
        entity_id: TEST_DECK_ID,
        device_id: TEST_DEVICE_ID,
        diff: { name: { from: null, to: 'Deck Name' } },
      },
    ]);

    const deckRows = await pool.query('SELECT id::text AS id, name FROM decks');
    expect(deckRows.rows).toEqual([
      { id: TEST_DECK_ID, name: 'Deck Name' },
    ]);
  });
});
