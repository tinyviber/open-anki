import { describe, beforeAll, beforeEach, it, expect, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

const db = newDb({ autoCreateForeignKeyIndices: true });
const pgAdapter = db.adapters.createPg();
const { Pool } = pgAdapter;
const pool = new Pool();

vi.mock('../db/pg-service.js', () => ({
    pool,
    query: (text: string, params: any[] = []) => pool.query(text, params),
}));

const { query } = await import('../db/pg-service.js');
const syncRoutesModule = await import('./syncRoutes.js');
const { handleCardOperation, handleReviewLogOperation } = syncRoutesModule;
type OpLog = syncRoutesModule.OpLog;

describe('sync timestamp normalization', () => {
    beforeAll(async () => {
        await pool.query(`
            CREATE TABLE cards (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL,
                note_id UUID NOT NULL,
                ordinal INTEGER NOT NULL,
                due TIMESTAMPTZ NOT NULL,
                interval INTEGER DEFAULT 0,
                ease_factor REAL DEFAULT 2.5,
                reps INTEGER DEFAULT 0,
                lapses INTEGER DEFAULT 0,
                card_type INTEGER DEFAULT 0,
                queue INTEGER DEFAULT 0,
                original_due INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        await pool.query(`
            CREATE TABLE review_logs (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL,
                card_id UUID NOT NULL,
                timestamp TIMESTAMPTZ NOT NULL,
                rating INTEGER NOT NULL,
                duration_ms INTEGER
            );
        `);
    });

    beforeEach(async () => {
        await query('DELETE FROM review_logs');
        await query('DELETE FROM cards');
    });

    it('stores card due timestamps provided in milliseconds without coercion', async () => {
        const userId = randomUUID();
        const cardId = randomUUID();
        const noteId = randomUUID();
        const dueMs = 0; // verify zero does not trigger fallback

        const op: OpLog = {
            entityId: cardId,
            entityType: 'card',
            version: Date.now(),
            op: 'create',
            timestamp: Date.now(),
            payload: {
                note_id: noteId,
                ordinal: 0,
                due: dueMs,
                interval: 1,
                ease_factor: 2.5,
                reps: 0,
                lapses: 0,
                card_type: 0,
                queue: 0,
                original_due: 0,
            },
        };

        await handleCardOperation(userId, op);

        const result = await query('SELECT due, original_due FROM cards WHERE id = $1', [cardId]);
        expect(result.rowCount).toBe(1);
        expect(new Date(result.rows[0].due).getTime()).toBe(dueMs);
        expect(result.rows[0].original_due).toBe(0);
    });

    it('stores review log timestamps provided in milliseconds without errors', async () => {
        const userId = randomUUID();
        const cardId = randomUUID();
        const noteId = randomUUID();
        const reviewId = randomUUID();
        const dueMs = 1_725_000_000_000;
        const reviewTimestamp = 1_726_000_000_000;

        const cardOp: OpLog = {
            entityId: cardId,
            entityType: 'card',
            version: Date.now(),
            op: 'create',
            timestamp: Date.now(),
            payload: {
                note_id: noteId,
                ordinal: 0,
                due: dueMs,
                interval: 1,
                ease_factor: 2.5,
                reps: 0,
                lapses: 0,
                card_type: 0,
                queue: 0,
                original_due: 0,
            },
        };

        await handleCardOperation(userId, cardOp);

        const reviewOp: OpLog = {
            entityId: reviewId,
            entityType: 'review_log',
            version: Date.now(),
            op: 'create',
            timestamp: Date.now(),
            payload: {
                card_id: cardId,
                timestamp: reviewTimestamp,
                rating: 4,
                duration_ms: 1200,
            },
        };

        await handleReviewLogOperation(userId, reviewOp);

        const result = await query('SELECT timestamp FROM review_logs WHERE id = $1', [reviewId]);
        expect(result.rowCount).toBe(1);
        expect(new Date(result.rows[0].timestamp).getTime()).toBe(reviewTimestamp);
    });
});
