import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { query as defaultQuery } from '../db/pg-service.js';

type QueryFn = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;

interface OpLog {
    entityId: string;
    entityType: 'deck' | 'note' | 'card' | 'review_log';
    version: number;
    op: 'create' | 'update' | 'delete';
    timestamp?: number;
    payload?: Record<string, any>;
}

interface PushBody {
    deviceId: string;
    ops: OpLog[];
}

interface PullQuery {
    sinceVersion: string;
}

interface SyncRouteDependencies {
    query?: QueryFn;
}

class SyncValidationError extends Error {
    statusCode = 400;
    constructor(message: string) {
        super(message);
        this.name = 'SyncValidationError';
    }
}

const PUSH_BODY_SCHEMA = {
    type: 'object',
    required: ['deviceId', 'ops'],
    properties: {
        deviceId: { type: 'string' },
        ops: {
            type: 'array',
            items: {
                type: 'object',
                required: ['entityId', 'entityType', 'version', 'op'],
                properties: {
                    entityId: { type: 'string' },
                    entityType: { type: 'string', enum: ['deck', 'note', 'card', 'review_log'] },
                    version: { type: 'number' },
                    op: { type: 'string', enum: ['create', 'update', 'delete'] },
                    timestamp: { type: 'number' },
                    payload: {
                        type: ['object', 'null'],
                        additionalProperties: true,
                        properties: {
                            due: { type: 'number' },
                            timestamp: { type: 'number' },
                        },
                    },
                },
            },
        },
    },
};

const PULL_QUERY_SCHEMA = {
    type: 'object',
    required: ['sinceVersion'],
    properties: {
        sinceVersion: { type: 'string' },
    },
};

function validateOps(ops: OpLog[]) {
    for (const op of ops) {
        if (op.timestamp !== undefined && typeof op.timestamp !== 'number') {
            throw new SyncValidationError(`Operation ${op.entityType}/${op.entityId} must provide a numeric millisecond timestamp.`);
        }

        if (!op.payload) {
            continue;
        }

        if (op.entityType === 'card') {
            if (op.payload.due !== undefined && op.payload.due !== null && typeof op.payload.due !== 'number') {
                throw new SyncValidationError('Card payload.due must be provided as a millisecond timestamp number.');
            }
        }

        if (op.entityType === 'review_log') {
            if (op.payload.timestamp !== undefined && op.payload.timestamp !== null && typeof op.payload.timestamp !== 'number') {
                throw new SyncValidationError('Review log payload.timestamp must be provided as a millisecond timestamp number.');
            }
        }
    }
}

function millisToDate(value?: number | null): Date | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'number') {
        return new Date(value);
    }

    if (value instanceof Date) {
        return value;
    }

    return null;
}

function toUnixMillis(value: unknown): number | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === 'number') {
        return value;
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    const parsed = new Date(value as any);
    const time = parsed.getTime();
    return Number.isNaN(time) ? null : time;
}

function convertRowDateFields<T extends Record<string, any>>(row: T | undefined | null, fields: string[]): T | null {
    if (!row) {
        return null;
    }

    const result: Record<string, any> = { ...row };
    for (const field of fields) {
        if (field in result) {
            const millis = toUnixMillis(result[field]);
            if (millis !== null) {
                result[field] = millis;
            } else if (result[field] !== undefined) {
                result[field] = null;
            }
        }
    }

    return result as T;
}

async function processPush(dbQuery: QueryFn, userId: string, ops: OpLog[]) {
    validateOps(ops);

    let latestVersion = 0;
    let transactionStarted = false;

    try {
        await dbQuery('BEGIN');
        transactionStarted = true;

        for (const op of ops) {
            if (!op.version) {
                op.version = Date.now();
            }

            const opTimestampMillis = typeof op.timestamp === 'number' ? op.timestamp : Date.now();
            const syncMetaInsert = `
                INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op, timestamp, payload)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (entity_id, version) DO NOTHING;
            `;
            await dbQuery(syncMetaInsert, [
                userId,
                op.entityId,
                op.entityType,
                op.version,
                op.op,
                new Date(opTimestampMillis),
                op.payload || null,
            ]);

            if (op.entityType === 'deck') {
                await handleDeckOperation(dbQuery, userId, op);
            } else if (op.entityType === 'note') {
                await handleNoteOperation(dbQuery, userId, op);
            } else if (op.entityType === 'card') {
                await handleCardOperation(dbQuery, userId, op);
            } else if (op.entityType === 'review_log') {
                await handleReviewLogOperation(dbQuery, userId, op);
            }

            latestVersion = Math.max(latestVersion, op.version);
        }

        await dbQuery('COMMIT');
    } catch (error) {
        if (transactionStarted) {
            try {
                await dbQuery('ROLLBACK');
            } catch (rollbackError) {
                console.error('Failed to rollback transaction after sync error:', rollbackError);
            }
        }
        throw error;
    }

    return { message: `${ops.length} ops processed.`, currentVersion: latestVersion };
}

