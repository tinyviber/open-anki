import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { getQueryClient, query, type QueryClient } from '../db/pg-service.js';

type EntityType = 'deck' | 'note' | 'card' | 'review_log';
type OperationType = 'create' | 'update' | 'delete';

interface DeckPayload {
    name: string;
    description?: string | null;
    config?: Record<string, unknown> | null;
}

interface NotePayload {
    deck_id: string;
    model_name: string;
    fields: Record<string, unknown>;
    tags?: string[] | null;
}

interface CardPayload {
    note_id: string;
    ordinal: number;
    due?: number | null;
    interval?: number | null;
    ease_factor?: number | null;
    reps?: number | null;
    lapses?: number | null;
    card_type?: number | null;
    queue?: number | null;
    original_due?: number | null;
}

interface ReviewLogPayload {
    card_id: string;
    timestamp?: number | null;
    rating: number;
    duration_ms?: number | null;
}

interface BaseOp {
    entityId: string;
    entityType: EntityType;
    version: number;
    op: OperationType;
    timestamp: number;
}

type CreateOrUpdateOp<TPayload> = BaseOp & {
    op: 'create' | 'update';
    payload: TPayload;
};

type DeleteOp = BaseOp & {
    op: 'delete';
    payload?: undefined;
};

type DeckOp = (CreateOrUpdateOp<DeckPayload> | DeleteOp) & { entityType: 'deck' };
type NoteOp = (CreateOrUpdateOp<NotePayload> | DeleteOp) & { entityType: 'note' };
type CardOp = (CreateOrUpdateOp<CardPayload> | DeleteOp) & { entityType: 'card' };
type ReviewLogOp = (CreateOrUpdateOp<ReviewLogPayload> | DeleteOp) & { entityType: 'review_log' };

type SyncOp = DeckOp | NoteOp | CardOp | ReviewLogOp;

interface PushBody {
    deviceId: string;
    ops: SyncOp[];
}

interface PullQuery {
    sinceVersion: string;
}

interface PullResponse {
    ops: SyncOp[];
    newVersion: number;
}

interface SyncMetaRow {
    entity_id: string;
    entity_type: EntityType;
    version: number;
    op: OperationType;
    timestamp: Date | string | number;
    payload?: Record<string, unknown> | null;
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
        const { deviceId, ops } = request.body;
        
        if (!ops || ops.length === 0) {
            return { message: "No operations received.", currentVersion: Date.now() };
        }

        let latestVersion = 0;

        const client = await getQueryClient();

        try {
            await client.query('BEGIN');

            for (const op of ops) {
                if (op.version == null) { op.version = Date.now(); }

                // 1. Write to sync_meta (for conflict resolution/versioning)
                const syncMetaInsert = `
                    INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op, timestamp, payload)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (user_id, entity_id, version) DO NOTHING;
                `;
                const timestampValue = Number.isFinite(op.timestamp) ? op.timestamp : Date.now();
                const timestamp = new Date(timestampValue);

                await client.query(syncMetaInsert, [
                    userId,
                    op.entityId,
                    op.entityType,
                    op.version,
                    op.op,
                    timestamp,
                    op.payload ?? null
                ]);

                // 2. Handle entity operations based on type and operation
                switch (op.entityType) {
                    case 'deck':
                        await handleDeckOperation(client, userId, op);
                        break;
                    case 'note':
                        await handleNoteOperation(client, userId, op);
                        break;
                    case 'card':
                        await handleCardOperation(client, userId, op);
                        break;
                    case 'review_log':
                        await handleReviewLogOperation(client, userId, op);
                        break;
                }

                latestVersion = Math.max(latestVersion, op.version);
            }

            await client.query('COMMIT');

            return reply.send({ message: `${ops.length} ops processed.`, currentVersion: latestVersion });
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                fastify.log.error({ err: rollbackError }, 'Rollback failed');
            }
            fastify.log.error({ err: error }, 'Sync Push Transaction failed');
            return reply.code(500).send({ error: 'Synchronization failed due to a server error.' });
        } finally {
            client.release();
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
            // Fetch SyncMeta records that happened AFTER the client's version.
            const metaResults = await query(
                `
                SELECT id, entity_id, entity_type, version, op, timestamp, payload
                FROM sync_meta 
                WHERE user_id = $1 AND version > $2 
                ORDER BY version ASC;
                `,
                [userId, sinceVersion]
            );

            const metaRows = metaResults.rows as SyncMetaRow[];
            const ops = await Promise.all(metaRows.map(row => mapMetaRowToOp(row, userId)));

            const highestVersion = ops.length > 0 ? ops[ops.length - 1].version : sinceVersion;

            return reply.send<PullResponse>({
                ops,
                newVersion: highestVersion,
            });

        } catch (error) {
            fastify.log.error("Sync Pull failed:", error);
            reply.code(500).send({ error: 'Error pulling changes.' });
        }
    });
};

