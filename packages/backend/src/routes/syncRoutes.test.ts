import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { processPullOperations, processPushOperations, SyncOpLog } from './syncRoutes.js';
import { resetQueryClient, setQueryClient } from '../db/pg-service.js';

type QueryResultRow = Record<string, unknown>;

type SyncMetaState = {
    id: string;
    user_id: string;
    entity_id: string;
    entity_type: 'deck' | 'note' | 'card' | 'review_log';
    version: number;
    op: 'create' | 'update' | 'delete';
    timestamp: Date | null;
    payload: unknown;
};

type DeckState = {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    config: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
};

type NoteState = {
    id: string;
    user_id: string;
    deck_id: string;
    model_name: string;
    fields: Record<string, unknown>;
    tags: string[];
    created_at: Date;
    updated_at: Date;
};

type CardState = {
    id: string;
    user_id: string;
    note_id: string;
    ordinal: number;
    due: Date;
    interval: number;
    ease_factor: number;
    reps: number;
    lapses: number;
    card_type: number;
    queue: number;
    original_due: number;
    created_at: Date;
    updated_at: Date;
};

type ReviewLogState = {
    id: string;
    user_id: string;
    card_id: string;
    timestamp: Date;
    rating: number;
    duration_ms: number | null;
    created_at: Date;
};

type FakeDbState = {
    syncMeta: SyncMetaState[];
    decks: Map<string, DeckState>;
    notes: Map<string, NoteState>;
    cards: Map<string, CardState>;
    reviewLogs: Map<string, ReviewLogState>;
};

type FakeQueryResult = { rows: QueryResultRow[] };

type FakeQuery = (text: string, params?: unknown[]) => Promise<FakeQueryResult>;

const baseTimestamp = Date.UTC(2024, 0, 1);

const createFakeDbClient = () => {
    const state: FakeDbState = {
        syncMeta: [],
        decks: new Map(),
        notes: new Map(),
        cards: new Map(),
        reviewLogs: new Map(),
    };

    let syncMetaCounter = 0;
    let deckCounter = 0;
    let noteCounter = 0;
    let cardCounter = 0;
    let reviewCounter = 0;

    const makeTimestamp = (offset: number) => new Date(baseTimestamp + offset);

    const query: FakeQuery = async (text, params = []) => {
        const normalized = normalizeSql(text);

        if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
            return { rows: [] };
        }

        if (normalized.startsWith('insert into sync_meta')) {
            const [userId, entityId, entityType, version, op, timestamp, payload] = params as [
                string,
                string,
                'deck' | 'note' | 'card' | 'review_log',
                number,
                'create' | 'update' | 'delete',
                Date | null,
                unknown,
            ];
            const entry: SyncMetaState = {
                id: `sync-${++syncMetaCounter}`,
                user_id: userId,
                entity_id: entityId,
                entity_type: entityType,
                version,
                op,
                timestamp: timestamp ? new Date(timestamp) : null,
                payload,
            };
            state.syncMeta.push(entry);
            return { rows: [] };
        }

        if (normalized.startsWith('insert into decks')) {
            const [id, userId, name, description, config] = params as [
                string,
                string,
                string,
                string | null,
                Record<string, unknown> | null,
            ];
            const createdAt = makeTimestamp(++deckCounter);
            state.decks.set(id, {
                id,
                user_id: userId,
                name,
                description: description ?? null,
                config: config ?? {},
                created_at: createdAt,
                updated_at: createdAt,
            });
            return { rows: [] };
        }

        if (normalized.startsWith('insert into notes')) {
            const [id, userId, deckId, modelName, fields, tags] = params as [
                string,
                string,
                string,
                string,
                Record<string, unknown>,
                string[] | null,
            ];
            const createdAt = makeTimestamp(++noteCounter);
            state.notes.set(id, {
                id,
                user_id: userId,
                deck_id: deckId,
                model_name: modelName,
                fields: fields ?? {},
                tags: tags ?? [],
                created_at: createdAt,
                updated_at: createdAt,
            });
            return { rows: [] };
        }

        if (normalized.startsWith('insert into cards')) {
            const [
                id,
                userId,
                noteId,
                ordinal,
                due,
                interval,
                easeFactor,
                reps,
                lapses,
                cardType,
                queue,
                originalDue,
            ] = params as [
                string,
                string,
                string,
                number,
                Date,
                number,
                number,
                number,
                number,
                number,
                number,
                number,
            ];
            const createdAt = makeTimestamp(++cardCounter);
            state.cards.set(id, {
                id,
                user_id: userId,
                note_id: noteId,
                ordinal,
                due: new Date(due),
                interval,
                ease_factor: easeFactor,
                reps,
                lapses,
                card_type: cardType,
                queue,
                original_due: originalDue,
                created_at: createdAt,
                updated_at: createdAt,
            });
            return { rows: [] };
        }

        if (normalized.startsWith('insert into review_logs')) {
            const [id, userId, cardId, timestamp, rating, duration] = params as [
                string,
                string,
                string,
                Date,
                number,
                number | null,
            ];
            const createdAt = makeTimestamp(++reviewCounter);
            state.reviewLogs.set(id, {
                id,
                user_id: userId,
                card_id: cardId,
                timestamp: new Date(timestamp),
                rating,
                duration_ms: duration ?? null,
                created_at: createdAt,
            });
            return { rows: [] };
        }

        if (normalized.startsWith('select id, entity_id, entity_type, version, op, timestamp, payload from sync_meta')) {
            const [userId, sinceVersion] = params as [string, number];
            const rows = state.syncMeta
                .filter((row) => row.user_id === userId && row.version > sinceVersion)
                .sort((a, b) => a.version - b.version)
                .map((row) => ({
                    id: row.id,
                    entity_id: row.entity_id,
                    entity_type: row.entity_type,
                    version: row.version,
                    op: row.op,
                    timestamp: row.timestamp,
                    payload: row.payload,
                }));
            return { rows };
        }

        if (normalized.startsWith('select * from decks where')) {
            const [id, userId] = params as [string, string];
            const deck = state.decks.get(id);
            if (deck && deck.user_id === userId) {
                return { rows: [clone(deck)] };
            }
            return { rows: [] };
        }

        if (normalized.startsWith('select * from notes where')) {
            const [id, userId] = params as [string, string];
            const note = state.notes.get(id);
            if (note && note.user_id === userId) {
                return { rows: [clone(note)] };
            }
            return { rows: [] };
        }

        if (normalized.startsWith('select * from cards where')) {
            const [id, userId] = params as [string, string];
            const card = state.cards.get(id);
            if (card && card.user_id === userId) {
                return { rows: [clone(card)] };
            }
            return { rows: [] };
        }

        if (normalized.startsWith('select * from review_logs where')) {
            const [id, userId] = params as [string, string];
            const reviewLog = state.reviewLogs.get(id);
            if (reviewLog && reviewLog.user_id === userId) {
                return { rows: [clone(reviewLog)] };
            }
            return { rows: [] };
        }

        throw new Error(`Unhandled query: ${normalized}`);
    };

    return { query };
};

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase();

