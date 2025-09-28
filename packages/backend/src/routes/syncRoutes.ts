import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { query } from '../db/pg-service.js';

type EntityType = 'deck' | 'note' | 'card' | 'review_log';

interface OpLog {
    entityId: string;
    entityType: EntityType;

    version: number;
    op: 'create' | 'update' | 'delete';
    timestamp: number;
    payload?: Record<string, unknown>;
}

export type SyncOpLog = OpLog;

interface DeckContract {
    id: string;
    name: string;
    description: string | null;
    config: Record<string, unknown>;
    created_at: number;
    updated_at: number;
}

interface NoteContract {
    id: string;
    deck_id: string;
    model_name: string;
    fields: Record<string, unknown>;
    tags: string[];
    created_at: number;
    updated_at: number;
}

interface CardContract {
    id: string;
    note_id: string;
    ordinal: number;
    due: number;
    interval: number;
    ease_factor: number;
    reps: number;
    lapses: number;
    card_type: number;
    queue: number;
    original_due: number;
    created_at: number;
    updated_at: number;
}

interface ReviewLogContract {
    id: string;
    card_id: string;
    timestamp: number;
    rating: number;
    duration_ms: number | null;
    created_at: number;
}

type EntityContract = DeckContract | NoteContract | CardContract | ReviewLogContract;

interface SyncMetaRow {
    id: string;
    entity_id: string;
    entity_type: EntityType;
    version: number | string;
    op: 'create' | 'update' | 'delete';
    timestamp: Date | string | number | null;
    payload: unknown;
}

interface SyncOpContract {
    id: string;
    entityId: string;
    entityType: EntityType;
    version: number;
    op: 'create' | 'update' | 'delete';
    timestamp: number;
    payload?: EntityContract;
}

interface PushBody {
    deviceId: string;
    ops: OpLog[]; 
}

interface PullQuery {
    sinceVersion: string;
}

export const syncRoutes: FastifyPluginAsync = async (fastify, _opts) => {

    fastify.post<{ Body: PushBody }>(
      '/push',
      { schema: { 
          body: {
              type: 'object',
              required: ['deviceId', 'ops'],
              properties: { 
                  deviceId: { type: 'string' }, 
                  ops: { type: 'array', items: {
                      type: 'object',
                      required: ['entityId', 'entityType', 'version', 'op', 'timestamp'],
                      properties: {
                          entityId: { type: 'string' },
                          entityType: { type: 'string', enum: ['deck', 'note', 'card', 'review_log'] },
                          version: { type: 'number' },
                          op: { type: 'string', enum: ['create', 'update', 'delete'] },
                          timestamp: { type: 'number' }
                      }
                  } }
              } 
          },
      }},
      async (request: FastifyRequest<{ Body: PushBody }>, reply) => {
        const userId = request.user.id;
        const { ops } = request.body;

        try {
            await query('BEGIN'); 

            for (const op of ops) {
                if (!op.version) { op.version = Date.now(); } // Fallback

                // 1. Write to sync_meta (for conflict resolution/versioning)
                const syncMetaInsert = `
                    INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op, timestamp, payload)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (entity_id, version) DO NOTHING;
                `;
                const timestampValue = Number.isFinite(op.timestamp) ? op.timestamp : Date.now();
                const timestamp = new Date(timestampValue);

                await query(syncMetaInsert, [
                    userId, op.entityId, op.entityType, op.version, op.op, timestamp, op.payload || null
                ]);

                // 2. Handle entity operations based on type and operation
                if (op.entityType === 'deck') {
                    await handleDeckOperation(userId, op);
                } else if (op.entityType === 'note') {
                    await handleNoteOperation(userId, op);
                } else if (op.entityType === 'card') {
                    await handleCardOperation(userId, op);
                } else if (op.entityType === 'review_log') {
                    await handleReviewLogOperation(userId, op);
                }

                latestVersion = Math.max(latestVersion, op.version);
            }

            await query('COMMIT'); 
            
            return reply.send({ message: `${ops.length} ops processed.`, currentVersion: latestVersion });
        } catch (error: any) {
            await query('ROLLBACK');
            fastify.log.error({ err: error }, 'Sync Push Transaction failed');
            return reply.code(500).send({ error: 'Synchronization failed due to a server error.' });
        }
    });

    fastify.get<{ Querystring: PullQuery }>(
      '/pull',
      { schema: { 
          querystring: { 
              type: 'object', 
              required: ['sinceVersion'],
              properties: { 
                  sinceVersion: { type: 'string' } 
              } 
          }
      }},
      async (request: FastifyRequest<{ Querystring: PullQuery }>, reply) => {
        const userId = request.user.id; 
        const sinceVersion = parseInt(request.query.sinceVersion, 10);
        
        if (isNaN(sinceVersion)) {
            reply.code(400).send({ error: 'Invalid or missing sinceVersion parameter.' });
            return;
        }

        try {
            const response = await processPullOperations(userId, sinceVersion);
            return reply.send(response);

        } catch (error: any) {
            fastify.log.error(error, "Sync Pull failed");
            reply.code(500).send({ error: 'Error pulling changes.' });
        }
    });
};

