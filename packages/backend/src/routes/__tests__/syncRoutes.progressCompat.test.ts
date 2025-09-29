import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { newDb } from 'pg-mem';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { syncRoutes } from '../syncRoutes.js';
import { setTestPool } from '../../db/pg-service.js';

const TEST_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TEST_DEVICE_ID = 'progress-bigint-device';

describe('syncRoutes device_sync_progress compatibility', () => {
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

    await pool.query(`
      CREATE TABLE sync_meta (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        entity_id UUID NOT NULL,
        entity_type TEXT NOT NULL,
        version BIGINT NOT NULL,
        op TEXT NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        payload JSONB,
        device_id TEXT NOT NULL DEFAULT 'unknown-device'
      );

      CREATE TABLE device_sync_progress (
        user_id UUID NOT NULL,
        device_id TEXT NOT NULL,
        last_version BIGINT NOT NULL DEFAULT 0,
        last_meta_id BIGINT,
        continuation_token TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, device_id)
      );
    `);

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
    await pool.query('DELETE FROM device_sync_progress;');
    await pool.query('DELETE FROM sync_meta;');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    setTestPool(null);
  });

  it('falls back when last_meta_id column expects bigint', async () => {
    const metaId = randomUUID();
    await pool.query(
      `
        INSERT INTO sync_meta (id, user_id, entity_id, entity_type, version, op, timestamp)
        VALUES ($1, $2, $3, 'deck', 1, 'delete', NOW());
      `,
      [metaId, TEST_USER_ID, randomUUID()]
    );

    const response = await fetch(
      `${baseUrl}/pull?deviceId=${TEST_DEVICE_ID}`,
      { method: 'GET' }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.ops)).toBe(true);
    expect(body.ops).toHaveLength(1);

    const progress = await pool.query(
      'SELECT last_meta_id, continuation_token FROM device_sync_progress WHERE user_id = $1 AND device_id = $2',
      [TEST_USER_ID, TEST_DEVICE_ID]
    );
    expect(progress.rowCount).toBe(1);
    expect(progress.rows[0].last_meta_id).toBeNull();
    expect(progress.rows[0].continuation_token).toBeNull();
  });
});