async function processPull(dbQuery: QueryFn, userId: string, sinceVersion: number) {
    const metaResults = await dbQuery(
        `
        SELECT id, entity_id, entity_type, version, op, timestamp, payload
        FROM sync_meta
        WHERE user_id = $1 AND version > $2
        ORDER BY version ASC;
        `,
        [userId, sinceVersion]
    );

    const ops = await Promise.all(
        metaResults.rows.map(async (op: any) => {
            const normalizedTimestamp = toUnixMillis(op.timestamp);
            const baseOp = {
                ...op,
                timestamp: normalizedTimestamp,
            };

            if (op.op === 'create' || op.op === 'update') {
                const entityData = await fetchEntityData(dbQuery, userId, op.entity_id, op.entity_type as 'deck' | 'note' | 'card' | 'review_log');
                return {
                    ...baseOp,
                    payload: entityData,
                };
            }

            return baseOp;
        })
    );

    const highestVersion = ops.length > 0 ? ops[ops.length - 1].version : sinceVersion;

    return {
        ops,
        newVersion: highestVersion,
    };
}

export const createSyncRoutes = ({ query = defaultQuery }: SyncRouteDependencies = {}): FastifyPluginAsync => {
    const dbQuery = query;

    const plugin: FastifyPluginAsync = async (fastify, _opts) => {
        fastify.post<{ Body: PushBody }>(
            '/sync/push',
            {
                schema: {
                    body: PUSH_BODY_SCHEMA,
                },
            },
            async (request: FastifyRequest<{ Body: PushBody }>, reply) => {
                const userId = request.user.id;
                const { ops } = request.body;

                if (!ops || ops.length === 0) {
                    reply.send({ message: 'No operations received.', currentVersion: Date.now() });
                    return;
                }

                try {
                    const result = await processPush(dbQuery, userId, ops);
                    reply.send(result);
                } catch (error: any) {
                    if (error instanceof SyncValidationError) {
                        reply.code(400).send({ error: error.message });
                        return;
                    }
                    fastify.log.error(error, 'Sync Push Transaction failed');
                    reply.code(500).send({ error: 'Synchronization failed due to a server error.' });
                }
            }
        );

        fastify.get<{ Querystring: PullQuery }>(
            '/sync/pull',
            {
                schema: {
                    querystring: PULL_QUERY_SCHEMA,
                },
            },
            async (request: FastifyRequest<{ Querystring: PullQuery }>, reply) => {
                const userId = request.user.id;
                const sinceVersion = parseInt(request.query.sinceVersion, 10);

                if (isNaN(sinceVersion)) {
                    reply.code(400).send({ error: 'Invalid or missing sinceVersion parameter.' });
                    return;
                }

                try {
                    const result = await processPull(dbQuery, userId, sinceVersion);
                    reply.send(result);
                } catch (error: any) {
                    fastify.log.error(error, 'Sync Pull failed');
                    reply.code(500).send({ error: 'Error pulling changes.' });
                }
            }
        );
    };

    return plugin;
};

export const syncRoutes = createSyncRoutes();

export { processPull, processPush, SyncValidationError };