export async function processPushOperations(userId: string, ops: OpLog[] | undefined): Promise<{ message: string; currentVersion: number }> {
    if (!ops || ops.length === 0) {
        return { message: 'No operations received.', currentVersion: Date.now() };
    }

    let latestVersion = 0;

    await query('BEGIN');

    try {
        for (const op of ops) {
            if (!op.version) { op.version = Date.now(); }

            const syncMetaInsert = `
                INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op, timestamp, payload)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (entity_id, version) DO NOTHING;
            `;
            const syncTimestamp = normalizeToDate(op.timestamp ?? op.version ?? Date.now());
            await query(syncMetaInsert, [
                userId, op.entityId, op.entityType, op.version, op.op, syncTimestamp, op.payload || null
            ]);

            if (op.entityType === 'deck') {
                await handleDeckOperation(userId, op);
            } else if (op.entityType === 'note') {
                await handleNoteOperation(userId, op);
            } else if (op.entityType === 'card') {
                await handleCardOperation(userId, op);
            } else if (op.entityType === 'review_log') {
                await handleReviewLogOperation(userId, op);
            }

            latestVersion = Math.max(latestVersion, op.version);
        }

        await query('COMMIT');

        return { message: `${ops.length} ops processed.`, currentVersion: latestVersion };
    } catch (error) {
        await query('ROLLBACK');
        throw error;
    }
}

export async function processPullOperations(userId: string, sinceVersion: number): Promise<{ ops: SyncOpContract[]; newVersion: number }> {
    const metaResults = await query(
        `
        SELECT id, entity_id, entity_type, version, op, timestamp, payload
        FROM sync_meta
        WHERE user_id = $1 AND version > $2
        ORDER BY version ASC;
        `,
        [userId, sinceVersion]
    );

    const ops: SyncOpContract[] = [];

    for (const metaRow of metaResults.rows as SyncMetaRow[]) {
        let payload: EntityContract | null = null;

        if (metaRow.op === 'create' || metaRow.op === 'update') {
            payload = await fetchEntityData(userId, metaRow.entity_id, metaRow.entity_type);
        }

        const serialized = serializeSyncMeta(metaRow, payload || undefined);
        ops.push(serialized);
    }

    const highestVersion = ops.length > 0 ? ops[ops.length - 1].version : sinceVersion;

    return {
        ops,
        newVersion: highestVersion,
    };
}

