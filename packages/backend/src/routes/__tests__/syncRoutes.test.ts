import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { newDb } from 'pg-mem';
import { syncRoutes } from '../syncRoutes.js';
import { setTestPool } from '../../db/database.js';
import { DEFAULT_PULL_LIMIT } from '../../../../shared/src/sync.js';

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
      CREATE SEQUENCE sync_meta_id_seq AS BIGINT;

      CREATE TABLE sync_meta (
        id TEXT PRIMARY KEY DEFAULT ('meta-' || nextval('sync_meta_id_seq')::TEXT),
        user_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        version BIGINT NOT NULL,
        op TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        payload JSONB,
        device_id TEXT NOT NULL,
        diff JSONB,
        UNIQUE(user_id, entity_id, version)
      );
    `);

    await pool.query(`
      CREATE TABLE device_sync_progress (
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        last_version BIGINT NOT NULL DEFAULT 0,
        last_meta_id TEXT,
        continuation_token TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, device_id)
      );
    `);

    await pool.query(`
      CREATE TABLE decks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT,
        description TEXT,
        config JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        deck_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        fields JSONB NOT NULL,
        tags TEXT[],
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        due TIMESTAMPTZ,
        interval INTEGER,
        ease_factor REAL,
        reps INTEGER,
        lapses INTEGER,
        card_type INTEGER,
        queue INTEGER,
        original_due INTEGER,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE review_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        timestamp TIMESTAMPTZ,
        rating INTEGER,
        duration_ms INTEGER
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
    await pool.query('DELETE FROM review_logs;');
    await pool.query('DELETE FROM cards;');
    await pool.query('DELETE FROM notes;');
    await pool.query('DELETE FROM decks;');
    await pool.query('DELETE FROM device_sync_progress;');
  });

  async function pushBasicSyncFixture(baseTimestamp: number) {
    const dueMillis = baseTimestamp + 1_000;
    const originalDueMillis = baseTimestamp + 2_000;
    const reviewTimestampMillis = baseTimestamp + 3_000;

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
            op: 'create',
            timestamp: baseTimestamp,
            diff: { from: null, to: 'Test Deck' },
            payload: {
              name: 'Test Deck',
              description: null,
              config: {},
            },
          },
          {
            entityId: 'note-1',
            entityType: 'note',
            version: 2,
            op: 'create',
            timestamp: baseTimestamp + 1,
            payload: {
              deck_id: 'deck-1',
              model_name: 'Basic',
              fields: { Front: 'Q', Back: 'A' },
              tags: ['tag'],
            },
          },
          {
            entityId: 'card-1',
            entityType: 'card',
            version: 3,
            op: 'create',
            timestamp: baseTimestamp + 2,
            payload: {
              note_id: 'note-1',
              ordinal: 0,
              due: dueMillis,
              interval: 0,
              ease_factor: 2.5,
              reps: 0,
              lapses: 0,
              card_type: 1,
              queue: 0,
              original_due: originalDueMillis,
            },
          },
          {
            entityId: 'review-log-1',
            entityType: 'review_log',
            version: 4,
            op: 'create',
            timestamp: baseTimestamp + 3,
            payload: {
              card_id: 'card-1',
              timestamp: reviewTimestampMillis,
              rating: 4,
              duration_ms: 1200,
            },
          },
        ],
      }),
    });
    expect(pushResponse.status).toBe(200);
    const pushBody = await pushResponse.json();
    expect(pushBody.currentVersion).toBe(4);

    return { dueMillis, originalDueMillis, reviewTimestampMillis };
  }

  afterAll(async () => {
    await app.close();
    await pool.end();
    setTestPool(null);
  });

  it('stores millisecond timestamps as dates and returns them during pull', async () => {
    const timestampMillis = Date.now();
    const { dueMillis, originalDueMillis, reviewTimestampMillis } =
      await pushBasicSyncFixture(timestampMillis);

    const metaRows = await pool.query(
      'SELECT entity_type, version, timestamp, device_id, diff FROM sync_meta ORDER BY version ASC'
    );
    expect(metaRows.rows).toHaveLength(4);
    metaRows.rows.forEach((row: Record<string, unknown>, index: number) => {
      expect(row.timestamp).toBeInstanceOf(Date);
      expect((row.timestamp as Date).getTime()).toBe(timestampMillis + index);
      expect(row.device_id).toBe('device-1');
    });
    expect(metaRows.rows[0].diff).toEqual({ from: null, to: 'Test Deck' });
    expect(metaRows.rows[1].diff).toBeNull();

    const cardRows = await pool.query('SELECT due, original_due, interval, ease_factor, reps, lapses, card_type, queue FROM cards');
    expect(cardRows.rows).toHaveLength(1);
    const cardRow = cardRows.rows[0];
    expect(cardRow.due).toBeInstanceOf(Date);
    expect((cardRow.due as Date).getTime()).toBe(dueMillis);
    expect(typeof cardRow.original_due).toBe('number');
    expect(cardRow.original_due).toBe(originalDueMillis);
    expect(cardRow.interval).toBe(0);
    expect(cardRow.ease_factor).toBeCloseTo(2.5);
    expect(cardRow.reps).toBe(0);
    expect(cardRow.lapses).toBe(0);
    expect(cardRow.card_type).toBe(1);
    expect(cardRow.queue).toBe(0);

    const reviewRows = await pool.query('SELECT timestamp FROM review_logs');
    expect(reviewRows.rows).toHaveLength(1);
    const reviewTimestamp: Date = reviewRows.rows[0].timestamp;
    expect(reviewTimestamp.getTime()).toBe(reviewTimestampMillis);

    const pullResponse = await fetch(
      `${baseUrl}/pull?sinceVersion=0&limit=50&deviceId=test-device`
    );
    expect(pullResponse.status).toBe(200);
    const body = await pullResponse.json();
    expect(body.ops).toHaveLength(4);
    expect(body.hasMore).toBe(false);
    expect(body.continuationToken).toBeNull();

    const cardOp = body.ops.find((op: any) => op.entityType === 'card');
    expect(cardOp).toBeTruthy();
    expect(typeof cardOp.timestamp).toBe('number');
    expect(cardOp.timestamp).toBe(timestampMillis + 2);
    expect(cardOp.payload.due).toBe(dueMillis);
    expect(cardOp.payload.original_due).toBe(originalDueMillis);
    expect(cardOp.payload.interval).toBe(0);
    expect(cardOp.payload.ease_factor).toBe(2.5);
    expect(cardOp.payload.reps).toBe(0);
    expect(cardOp.payload.lapses).toBe(0);
    expect(cardOp.payload.card_type).toBe(1);
    expect(cardOp.payload.queue).toBe(0);
    expect('user_id' in cardOp.payload).toBe(false);

    const reviewOp = body.ops.find((op: any) => op.entityType === 'review_log');
    expect(reviewOp).toBeTruthy();
    expect(typeof reviewOp.timestamp).toBe('number');
    expect(reviewOp.timestamp).toBe(timestampMillis + 3);
    expect(reviewOp.payload.timestamp).toBe(reviewTimestampMillis);
    expect(reviewOp.payload.duration_ms).toBe(1200);
  });

  it('returns null scheduling fields when database columns are null', async () => {
    const timestampMillis = Date.now();
    await pushBasicSyncFixture(timestampMillis);

    await pool.query("UPDATE cards SET due = NULL WHERE id = 'card-1'");
    await pool.query("UPDATE review_logs SET timestamp = NULL WHERE id = 'review-log-1'");

    const pullResponse = await fetch(
      `${baseUrl}/pull?sinceVersion=0&limit=50&deviceId=test-device`
    );
    expect(pullResponse.status).toBe(200);
    const body = await pullResponse.json();

    const cardOp = body.ops.find((op: any) => op.entityType === 'card');
    expect(cardOp).toBeTruthy();
    expect(cardOp.payload.due).toBeNull();

    const reviewOp = body.ops.find((op: any) => op.entityType === 'review_log');
    expect(reviewOp).toBeTruthy();
    expect(reviewOp.payload.timestamp).toBeNull();

    const cardRows = await pool.query('SELECT due FROM cards');
    expect(cardRows.rows).toHaveLength(1);
    expect(cardRows.rows[0].due).toBeNull();

    const reviewRows = await pool.query('SELECT timestamp FROM review_logs');
    expect(reviewRows.rows).toHaveLength(1);
    expect(reviewRows.rows[0].timestamp).toBeNull();
  });

  it('streams operations across multiple pull pages using continuation tokens', async () => {
    const totalOps = 12;
    const baseTimestamp = Date.parse('2024-01-01T00:00:00.000Z');

    for (let i = 0; i < totalOps; i += 1) {
      const entityId = `deck-${i + 1}`;
      const timestamp = new Date(baseTimestamp + i);
      const payload = {
        name: `Deck ${i + 1}`,
        description: null,
        config: {},
      };

      await pool.query(
        `
          INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op, timestamp, payload, device_id, diff)
          VALUES ($1, $2, 'deck', $3, 'create', $4, $5, $6, NULL);
        `,
        [TEST_USER_ID, entityId, i + 1, timestamp, payload, 'seed-device']
      );
    }

    const pageLimit = 5;
    const collectedOps: any[] = [];
    let continuation: string | undefined;
    let iterations = 0;

    while (true) {
      const params = new URLSearchParams({
        sinceVersion: '0',
        limit: pageLimit.toString(),
      });

      if (continuation) {
        params.set('continuationToken', continuation);
      }

      const response = await fetch(`${baseUrl}/pull?${params.toString()}`);
      expect(response.status).toBe(200);

      const body = await response.json();
      collectedOps.push(...body.ops);

      if (body.hasMore) {
        expect(typeof body.continuationToken).toBe('string');
        continuation = body.continuationToken;
      } else {
        expect(body.continuationToken).toBeNull();
        continuation = undefined;
      }

      iterations += 1;
      expect(iterations).toBeLessThan(10);

      if (!body.hasMore) {
        break;
      }
    }

    expect(collectedOps).toHaveLength(totalOps);
    const expectedIds = Array.from({ length: totalOps }, (_, index) => `deck-${index + 1}`);
    expect(collectedOps.map((op: any) => op.entityId)).toEqual(expectedIds);
    const uniqueKeys = new Set(collectedOps.map((op: any) => `${op.entityId}:${op.version}`));
    expect(uniqueKeys.size).toBe(totalOps);
    expect(collectedOps[collectedOps.length - 1].version).toBe(totalOps);
  });

  it('returns 409 conflicts for stale versions and leaves state untouched', async () => {
    const createResponse = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'device-1',
        ops: [
          {
            entityId: 'deck-1',
            entityType: 'deck',
            version: 1,
            op: 'create',
            timestamp: Date.now(),
            payload: {
              name: 'Initial Deck',
              description: null,
              config: {},
            },
          },
        ],
      }),
    });
    expect(createResponse.status).toBe(200);

    const stalePush = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'device-2',
        ops: [
          {
            entityId: 'deck-1',
            entityType: 'deck',
            version: 1,
            op: 'update',
            timestamp: Date.now(),
            payload: {
              name: 'Updated Deck',
              description: 'stale write',
              config: {},
            },
          },
          {
            entityId: 'note-1',
            entityType: 'note',
            version: 2,
            op: 'create',
            timestamp: Date.now(),
            payload: {
              deck_id: 'deck-1',
              model_name: 'Basic',
              fields: { Front: 'Q', Back: 'A' },
              tags: [],
            },
          },
        ],
      }),
    });

    expect(stalePush.status).toBe(409);
    const conflictBody = await stalePush.json();
    expect(conflictBody.error).toContain('Sync conflict');
    expect(conflictBody.guidance).toContain('/pull');
    expect(conflictBody.conflicts).toEqual([
      {
        entityId: 'deck-1',
        entityType: 'deck',
        incomingVersion: 1,
        currentVersion: 1,
        lastSyncedDeviceId: 'device-1',
        retryHint:
          'Pull the latest changes from the server, merge them locally, and retry the push with incremented versions.',
      },
    ]);

    const decks = await pool.query('SELECT name, description FROM decks');
    expect(decks.rows).toEqual([
      { name: 'Initial Deck', description: null },
    ]);

    const notes = await pool.query('SELECT * FROM notes');
    expect(notes.rows).toHaveLength(0);

    const syncMetaRows = await pool.query(
      'SELECT version, device_id FROM sync_meta WHERE entity_id = $1 ORDER BY version ASC',
      ['deck-1']
    );
    expect(syncMetaRows.rows).toHaveLength(1);
    expect(Number(syncMetaRows.rows[0].version)).toBe(1);
    expect(syncMetaRows.rows[0].device_id).toBe('device-1');
  });

  it('paginates pull responses using continuation tokens', async () => {
    const totalOps = 105;
    const baseTimestamp = Date.now();
    const ops = Array.from({ length: totalOps }, (_, index) => ({
      entityId: `deck-pagination-${index + 1}`,
      entityType: 'deck' as const,
      version: index + 1,
      op: 'create' as const,
      timestamp: baseTimestamp + index,
      payload: {
        name: `Deck ${index + 1}`,
        description: null,
        config: {},
      },
    }));

    const pushResponse = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'pagination-device', ops }),
    });

    expect(pushResponse.status).toBe(200);
    const pushBody = await pushResponse.json();
    expect(pushBody.currentVersion).toBe(totalOps);

    const firstPullResponse = await fetch(`${baseUrl}/pull`);
    expect(firstPullResponse.status).toBe(200);
    const firstPullBody = await firstPullResponse.json();

    expect(firstPullBody.ops.length).toBeGreaterThan(0);
    expect(firstPullBody.ops.length).toBeLessThan(totalOps);
    expect(firstPullBody.ops[0].version).toBe(1);
    expect(firstPullBody.hasMore).toBe(true);
    expect(firstPullBody.continuationToken).toBeTruthy();

    const firstPageSize = firstPullBody.ops.length;
    const continuationToken = firstPullBody.continuationToken as string;
    const secondPullResponse = await fetch(
      `${baseUrl}/pull?continuationToken=${encodeURIComponent(continuationToken)}`
    );

    expect(secondPullResponse.status).toBe(200);
    const secondPullBody = await secondPullResponse.json();

    expect(secondPullBody.ops).toHaveLength(totalOps - firstPageSize);
    expect(secondPullBody.ops[0].version).toBe(firstPageSize + 1);
    expect(secondPullBody.ops.at(-1)?.version).toBe(totalOps);
    expect(secondPullBody.hasMore).toBe(false);
    expect(secondPullBody.continuationToken).toBeNull();
    expect(secondPullBody.newVersion).toBe(totalOps);
  });

  it('supports UUID continuation tokens without throwing', async () => {
    const uuidIds = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ];

    await pool.query(
      `
        INSERT INTO sync_meta (id, user_id, entity_id, entity_type, version, op, timestamp, payload, device_id, diff)
        VALUES ($1, $2, $3, 'deck', 1, 'create', NOW(), $4, 'uuid-device', NULL),
               ($5, $2, $6, 'deck', 2, 'create', NOW(), $7, 'uuid-device', NULL);
      `,
      [
        uuidIds[0],
        TEST_USER_ID,
        'deck-uuid-1',
        { name: 'UUID Deck 1', description: null, config: {} },
        uuidIds[1],
        'deck-uuid-2',
        { name: 'UUID Deck 2', description: null, config: {} },
      ],
    );

    const firstResponse = await fetch(`${baseUrl}/pull?limit=1`);
    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.ops).toHaveLength(1);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.continuationToken).toBe(`1:${uuidIds[0]}`);

    const secondResponse = await fetch(
      `${baseUrl}/pull?limit=1&continuationToken=${encodeURIComponent(firstBody.continuationToken)}`,
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.ops).toHaveLength(1);
    expect(secondBody.ops[0].entityId).toBe('deck-uuid-2');
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.continuationToken).toBeNull();
  });

  it('returns session metadata including latest version and default pull limit', async () => {
    const beforeRequestTimestamp = Date.now();
    const initialResponse = await fetch(`${baseUrl}/session`);
    expect(initialResponse.status).toBe(200);
    const initialBody = await initialResponse.json();

    expect(initialBody.userId).toBe(TEST_USER_ID);
    expect(initialBody.latestVersion).toBe(0);
    expect(initialBody.defaultPullLimit).toBe(DEFAULT_PULL_LIMIT);
    expect(initialBody.serverTimestamp).toBeGreaterThanOrEqual(beforeRequestTimestamp);
    expect(initialBody.serverTimestamp).toBeLessThanOrEqual(Date.now());

    const pushResponse = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'session-device',
        ops: [
          {
            entityId: 'deck-session-1',
            entityType: 'deck',
            version: 1,
            op: 'create',
            timestamp: Date.now(),
            payload: {
              name: 'Session Deck',
              description: null,
              config: {},
            },
          },
        ],
      }),
    });

    expect(pushResponse.status).toBe(200);

    const afterPushResponse = await fetch(`${baseUrl}/session`);
    expect(afterPushResponse.status).toBe(200);
    const afterPushBody = await afterPushResponse.json();

    expect(afterPushBody.latestVersion).toBe(1);
    expect(afterPushBody.userId).toBe(TEST_USER_ID);
    expect(afterPushBody.defaultPullLimit).toBe(DEFAULT_PULL_LIMIT);
    expect(afterPushBody.serverTimestamp).toBeGreaterThanOrEqual(initialBody.serverTimestamp);
  });
});
