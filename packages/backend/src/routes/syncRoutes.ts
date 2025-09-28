import { type FastifyPluginAsync } from 'fastify';
import { type ZodType } from 'zod';
import {
    type ZodTypeProvider,
    serializerCompiler,
    validatorCompiler,
} from 'fastify-type-provider-zod';
import {
    type CardPayload,
    type DeckPayload,
    type NotePayload,
    type PullResponse,
    type ReviewLogPayload,
    type SyncOp,
    cardPayloadSchema,
    deckPayloadSchema,
    notePayloadSchema,
    pullQuerySchema,
    pullResponseSchema,
    pushBodySchema,
    pushResponseSchema,
    reviewLogPayloadSchema,
    DEFAULT_PULL_DEVICE_ID,
    DEFAULT_PULL_LIMIT,
    decodeContinuationToken,
    encodeContinuationToken,
} from '../../../shared/src/sync.js';
import { getQueryClient, query, type QueryClient } from '../db/pg-service.js';

type EntityType = SyncOp['entityType'];
type OperationType = SyncOp['op'];

type DeckOp = Extract<SyncOp, { entityType: 'deck' }>;
type NoteOp = Extract<SyncOp, { entityType: 'note' }>;
type CardOp = Extract<SyncOp, { entityType: 'card' }>;
type ReviewLogOp = Extract<SyncOp, { entityType: 'review_log' }>;

interface SyncMetaRow {
    id: number | string;
    entity_id: string;
    entity_type: EntityType;
    version: number;
    op: OperationType;
    timestamp: Date | string | number;
    payload?: unknown;
    device_id?: string | null;
    diff?: unknown;
}

interface DeviceProgressRow {
    last_version: number | string;
    last_meta_id: number | string | null;
    continuation_token: string | null;
}

interface ConflictDetail {
    entityId: string;
    entityType: EntityType;
    incomingVersion: number;
    currentVersion: number;
    lastSyncedDeviceId: string | null;
    retryHint: string;
}

class SyncConflictError extends Error {
    constructor(public readonly conflicts: ConflictDetail[]) {
        super('Sync conflict detected');
    }
}

const toNumberOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined) {
        return null;
    }
    const numericValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
};

const ensureFiniteMillis = (value: number, fieldName: string): number => {
    if (!Number.isFinite(value)) {
        throw new Error(`Expected ${fieldName} to be a finite millisecond timestamp but received ${value}`);
    }
    return value;
};

const toDateFromMillis = (value: number, fieldName: string): Date => {
    return new Date(ensureFiniteMillis(value, fieldName));
};

const toRequiredNumber = (value: unknown, fieldName: string): number => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
        throw new Error(`Expected ${fieldName} to be a finite number but received ${value}`);
    }
    return numericValue;
};