// Helper functions to handle different entity types
async function handleDeckOperation(userId: string, op: OpLog) {
    if (!op.payload) return;

    if (op.op === 'create') {
        const insertQuery = `
            INSERT INTO decks (id, user_id, name, description, config)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO NOTHING;
        `;
        await query(insertQuery, [
            op.entityId, userId, op.payload.name, op.payload.description, op.payload.config || {}
        ]);
    } else if (op.op === 'update') {
        const updateQuery = `
            UPDATE decks
            SET name = $1, description = $2, config = $3, updated_at = NOW()
            WHERE id = $4 AND user_id = $5;
        `;
        await query(updateQuery, [
            op.payload.name, op.payload.description, op.payload.config || {}, op.entityId, userId
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM decks
            WHERE id = $1 AND user_id = $2;
        `;
        await query(deleteQuery, [op.entityId, userId]);
    }
}

async function handleNoteOperation(userId: string, op: OpLog) {
    if (!op.payload) return;

    if (op.op === 'create') {
        const insertQuery = `
            INSERT INTO notes (id, user_id, deck_id, model_name, fields, tags)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING;
        `;
        await query(insertQuery, [
            op.entityId, userId, op.payload.deck_id, op.payload.model_name, 
            op.payload.fields, op.payload.tags || []
        ]);
    } else if (op.op === 'update') {
        const updateQuery = `
            UPDATE notes
            SET deck_id = $1, model_name = $2, fields = $3, tags = $4, updated_at = NOW()
            WHERE id = $5 AND user_id = $6;
        `;
        await query(updateQuery, [
            op.payload.deck_id, op.payload.model_name, op.payload.fields, 
            op.payload.tags || [], op.entityId, userId
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM notes
            WHERE id = $1 AND user_id = $2;
        `;
        await query(deleteQuery, [op.entityId, userId]);
    }
}

async function handleCardOperation(userId: string, op: OpLog) {
    if (!op.payload) return;

    if (op.op === 'create') {
        const insertQuery = `
            INSERT INTO cards (id, user_id, note_id, ordinal, due, interval, ease_factor,
                              reps, lapses, card_type, queue, original_due)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO NOTHING;
        `;
        const dueDate = normalizeToDate(op.payload.due);
        await query(insertQuery, [
            op.entityId, userId, op.payload.note_id, op.payload.ordinal,
            dueDate, op.payload.interval || 0, op.payload.ease_factor || 2.5,
            op.payload.reps || 0, op.payload.lapses || 0, op.payload.card_type || 0,
            op.payload.queue || 0, op.payload.original_due || 0
        ]);
    } else if (op.op === 'update') {
        const updateQuery = `
            UPDATE cards
            SET note_id = $1, ordinal = $2, due = $3, interval = $4, ease_factor = $5,
                reps = $6, lapses = $7, card_type = $8, queue = $9, original_due = $10, updated_at = NOW()
            WHERE id = $11 AND user_id = $12;
        `;
        const dueDate = normalizeToDate(op.payload.due);
        await query(updateQuery, [
            op.payload.note_id, op.payload.ordinal, dueDate, op.payload.interval,
            op.payload.ease_factor, op.payload.reps, op.payload.lapses,
            op.payload.card_type, op.payload.queue, op.payload.original_due || 0,
            op.entityId, userId
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM cards
            WHERE id = $1 AND user_id = $2;
        `;
        await query(deleteQuery, [op.entityId, userId]);
    }
}

async function handleReviewLogOperation(userId: string, op: OpLog) {
    if (!op.payload) return;

    if (op.op === 'create') {
        const insertQuery = `
            INSERT INTO review_logs (id, user_id, card_id, timestamp, rating, duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING;
        `;
        const reviewTimestamp = normalizeToDate(op.payload.timestamp);
        await query(insertQuery, [
            op.entityId, userId, op.payload.card_id, reviewTimestamp,
            op.payload.rating, op.payload.duration_ms
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM review_logs
            WHERE id = $1 AND user_id = $2;
        `;
        await query(deleteQuery, [op.entityId, userId]);
    }
    // Note: Review logs typically don't get updated, only created/deleted
}

// Helper function to fetch entity data for pull operations
async function fetchEntityData(userId: string, entityId: string, entityType: EntityType): Promise<EntityContract | null> {
    if (entityType === 'deck') {
        const result = await query(
            'SELECT * FROM decks WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0] as DeckRow | undefined;
        return row ? serializeDeckRow(row) : null;
    } else if (entityType === 'note') {
        const result = await query(
            'SELECT * FROM notes WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0] as NoteRow | undefined;
        return row ? serializeNoteRow(row) : null;
    } else if (entityType === 'card') {
        const result = await query(
            'SELECT * FROM cards WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0] as CardRow | undefined;
        return row ? serializeCardRow(row) : null;
    } else if (entityType === 'review_log') {
        const result = await query(
            'SELECT * FROM review_logs WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0] as ReviewLogRow | undefined;
        return row ? serializeReviewLogRow(row) : null;
    }
    return null;
}

interface DeckRow {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    config: unknown;
    created_at: Date | string | number | null;
    updated_at: Date | string | number | null;
}

interface NoteRow {
    id: string;
    user_id: string;
    deck_id: string;
    model_name: string;
    fields: unknown;
    tags: string[] | null;
    created_at: Date | string | number | null;
    updated_at: Date | string | number | null;
}

interface CardRow {
    id: string;
    user_id: string;
    note_id: string;
    ordinal: number;
    due: Date | string | number | null;
    interval: number | string | null;
    ease_factor: number | string | null;
    reps: number | string | null;
    lapses: number | string | null;
    card_type: number | string | null;
    queue: number | string | null;
    original_due: number | string | null;
    created_at: Date | string | number | null;
    updated_at: Date | string | number | null;
}

interface ReviewLogRow {
    id: string;
    user_id: string;
    card_id: string;
    timestamp: Date | string | number | null;
    rating: number | string;
    duration_ms: number | string | null;
    created_at: Date | string | number | null;
}

function serializeSyncMeta(row: SyncMetaRow, payload?: EntityContract): SyncOpContract {
    const op: SyncOpContract = {
        id: row.id,
        entityId: row.entity_id,
        entityType: row.entity_type,
        version: typeof row.version === 'number' ? row.version : Number(row.version),
        op: row.op,
        timestamp: ensureMillis(row.timestamp),
    };

    if (payload) {
        op.payload = payload;
    }

    return op;
}

function serializeDeckRow(row: DeckRow): DeckContract {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        config: toRecord(row.config),
        created_at: ensureMillis(row.created_at),
        updated_at: ensureMillis(row.updated_at),
    };
}

function serializeNoteRow(row: NoteRow): NoteContract {
    return {
        id: row.id,
        deck_id: row.deck_id,
        model_name: row.model_name,
        fields: toRecord(row.fields),
        tags: Array.isArray(row.tags) ? row.tags : [],
        created_at: ensureMillis(row.created_at),
        updated_at: ensureMillis(row.updated_at),
    };
}

function serializeCardRow(row: CardRow): CardContract {
    return {
        id: row.id,
        note_id: row.note_id,
        ordinal: Number(row.ordinal ?? 0),
        due: ensureMillis(row.due),
        interval: Number(row.interval ?? 0),
        ease_factor: Number(row.ease_factor ?? 0),
        reps: Number(row.reps ?? 0),
        lapses: Number(row.lapses ?? 0),
        card_type: Number(row.card_type ?? 0),
        queue: Number(row.queue ?? 0),
        original_due: Number(row.original_due ?? 0),
        created_at: ensureMillis(row.created_at),
        updated_at: ensureMillis(row.updated_at),
    };
}

function serializeReviewLogRow(row: ReviewLogRow): ReviewLogContract {
    return {
        id: row.id,
        card_id: row.card_id,
        timestamp: ensureMillis(row.timestamp),
        rating: Number(row.rating ?? 0),
        duration_ms: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
        created_at: ensureMillis(row.created_at),
    };
}

function ensureMillis(value: Date | string | number | null | undefined): number {
    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    if (value === null || value === undefined) {
        return 0;
    }

    const parsed = new Date(value as any).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
}

function toRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Ignore JSON parse errors and fall through to default
        }
    }

    return {};
}

function normalizeToDate(value: unknown): Date {
    if (value instanceof Date) {
        return value;
    }

    if (typeof value === 'number') {
        return new Date(value);
    }

    if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return new Date();
}