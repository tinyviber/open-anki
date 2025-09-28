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
        UNIQUE(user_id, entity_id, version)
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
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    setTestPool(null);
  });

  it('stores millisecond timestamps as dates and returns them during pull', async () => {
    const timestampMillis = Date.now();
    const dueMillis = timestampMillis + 1_000;
    const originalDueMillis = timestampMillis + 2_000;
    const reviewTimestampMillis = timestampMillis + 3_000;

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
            timestamp: timestampMillis,
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
            timestamp: timestampMillis + 1,
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
            timestamp: timestampMillis + 2,
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
            timestamp: timestampMillis + 3,
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

    const metaRows = await pool.query('SELECT entity_type, version, timestamp FROM sync_meta ORDER BY version ASC');
    expect(metaRows.rows).toHaveLength(4);
    metaRows.rows.forEach((row, index) => {
      expect(row.timestamp).toBeInstanceOf(Date);
      expect((row.timestamp as Date).getTime()).toBe(timestampMillis + index);
    });

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

    const pullResponse = await fetch(`${baseUrl}/pull?sinceVersion=0`);
    expect(pullResponse.status).toBe(200);
    const body = await pullResponse.json();
    expect(body.ops).toHaveLength(4);

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
});