export const syncRoutes: FastifyPluginAsync = async (fastify, _opts) => {
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);
    const typedFastify = fastify.withTypeProvider<ZodTypeProvider>();

    typedFastify.post(
      '/push',
      {
          schema: {
              body: pushBodySchema,
              response: {
                  200: pushResponseSchema,
              },
          },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const { deviceId, ops } = request.body;

        let latestVersion = 0;
        const conflicts: ConflictDetail[] = [];
        const versionCache = new Map<string, { version: number; deviceId: string | null }>();

        const client = await getQueryClient();

        try {
            await client.query('BEGIN');

            for (const op of ops) {
                const version = op.version;
                const cacheKey = `${op.entityType}:${op.entityId}`;

                let versionInfo = versionCache.get(cacheKey);
                if (!versionInfo) {
                    const versionQuery = `
                        SELECT version, device_id
                        FROM sync_meta
                        WHERE user_id = $1 AND entity_id = $2
                        ORDER BY version DESC
                        LIMIT 1
                        FOR UPDATE;
                    `;
                    const result = await client.query(versionQuery, [userId, op.entityId]);
                    const row = result.rows[0];
                    versionInfo = {
                        version: row ? Number(row.version) : 0,
                        deviceId: row?.device_id ?? null,
                    };
                    versionCache.set(cacheKey, versionInfo);
                }

                if (versionInfo.version >= version) {
                    const conflict: ConflictDetail = {
                        entityId: op.entityId,
                        entityType: op.entityType,
                        incomingVersion: version,
                        currentVersion: versionInfo.version,
                        lastSyncedDeviceId: versionInfo.deviceId,
                        retryHint:
                            'Pull the latest changes from the server, merge them locally, and retry the push with incremented versions.',
                    };
                    conflicts.push(conflict);
                    throw new SyncConflictError(conflicts);
                }

                versionCache.set(cacheKey, { version, deviceId });

                // 1. Write to sync_meta (for conflict resolution/versioning)
                const syncMetaInsert = `
                    INSERT INTO sync_meta (user_id, entity_id, entity_type, version, op, timestamp, payload, device_id, diff)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (user_id, entity_id, version) DO NOTHING;
                `;
                const timestamp = toDateFromMillis(op.timestamp, 'sync_meta.timestamp');

                await client.query(syncMetaInsert, [
                    userId,
                    op.entityId,
                    op.entityType,
                    version,
                    op.op,
                    timestamp,
                    'payload' in op ? op.payload : null,
                    deviceId,
                    'diff' in op ? op.diff ?? null : null,
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

                latestVersion = Math.max(latestVersion, version);
            }

            await client.query('COMMIT');

            return reply.send({ message: `${ops.length} ops processed.`, currentVersion: latestVersion });
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                fastify.log.error({ err: rollbackError }, 'Rollback failed');
            }
            if (error instanceof SyncConflictError) {
                fastify.log.warn({ conflicts: error.conflicts }, 'Sync conflict detected');
                return reply.code(409).send({
                    error: 'Sync conflict detected: one or more operations are based on stale versions.',
                    conflicts: error.conflicts,
                    guidance: 'Call /pull to retrieve the latest state, merge locally, and retry the push with updated versions.',
                });
            }
            fastify.log.error({ err: error }, 'Sync Push Transaction failed');
            return reply.code(500).send({ error: 'Synchronization failed due to a server error.' });
        } finally {
            client.release();
        }
    });

    typedFastify.get(
      '/pull',
      {
          schema: {
              querystring: pullQuerySchema,
              response: {
                  200: pullResponseSchema,
              },
          },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const {
            sinceVersion: requestedSinceVersion,
            limit = DEFAULT_PULL_LIMIT,
            deviceId = DEFAULT_PULL_DEVICE_ID,
            continuationToken,
        } = request.query;

        const effectiveLimit = Number.isFinite(limit) ? limit : DEFAULT_PULL_LIMIT;
        const effectiveDeviceId = deviceId ?? DEFAULT_PULL_DEVICE_ID;
        const fetchLimit = effectiveLimit + 1;

        try {
            const progressResult = await query(
                `
                    SELECT last_version, last_meta_id, continuation_token
                    FROM device_sync_progress
                    WHERE user_id = $1 AND device_id = $2
                    LIMIT 1;
                `,
                [userId, effectiveDeviceId]
            );

            const existingProgress = progressResult.rows[0] as DeviceProgressRow | undefined;
            const storedVersion = toNumberOrNull(existingProgress?.last_version) ?? 0;
            const storedLastMetaId = toNumberOrNull(existingProgress?.last_meta_id);

            const hasRequestedSince =
                typeof requestedSinceVersion === 'number' && Number.isFinite(requestedSinceVersion);
            const effectiveSinceVersion = hasRequestedSince ? requestedSinceVersion! : storedVersion;

            let continuationTokenToUse = continuationToken ?? null;
            if (!continuationTokenToUse && !hasRequestedSince && existingProgress?.continuation_token) {
                continuationTokenToUse = existingProgress.continuation_token;
            }

            let decodedContinuation: { version: number; id: number } | null = null;
            if (continuationTokenToUse) {
                try {
                    decodedContinuation = decodeContinuationToken(continuationTokenToUse);
                } catch (error) {
                    fastify.log.warn(
                        { userId, requestedSinceVersion, continuationToken: continuationTokenToUse, err: error },
                        'Invalid continuation token provided to /pull'
                    );
                    return reply.code(400).send({ error: 'Invalid continuation token supplied.' });
                }
            }

            fastify.log.debug(
                {
                    userId,
                    requestedSinceVersion,
                    sinceVersion: effectiveSinceVersion,
                    limit: effectiveLimit,
                    deviceId: effectiveDeviceId,
                    continuationToken: continuationTokenToUse,
                },
                'Processing sync pull request'
            );

            const applyContinuation =
                decodedContinuation !== null && decodedContinuation.version >= effectiveSinceVersion;

            const comparisonVersion = applyContinuation
                ? Math.max(effectiveSinceVersion, decodedContinuation!.version)
                : effectiveSinceVersion;

            const params: unknown[] = [userId, comparisonVersion];
            let sql = `
                SELECT id, entity_id, entity_type, version, op, timestamp, payload
                FROM sync_meta
                WHERE user_id = $1 AND version > $2
                ORDER BY version ASC, id ASC
                LIMIT $3;
            `;

            if (applyContinuation) {
                sql = `
                    SELECT id, entity_id, entity_type, version, op, timestamp, payload
                    FROM sync_meta
                    WHERE user_id = $1 AND (version > $2 OR (version = $3 AND id > $4))
                    ORDER BY version ASC, id ASC
                    LIMIT $5;
                `;
                params.push(decodedContinuation!.version, decodedContinuation!.id, fetchLimit);
            } else {
                params.push(fetchLimit);
            }

            const metaResults = await query(sql, params);

            const metaRowsRaw = metaResults.rows as SyncMetaRow[];
            const hasMore = metaRowsRaw.length > effectiveLimit;
            const metaRows = hasMore ? metaRowsRaw.slice(0, effectiveLimit) : metaRowsRaw;

            const ops = await Promise.all(metaRows.map(row => mapMetaRowToOp(row, userId)));

            const baselineVersion = Math.max(
                effectiveSinceVersion,
                decodedContinuation?.version ?? effectiveSinceVersion
            );
            const highestVersion = ops.length > 0 ? ops[ops.length - 1].version : baselineVersion;

            const nextToken =
                hasMore && metaRows.length > 0
                    ? encodeContinuationToken(
                          Number(metaRows[metaRows.length - 1].version),
                          Number(metaRows[metaRows.length - 1].id)
                      )
                    : null;

            let lastMetaIdValue = metaRows.length > 0 ? toNumberOrNull(metaRows[metaRows.length - 1].id) : null;
            if (lastMetaIdValue === null) {
                if (applyContinuation && decodedContinuation) {
                    lastMetaIdValue = decodedContinuation.id;
                } else {
                    lastMetaIdValue = storedLastMetaId ?? null;
                }
            }

            await query(
                `
                    INSERT INTO device_sync_progress (user_id, device_id, last_version, last_meta_id, continuation_token, updated_at)
                    VALUES ($1, $2, $3, $4, $5, NOW())
                    ON CONFLICT (user_id, device_id)
                    DO UPDATE SET
                        last_version = EXCLUDED.last_version,
                        last_meta_id = EXCLUDED.last_meta_id,
                        continuation_token = EXCLUDED.continuation_token,
                        updated_at = NOW();
                `,
                [userId, effectiveDeviceId, highestVersion, lastMetaIdValue, nextToken]
            );

            const response: PullResponse = {
                ops,
                newVersion: highestVersion,
                hasMore,
                continuationToken: nextToken,
            };

            return reply.send(response);

        } catch (error) {
            fastify.log.error('Sync Pull failed:', error);
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
        const due = toDateFromMillis(payload.due, 'card.due');
        const originalDue = payload.original_due ?? null;
        await client.query(insertQuery, [
            op.entityId,
            userId,
            payload.note_id,
            payload.ordinal,
            due,
            payload.interval,
            payload.ease_factor,
            payload.reps,
            payload.lapses,
            payload.card_type,
            payload.queue,
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
        const due = toDateFromMillis(payload.due, 'card.due');
        const originalDue = payload.original_due ?? null;
        await client.query(updateQuery, [
            payload.note_id,
            payload.ordinal,
            due,
            payload.interval,
            payload.ease_factor,
            payload.reps,
            payload.lapses,
            payload.card_type,
            payload.queue,
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
        const timestamp = toDateFromMillis(payload.timestamp, 'review_log.timestamp');
        await client.query(insertQuery, [
            op.entityId,
            userId,
            payload.card_id,
            timestamp,
            payload.rating,
            payload.duration_ms ?? null,
        ]);
    } else if (op.op === 'update') {
        const payload = op.payload;
        const updateQuery = `
            UPDATE review_logs
            SET card_id = $1, timestamp = $2, rating = $3, duration_ms = $4
            WHERE id = $5 AND user_id = $6;
        `;
        const timestamp = toDateFromMillis(payload.timestamp, 'review_log.timestamp');
        await client.query(updateQuery, [
            payload.card_id,
            timestamp,
            payload.rating,
            payload.duration_ms ?? null,
            op.entityId,
            userId,
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
        return deckPayloadSchema.parse({
            name: row.name,
            description: row.description ?? null,
            config: row.config ?? {},
        });
    }
    if (entityType === 'note') {
        const result = await query(
            'SELECT deck_id, model_name, fields, tags FROM notes WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0];
        if (!row) return null;
        return notePayloadSchema.parse({
            deck_id: row.deck_id,
            model_name: row.model_name,
            fields: row.fields,
            tags: row.tags ?? [],
        });
    }
    if (entityType === 'card') {
        const result = await query(
            'SELECT note_id, ordinal, due, interval, ease_factor, reps, lapses, card_type, queue, original_due FROM cards WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        const row = result.rows[0];
        if (!row) return null;
        return cardPayloadSchema.parse({
            note_id: row.note_id,
            ordinal: toRequiredNumber(row.ordinal, 'card.ordinal'),
            due: row.due ? toMillis(row.due) : Date.now(),
            interval: toRequiredNumber(row.interval, 'card.interval'),
            ease_factor: toRequiredNumber(row.ease_factor, 'card.ease_factor'),
            reps: toRequiredNumber(row.reps, 'card.reps'),
            lapses: toRequiredNumber(row.lapses, 'card.lapses'),
            card_type: toRequiredNumber(row.card_type, 'card.card_type'),
            queue: toRequiredNumber(row.queue, 'card.queue'),
            original_due: row.original_due != null ? Number(row.original_due) : null,
        });
    }
    const result = await query(
        'SELECT card_id, timestamp, rating, duration_ms FROM review_logs WHERE id = $1 AND user_id = $2',
        [entityId, userId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return reviewLogPayloadSchema.parse({
        card_id: row.card_id,
        timestamp: row.timestamp ? toMillis(row.timestamp) : Date.now(),
        rating: toRequiredNumber(row.rating, 'review_log.rating'),
        duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
    });
}

async function mapMetaRowToOp(row: SyncMetaRow, userId: string): Promise<SyncOp> {
    const version = Number(row.version);
    const timestamp = toMillis(row.timestamp);

    if (row.entity_type === 'deck') {
        if (row.op === 'create' || row.op === 'update') {
            const payload = resolvePayload(await fetchEntityData(userId, row.entity_id, 'deck'), row, deckPayloadSchema);
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
            const payload = resolvePayload(await fetchEntityData(userId, row.entity_id, 'note'), row, notePayloadSchema);
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
            const payload = resolvePayload(await fetchEntityData(userId, row.entity_id, 'card'), row, cardPayloadSchema);
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
        const payload = resolvePayload(await fetchEntityData(userId, row.entity_id, 'review_log'), row, reviewLogPayloadSchema);
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

function resolvePayload<T>(payload: T | null, row: SyncMetaRow, schema: ZodType<T>): T {
    if (payload) {
        return schema.parse(payload);
    }
    if (row.payload != null) {
        return schema.parse(row.payload);
    }
    throw new Error(`Missing payload for ${row.entity_type} ${row.entity_id} (${row.op})`);
}