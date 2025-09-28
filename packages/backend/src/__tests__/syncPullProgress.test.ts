import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { newDb } from 'pg-mem';
import { setTestPool } from '../db/pg-service.js';

const TEST_JWT_SECRET = 'test-secret';
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_DEVICE_ID = 'test-device';

const signToken = () => jwt.sign({ sub: TEST_USER_ID }, TEST_JWT_SECRET);

const decodeContinuationToken = (token: string) => {
  const [versionPart, idPart] = token.split(':');
  const version = Number.parseInt(versionPart, 10);
  const id = Number.parseInt(idPart, 10);
  if (!Number.isInteger(version) || !Number.isInteger(id)) {
    throw new Error(`Invalid continuation token: ${token}`);
  }
  return { version, id };
};

describe('syncRoutes /pull progress tracking', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let pool: Pool;
  let appBuilder: typeof import('../index.js')['buildApp'];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;

    const db = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = db.adapters.createPg();
    pool = new adapter.Pool();

    await pool.query(`
      CREATE TABLE sync_meta (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        entity_id UUID NOT NULL,
        entity_type TEXT NOT NULL,
        version BIGINT NOT NULL,
        op TEXT NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        payload JSONB,
        device_id TEXT,
        diff JSONB
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
    ({ buildApp: appBuilder } = await import('../index.js'));
    app = await appBuilder();
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
    await pool.query('TRUNCATE sync_meta RESTART IDENTITY;');
    await pool.query('TRUNCATE device_sync_progress;');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    setTestPool(null);
  });

  it('persists progress and defaults sinceVersion for reconnecting devices', async () => {
    await pool.query(
      'INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op) VALUES ($1, $2, $3, $4, $5);',
      [TEST_USER_ID, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'deck', 1, 'delete']
    );
    await pool.query(
      'INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op) VALUES ($1, $2, $3, $4, $5);',
      [TEST_USER_ID, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'deck', 2, 'delete']
    );

    const token = signToken();
    const headers = { Authorization: `Bearer ${token}` };

    const firstResponse = await fetch(`${baseUrl}/api/v1/sync/pull?deviceId=${TEST_DEVICE_ID}`, {
      headers,
    });
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.ops.length).toBe(2);
    expect(firstBody.ops.map((op: any) => op.version)).toEqual([1, 2]);

    const progressAfterFirst = await pool.query(
      'SELECT last_version, continuation_token FROM device_sync_progress WHERE user_id = $1 AND device_id = $2;',
      [TEST_USER_ID, TEST_DEVICE_ID]
    );
    expect(progressAfterFirst.rowCount).toBe(1);
    expect(Number(progressAfterFirst.rows[0].last_version)).toBe(2);
    expect(progressAfterFirst.rows[0].continuation_token).toBeNull();

    await pool.query(
      'INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op) VALUES ($1, $2, $3, $4, $5);',
      [TEST_USER_ID, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'deck', 3, 'delete']
    );

    const secondResponse = await fetch(`${baseUrl}/api/v1/sync/pull?deviceId=${TEST_DEVICE_ID}`, {
      headers,
    });
    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.ops.length).toBe(1);
    expect(secondBody.ops[0].version).toBe(3);

    const progressAfterSecond = await pool.query(
      'SELECT last_version, continuation_token FROM device_sync_progress WHERE user_id = $1 AND device_id = $2;',
      [TEST_USER_ID, TEST_DEVICE_ID]
    );
    expect(Number(progressAfterSecond.rows[0].last_version)).toBe(3);
    expect(progressAfterSecond.rows[0].continuation_token).toBeNull();
  });

  it('stores continuation state for paginated pulls', async () => {
    await pool.query(
      'INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op) VALUES ($1, $2, $3, $4, $5);',
      [TEST_USER_ID, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'deck', 1, 'delete']
    );
    await pool.query(
      'INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op) VALUES ($1, $2, $3, $4, $5);',
      [TEST_USER_ID, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'deck', 2, 'delete']
    );

    const token = signToken();
    const headers = { Authorization: `Bearer ${token}` };

    const firstResponse = await fetch(
      `${baseUrl}/api/v1/sync/pull?deviceId=${TEST_DEVICE_ID}&limit=1`,
      { headers }
    );
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.ops.length).toBe(1);
    expect(firstBody.hasMore).toBe(true);
    expect(typeof firstBody.continuationToken).toBe('string');

    const storedProgress = await pool.query(
      'SELECT last_version, last_meta_id, continuation_token FROM device_sync_progress WHERE user_id = $1 AND device_id = $2;',
      [TEST_USER_ID, TEST_DEVICE_ID]
    );
    expect(Number(storedProgress.rows[0].last_version)).toBe(1);
    expect(storedProgress.rows[0].continuation_token).toBe(firstBody.continuationToken);

    const decoded = decodeContinuationToken(firstBody.continuationToken);
    expect(Number(storedProgress.rows[0].last_meta_id)).toBe(decoded.id);

    const secondResponse = await fetch(
      `${baseUrl}/api/v1/sync/pull?deviceId=${TEST_DEVICE_ID}&limit=1`,
      { headers }
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.ops.length).toBe(1);
    expect(secondBody.ops[0].version).toBe(2);
    expect(secondBody.hasMore).toBe(false);

    const finalProgress = await pool.query(
      'SELECT last_version, continuation_token FROM device_sync_progress WHERE user_id = $1 AND device_id = $2;',
      [TEST_USER_ID, TEST_DEVICE_ID]
    );
    expect(Number(finalProgress.rows[0].last_version)).toBe(2);
    expect(finalProgress.rows[0].continuation_token).toBeNull();
  });
});