// Helper functions to handle different entity types
async function handleDeckOperation(client: QueryClient, userId: string, op: DeckOp) {
    if (op.op === 'create') {
        const payload = op.payload;
        const insertQuery = `
            INSERT INTO decks (id, user_id, name, description, config)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO NOTHING;
        `;
        await client.query(insertQuery, [
            op.entityId,
            userId,
            payload.name,
            payload.description ?? null,
            payload.config ?? {},
        ]);
    } else if (op.op === 'update') {
        const payload = op.payload;
        const updateQuery = `
            UPDATE decks
            SET name = $1, description = $2, config = $3, updated_at = NOW()
            WHERE id = $4 AND user_id = $5;
        `;
        await client.query(updateQuery, [
            payload.name,
            payload.description ?? null,
            payload.config ?? {},
            op.entityId,
            userId,
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM decks
            WHERE id = $1 AND user_id = $2;
        `;
        await client.query(deleteQuery, [op.entityId, userId]);
    }
}

async function handleNoteOperation(client: QueryClient, userId: string, op: NoteOp) {
    if (op.op === 'create') {
        const payload = op.payload;
        const insertQuery = `
            INSERT INTO notes (id, user_id, deck_id, model_name, fields, tags)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING;
        `;
        await client.query(insertQuery, [
            op.entityId,
            userId,
            payload.deck_id,
            payload.model_name,
            payload.fields,
            payload.tags ?? [],
        ]);
    } else if (op.op === 'update') {
        const payload = op.payload;
        const updateQuery = `
            UPDATE notes
            SET deck_id = $1, model_name = $2, fields = $3, tags = $4, updated_at = NOW()
            WHERE id = $5 AND user_id = $6;
        `;
        await client.query(updateQuery, [
            payload.deck_id,
            payload.model_name,
            payload.fields,
            payload.tags ?? [],
            op.entityId,
            userId,
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM notes
            WHERE id = $1 AND user_id = $2;
        `;
        await client.query(deleteQuery, [op.entityId, userId]);
    }
}

async function handleCardOperation(client: QueryClient, userId: string, op: CardOp) {
    if (op.op === 'create') {
        const payload = op.payload;
        const insertQuery = `
            INSERT INTO cards (id, user_id, note_id, ordinal, due, interval, ease_factor,
                              reps, lapses, card_type, queue, original_due)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO NOTHING;
        `;
        const due = payload.due != null ? new Date(payload.due) : new Date();
        const originalDue = payload.original_due ?? null;
        await client.query(insertQuery, [
            op.entityId,
            userId,
            payload.note_id,
            payload.ordinal,
            due,
            payload.interval ?? 0,
            payload.ease_factor ?? 2.5,
            payload.reps ?? 0,
            payload.lapses ?? 0,
            payload.card_type ?? 0,
            payload.queue ?? 0,
            originalDue,
        ]);
    } else if (op.op === 'update') {
        const payload = op.payload;
        const updateQuery = `
            UPDATE cards
            SET note_id = $1, ordinal = $2, due = $3, interval = $4, ease_factor = $5,
                reps = $6, lapses = $7, card_type = $8, queue = $9, original_due = $10, updated_at = NOW()
            WHERE id = $11 AND user_id = $12;
        `;
        const due = payload.due != null ? new Date(payload.due) : new Date();
        const originalDue = payload.original_due ?? null;
        await client.query(updateQuery, [
            payload.note_id,
            payload.ordinal,
            due,
            payload.interval ?? 0,
            payload.ease_factor ?? 2.5,
            payload.reps ?? 0,
            payload.lapses ?? 0,
            payload.card_type ?? 0,
            payload.queue ?? 0,
            originalDue,
            op.entityId,
            userId,
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM cards
            WHERE id = $1 AND user_id = $2;
        `;
        await client.query(deleteQuery, [op.entityId, userId]);
    }
}

async function handleReviewLogOperation(client: QueryClient, userId: string, op: ReviewLogOp) {
    if (op.op === 'create') {
        const payload = op.payload;
        const insertQuery = `
            INSERT INTO review_logs (id, user_id, card_id, timestamp, rating, duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING;
        `;
        const timestamp = payload.timestamp != null ? new Date(payload.timestamp) : new Date();
        await client.query(insertQuery, [
            op.entityId,
            userId,
            payload.card_id,
            timestamp,
            payload.rating,
            payload.duration_ms ?? null,
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM review_logs
            WHERE id = $1 AND user_id = $2;
        `;
        await client.query(deleteQuery, [op.entityId, userId]);
    }
    // Note: Review logs typically don't get updated, only created/deleted
}

// Helper function to fetch entity data for pull operations
async function fetchEntityData(userId: string, entityId: string, entityType: 'deck'): Promise<DeckPayload | null>;
async function fetchEntityData(userId: string, entityId: string, entityType: 'note'): Promise<NotePayload | null>;
async function fetchEntityData(userId: string, entityId: string, entityType: 'card'): Promise<CardPayload | null>;
async function fetchEntityData(userId: string, entityId: string, entityType: 'review_log'): Promise<ReviewLogPayload | null>;
async function fetchEntityData(userId: string, entityId: string, entityType: EntityType) {
    if (entityType === 'deck') {
        const result = await query(
            'SELECT name, description, config FROM decks WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0];
        if (!row) return null;
        const payload: DeckPayload = {
            name: row.name,
            description: row.description ?? null,
            config: row.config ?? {},
        };
        return payload;
    }
    if (entityType === 'note') {
        const result = await query(
            'SELECT deck_id, model_name, fields, tags FROM notes WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0];
        if (!row) return null;
        const payload: NotePayload = {
            deck_id: row.deck_id,
            model_name: row.model_name,
            fields: row.fields,
            tags: row.tags ?? [],
        };
        return payload;
    }
    if (entityType === 'card') {
        const result = await query(
            'SELECT note_id, ordinal, due, interval, ease_factor, reps, lapses, card_type, queue, original_due FROM cards WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0];
        if (!row) return null;
        const payload: CardPayload = {
            note_id: row.note_id,
            ordinal: row.ordinal,
            due: toMillisOrNull(row.due),
            interval: row.interval ?? null,
            ease_factor: row.ease_factor ?? null,
            reps: row.reps ?? null,
            lapses: row.lapses ?? null,
            card_type: row.card_type ?? null,
            queue: row.queue ?? null,
            original_due: row.original_due ?? null,
        };
        return payload;
    }
    const result = await query(
        'SELECT card_id, timestamp, rating, duration_ms FROM review_logs WHERE id = $1 AND user_id = $2',
        [entityId, userId]
    );
    const row = result.rows[0];
    if (!row) return null;
    const payload: ReviewLogPayload = {
        card_id: row.card_id,
        timestamp: toMillisOrNull(row.timestamp),
        rating: row.rating,
        duration_ms: row.duration_ms ?? null,
    };
    return payload;
}

async function mapMetaRowToOp(row: SyncMetaRow, userId: string): Promise<SyncOp> {
    const version = Number(row.version);
    const timestamp = toMillis(row.timestamp);

    if (row.entity_type === 'deck') {
        if (row.op === 'create' || row.op === 'update') {
            const payload = resolvePayload(await fetchEntityData(userId, row.entity_id, 'deck'), row) as DeckPayload;
            const op: DeckOp = {
                entityId: row.entity_id,
                entityType: 'deck',
                version,
                op: row.op,
                timestamp,
                payload,
            };
            return op;
        }
        const op: DeckOp = {
            entityId: row.entity_id,
            entityType: 'deck',
            version,
            op: row.op,
            timestamp,
        };
        return op;
    }

    if (row.entity_type === 'note') {
        if (row.op === 'create' || row.op === 'update') {
            const payload = resolvePayload(await fetchEntityData(userId, row.entity_id, 'note'), row) as NotePayload;
            const op: NoteOp = {
                entityId: row.entity_id,
                entityType: 'note',
                version,
                op: row.op,
                timestamp,
                payload,
            };
            return op;
        }
        const op: NoteOp = {
            entityId: row.entity_id,
            entityType: 'note',
            version,
            op: row.op,
            timestamp,
        };
        return op;
    }

    if (row.entity_type === 'card') {
        if (row.op === 'create' || row.op === 'update') {
            const payload = resolvePayload(await fetchEntityData(userId, row.entity_id, 'card'), row) as CardPayload;
            const op: CardOp = {
                entityId: row.entity_id,
                entityType: 'card',
                version,
                op: row.op,
                timestamp,
                payload,
            };
            return op;
        }
        const op: CardOp = {
            entityId: row.entity_id,
            entityType: 'card',
            version,
            op: row.op,
            timestamp,
        };
        return op;
    }

    if (row.op === 'create' || row.op === 'update') {
        const payload = resolvePayload(await fetchEntityData(userId, row.entity_id, 'review_log'), row) as ReviewLogPayload;
        const op: ReviewLogOp = {
            entityId: row.entity_id,
            entityType: 'review_log',
            version,
            op: row.op,
            timestamp,
            payload,
        };
        return op;
    }
    const op: ReviewLogOp = {
        entityId: row.entity_id,
        entityType: 'review_log',
        version,
        op: row.op,
        timestamp,
    };
    return op;
}

function toMillis(value: Date | string | number): number {
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'number') {
        return value;
    }
    const millis = new Date(value).getTime();
    if (Number.isNaN(millis)) {
        throw new Error(`Invalid date value: ${value}`);
    }
    return millis;
}

function toMillisOrNull(value: Date | string | number | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'number') {
        return value;
    }
    const millis = new Date(value).getTime();
    return Number.isNaN(millis) ? null : millis;
}

function resolvePayload<T>(payload: T | null, row: SyncMetaRow): T {
    if (payload) {
        return payload;
    }
    if (row.payload) {
        return row.payload as T;
    }
    throw new Error(`Missing payload for ${row.entity_type} ${row.entity_id} (${row.op})`);
}