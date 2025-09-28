import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { newDb } from 'pg-mem';
import { syncRoutes } from '../syncRoutes.js';
import { setTestPool } from '../../db/pg-service.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

describe('syncRoutes timestamp handling', () => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = db.adapters.createPg();

  const pool = new Pool();
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    setTestPool(pool as any);

    await pool.query(`
      CREATE TABLE sync_meta (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        version BIGINT NOT NULL,
        op TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        payload JSONB,
        UNIQUE(entity_id, version),
        UNIQUE(user_id, entity_id, version)
      );
    `);

    await pool.query(`
      CREATE TABLE decks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL
      );
    `);

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
    await pool.query('DELETE FROM sync_meta;');
    await pool.query('DELETE FROM decks;');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    setTestPool(null);
  });

  it('stores millisecond timestamps as dates and returns them during pull', async () => {
    const timestampMillis = Date.now();

    const pushResponse = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'device-1',
        ops: [
          {
            entityId: 'deck-1',
            entityType: 'deck',
            version: 1,
            op: 'delete',
            timestamp: timestampMillis,
          },
        ],
      }),
    });
    expect(pushResponse.status).toBe(200);
    const pushBody = await pushResponse.json();
    expect(pushBody.currentVersion).toBe(1);

    const metaRows = await pool.query('SELECT timestamp FROM sync_meta');
    expect(metaRows.rows).toHaveLength(1);
    const storedTimestamp: Date = metaRows.rows[0].timestamp;
    expect(storedTimestamp instanceof Date).toBe(true);
    expect(storedTimestamp.getTime()).toBe(timestampMillis);

    const pullResponse = await fetch(`${baseUrl}/pull?sinceVersion=0`);
    expect(pullResponse.status).toBe(200);
    const body = await pullResponse.json();
    expect(body.ops).toHaveLength(1);
    const pulledTimestamp = new Date(body.ops[0].timestamp).getTime();
    expect(pulledTimestamp).toBe(timestampMillis);
  });
});