const clone = <T extends Record<string, unknown>>(value: T): T => ({ ...value });

describe('syncRoutes serialization', () => {
    const userId = 'test-user';
    let fakeClient: ReturnType<typeof createFakeDbClient>;

    beforeEach(() => {
        fakeClient = createFakeDbClient();
        setQueryClient({ query: fakeClient.query as any });
    });

    afterEach(() => {
        resetQueryClient();
    });

    it('returns numeric timestamps in pull payloads', async () => {
        const deckId = 'deck-1';
        const noteId = 'note-1';
        const cardId = 'card-1';
        const reviewId = 'review-1';
        const cardDueMs = baseTimestamp + 60_000;
        const reviewTimestampMs = baseTimestamp + 120_000;
        const metaTimestampMs = baseTimestamp + 180_000;

        const pushOps: SyncOpLog[] = [
            {
                entityId: deckId,
                entityType: 'deck',
                version: metaTimestampMs - 3,
                op: 'create',
                timestamp: metaTimestampMs - 3,
                payload: {
                    name: 'Deck Name',
                    description: null,
                    config: { newCards: 20 },
                },
            },
            {
                entityId: noteId,
                entityType: 'note',
                version: metaTimestampMs - 2,
                op: 'create',
                timestamp: metaTimestampMs - 2,
                payload: {
                    deck_id: deckId,
                    model_name: 'Basic',
                    fields: { Front: 'Q', Back: 'A' },
                    tags: ['tag'],
                },
            },
            {
                entityId: cardId,
                entityType: 'card',
                version: metaTimestampMs - 1,
                op: 'create',
                timestamp: metaTimestampMs - 1,
                payload: {
                    note_id: noteId,
                    ordinal: 0,
                    due: new Date(cardDueMs),
                    interval: 1,
                    ease_factor: 2.5,
                    reps: 1,
                    lapses: 0,
                    card_type: 2,
                    queue: 0,
                    original_due: 0,
                },
            },
            {
                entityId: reviewId,
                entityType: 'review_log',
                version: metaTimestampMs,
                op: 'create',
                timestamp: metaTimestampMs,
                payload: {
                    card_id: cardId,
                    timestamp: new Date(reviewTimestampMs),
                    rating: 4,
                    duration_ms: 1500,
                },
            },
        ];

        const pushResult = await processPushOperations(userId, pushOps);
        expect(pushResult.currentVersion).toBe(metaTimestampMs);
        expect(pushResult.message).toBe(`${pushOps.length} ops processed.`);

        const pullResult = await processPullOperations(userId, 0);
        const ops = pullResult.ops as Array<Record<string, any>>;

        expect(Array.isArray(ops)).toBe(true);
        expect(ops).toHaveLength(pushOps.length);
        expect(ops.every((op) => typeof op.timestamp === 'number')).toBe(true);

        const cardOp = ops.find((op) => op.entityType === 'card');
        expect(cardOp).toBeTruthy();
        expect(cardOp!.timestamp).toBe(metaTimestampMs - 1);
        expect(cardOp!.payload).toBeTruthy();
        expect(cardOp!.payload.due).toBe(cardDueMs);
        expect(typeof cardOp!.payload.created_at).toBe('number');
        expect('user_id' in cardOp!.payload).toBe(false);

        const reviewOp = ops.find((op) => op.entityType === 'review_log');
        expect(reviewOp).toBeTruthy();
        expect(reviewOp!.timestamp).toBe(metaTimestampMs);
        expect(reviewOp!.payload.timestamp).toBe(reviewTimestampMs);
        expect(typeof reviewOp!.payload.created_at).toBe('number');
        expect('user_id' in reviewOp!.payload).toBe(false);

        const deckOp = ops.find((op) => op.entityType === 'deck');
        expect(deckOp).toBeTruthy();
        expect(typeof deckOp!.payload.created_at).toBe('number');
        expect(typeof deckOp!.payload.updated_at).toBe('number');

        const noteOp = ops.find((op) => op.entityType === 'note');
        expect(noteOp).toBeTruthy();
        expect(typeof noteOp!.payload.created_at).toBe('number');
        expect(noteOp!.payload.tags).toEqual(['tag']);

        expect(pullResult.newVersion).toBe(metaTimestampMs);
    });
});
