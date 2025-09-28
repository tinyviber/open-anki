import { describe, expect, it } from 'bun:test';
import { processPull, processPush } from '../src/routes/syncRoutes.js';

type QueryCall = { text: string; params: any[] };

describe('syncRoutes timestamp handling', () => {
    it('processPush converts millisecond payload timestamps to Date objects', async () => {
        const calls: QueryCall[] = [];
        const queryMock = async (text: string, params: any[] = []) => {
            calls.push({ text, params });
            return { rows: [], rowCount: 0 };
        };

        const cardDue = 1_700_000_000_000;
        const reviewTimestamp = 1_700_000_500_000;
        const opTimestamp = 1_700_001_000_000;

        const result = await processPush(queryMock, 'user-1', [
            {
                entityId: 'card-1',
                entityType: 'card',
                version: 1,
                op: 'create',
                timestamp: opTimestamp,
                payload: {
                    note_id: 'note-1',
                    ordinal: 0,
                    due: cardDue,
                    interval: 1,
                    ease_factor: 2.3,
                    reps: 2,
                    lapses: 0,
                    card_type: 2,
                    queue: 1,
                    original_due: 0,
                },
            },
            {
                entityId: 'log-1',
                entityType: 'review_log',
                version: 2,
                op: 'create',
                timestamp: opTimestamp + 1,
                payload: {
                    card_id: 'card-1',
                    timestamp: reviewTimestamp,
                    rating: 4,
                    duration_ms: 32,
                },
            },
        ]);

        expect(result.currentVersion).toBe(2);

        const syncMetaInsert = calls.filter((call) => call.text.includes('INSERT INTO sync_meta'));
        expect(syncMetaInsert.length).toBe(2);
        expect(syncMetaInsert[0].params[5]).toBeInstanceOf(Date);
        expect((syncMetaInsert[0].params[5] as Date).getTime()).toBe(opTimestamp);

        const cardInsert = calls.find((call) => call.text.includes('INSERT INTO cards'));
        expect(cardInsert).toBeDefined();
        expect(cardInsert!.params[4]).toBeInstanceOf(Date);
        expect((cardInsert!.params[4] as Date).getTime()).toBe(cardDue);

        const reviewInsert = calls.find((call) => call.text.includes('INSERT INTO review_logs'));
        expect(reviewInsert).toBeDefined();
        expect(reviewInsert!.params[3]).toBeInstanceOf(Date);
        expect((reviewInsert!.params[3] as Date).getTime()).toBe(reviewTimestamp);
    });

    it('processPull serializes entity timestamps as millisecond numbers', async () => {
        const cardDue = 1_700_010_000_000;
        const cardCreated = cardDue - 10_000;
        const cardUpdated = cardDue + 5_000;
        const reviewTimestamp = 1_700_020_000_000;
        const reviewCreated = reviewTimestamp + 3_000;
        const cardMetaTimestamp = 1_700_030_000_000;
        const reviewMetaTimestamp = 1_700_040_000_000;

        const metaRows = [
            {
                id: 'meta-1',
                entity_id: 'card-1',
                entity_type: 'card',
                version: 10,
                op: 'update',
                timestamp: new Date(cardMetaTimestamp),
                payload: null,
            },
            {
                id: 'meta-2',
                entity_id: 'review-1',
                entity_type: 'review_log',
                version: 11,
                op: 'create',
                timestamp: new Date(reviewMetaTimestamp),
                payload: null,
            },
        ];

        const cardRow = {
            id: 'card-1',
            user_id: 'user-1',
            note_id: 'note-1',
            ordinal: 0,
            due: new Date(cardDue),
            interval: 1,
            ease_factor: 2.5,
            reps: 5,
            lapses: 1,
            card_type: 2,
            queue: 1,
            original_due: 0,
            created_at: new Date(cardCreated),
            updated_at: new Date(cardUpdated),
        };

        const reviewRow = {
            id: 'review-1',
            user_id: 'user-1',
            card_id: 'card-1',
            timestamp: new Date(reviewTimestamp),
            rating: 4,
            duration_ms: 42,
            created_at: new Date(reviewCreated),
        };

        const queryMock = async (text: string, params: any[] = []) => {
            if (text.includes('FROM sync_meta')) {
                return { rows: metaRows, rowCount: metaRows.length };
            }

            if (text.includes('FROM cards')) {
                expect(params[0]).toBe('card-1');
                return { rows: [cardRow], rowCount: 1 };
            }

            if (text.includes('FROM review_logs')) {
                expect(params[0]).toBe('review-1');
                return { rows: [reviewRow], rowCount: 1 };
            }

            return { rows: [], rowCount: 0 };
        };

        const result = await processPull(queryMock, 'user-1', 0);
        expect(result.ops.length).toBe(2);

        const cardOp = result.ops.find((op: any) => op.entity_id === 'card-1');
        expect(cardOp).toBeDefined();
        expect(typeof cardOp.timestamp).toBe('number');
        expect(cardOp.timestamp).toBe(cardMetaTimestamp);
        expect(cardOp.payload.due).toBe(cardDue);
        expect(cardOp.payload.created_at).toBe(cardCreated);
        expect(cardOp.payload.updated_at).toBe(cardUpdated);

        const reviewOp = result.ops.find((op: any) => op.entity_id === 'review-1');
        expect(reviewOp).toBeDefined();
        expect(typeof reviewOp.timestamp).toBe('number');
        expect(reviewOp.timestamp).toBe(reviewMetaTimestamp);
        expect(reviewOp.payload.timestamp).toBe(reviewTimestamp);
        expect(reviewOp.payload.created_at).toBe(reviewCreated);
    });
});