async function handleDeckOperation(dbQuery: QueryFn, userId: string, op: OpLog) {
    if (!op.payload) return;

    if (op.op === 'create') {
        const insertQuery = `
            INSERT INTO decks (id, user_id, name, description, config)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO NOTHING;
        `;
        await dbQuery(insertQuery, [
            op.entityId,
            userId,
            op.payload.name,
            op.payload.description,
            op.payload.config || {},
        ]);
    } else if (op.op === 'update') {
        const updateQuery = `
            UPDATE decks
            SET name = $1, description = $2, config = $3, updated_at = NOW()
            WHERE id = $4 AND user_id = $5;
        `;
        await dbQuery(updateQuery, [
            op.payload.name,
            op.payload.description,
            op.payload.config || {},
            op.entityId,
            userId,
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM decks
            WHERE id = $1 AND user_id = $2;
        `;
        await dbQuery(deleteQuery, [op.entityId, userId]);
    }
}

async function handleNoteOperation(dbQuery: QueryFn, userId: string, op: OpLog) {
    if (!op.payload) return;

    if (op.op === 'create') {
        const insertQuery = `
            INSERT INTO notes (id, user_id, deck_id, model_name, fields, tags)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING;
        `;
        await dbQuery(insertQuery, [
            op.entityId,
            userId,
            op.payload.deck_id,
            op.payload.model_name,
            op.payload.fields,
            op.payload.tags || [],
        ]);
    } else if (op.op === 'update') {
        const updateQuery = `
            UPDATE notes
            SET deck_id = $1, model_name = $2, fields = $3, tags = $4, updated_at = NOW()
            WHERE id = $5 AND user_id = $6;
        `;
        await dbQuery(updateQuery, [
            op.payload.deck_id,
            op.payload.model_name,
            op.payload.fields,
            op.payload.tags || [],
            op.entityId,
            userId,
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM notes
            WHERE id = $1 AND user_id = $2;
        `;
        await dbQuery(deleteQuery, [op.entityId, userId]);
    }
}

async function handleCardOperation(dbQuery: QueryFn, userId: string, op: OpLog) {
    if (!op.payload) return;
    const payload = op.payload;

    if (op.op === 'create') {
        const insertQuery = `
            INSERT INTO cards (id, user_id, note_id, ordinal, due, interval, ease_factor,
                              reps, lapses, card_type, queue, original_due)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO NOTHING;
        `;
        const dueDate = millisToDate(payload.due) ?? new Date();
        await dbQuery(insertQuery, [
            op.entityId,
            userId,
            payload.note_id,
            payload.ordinal,
            dueDate,
            payload.interval || 0,
            payload.ease_factor || 2.5,
            payload.reps || 0,
            payload.lapses || 0,
            payload.card_type || 0,
            payload.queue || 0,
            payload.original_due || 0,
        ]);
    } else if (op.op === 'update') {
        const updateQuery = `
            UPDATE cards
            SET note_id = $1, ordinal = $2, due = $3, interval = $4, ease_factor = $5,
                reps = $6, lapses = $7, card_type = $8, queue = $9, original_due = $10, updated_at = NOW()
            WHERE id = $11 AND user_id = $12;
        `;
        const dueDate = millisToDate(payload.due) ?? new Date();
        await dbQuery(updateQuery, [
            payload.note_id,
            payload.ordinal,
            dueDate,
            payload.interval,
            payload.ease_factor,
            payload.reps,
            payload.lapses,
            payload.card_type,
            payload.queue,
            payload.original_due || 0,
            op.entityId,
            userId,
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM cards
            WHERE id = $1 AND user_id = $2;
        `;
        await dbQuery(deleteQuery, [op.entityId, userId]);
    }
}

async function handleReviewLogOperation(dbQuery: QueryFn, userId: string, op: OpLog) {
    if (!op.payload) return;
    const payload = op.payload;

    if (op.op === 'create') {
        const insertQuery = `
            INSERT INTO review_logs (id, user_id, card_id, timestamp, rating, duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING;
        `;
        const reviewTimestamp = millisToDate(payload.timestamp) ?? new Date();
        await dbQuery(insertQuery, [
            op.entityId,
            userId,
            payload.card_id,
            reviewTimestamp,
            payload.rating,
            payload.duration_ms,
        ]);
    } else if (op.op === 'delete') {
        const deleteQuery = `
            DELETE FROM review_logs
            WHERE id = $1 AND user_id = $2;
        `;
        await dbQuery(deleteQuery, [op.entityId, userId]);
    }
}

async function fetchEntityData(
    dbQuery: QueryFn,
    userId: string,
    entityId: string,
    entityType: 'deck' | 'note' | 'card' | 'review_log'
) {
    if (entityType === 'deck') {
        const result = await dbQuery('SELECT * FROM decks WHERE id = $1 AND user_id = $2', [entityId, userId]);
        return convertRowDateFields(result.rows[0], ['created_at', 'updated_at']);
    } else if (entityType === 'note') {
        const result = await dbQuery('SELECT * FROM notes WHERE id = $1 AND user_id = $2', [entityId, userId]);
        return convertRowDateFields(result.rows[0], ['created_at', 'updated_at']);
    } else if (entityType === 'card') {
        const result = await dbQuery('SELECT * FROM cards WHERE id = $1 AND user_id = $2', [entityId, userId]);
        return convertRowDateFields(result.rows[0], ['due', 'created_at', 'updated_at']);
    } else if (entityType === 'review_log') {
        const result = await dbQuery('SELECT * FROM review_logs WHERE id = $1 AND user_id = $2', [entityId, userId]);
        return convertRowDateFields(result.rows[0], ['timestamp', 'created_at']);
    }
    return null;
}
