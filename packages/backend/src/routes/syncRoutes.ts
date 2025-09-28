import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { query } from '../db/pg-service.js';

interface OpLog {
    entityId: string;
    entityType: 'deck' | 'note' | 'card' | 'review_log';
    version: number; 
    op: 'create' | 'update' | 'delete'; 
    timestamp: number;
    payload?: Record<string, any>;
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
                      required: ['entityId', 'entityType', 'version', 'op'],
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
                await query(syncMetaInsert, [
                    userId, op.entityId, op.entityType, op.version, op.op, op.timestamp, op.payload || null
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
            fastify.log.error("Sync Push Transaction failed:", error);
            reply.code(500).send({ error: 'Synchronization failed due to a server error.' });
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

            // For 'create' and 'update' operations, we need to fetch the actual entity data
            const ops = await Promise.all(metaResults.rows.map(async (op: any) => {
                if (op.op === 'create' || op.op === 'update') {
                    // Fetch the actual entity data
                    const entityData = await fetchEntityData(userId, op.entity_id, op.entity_type as 'deck' | 'note' | 'card' | 'review_log');
                    return {
                        ...op,
                        payload: entityData
                    };
                }
                return op; // For 'delete' operations, payload is not needed
            })) as any[];

            const highestVersion = ops.length > 0 ? ops[ops.length - 1].version : sinceVersion;
            
            return reply.send({
                ops: ops,
                newVersion: highestVersion,
            });

        } catch (error: any) {
            fastify.log.error("Sync Pull failed:", error);
            reply.code(500).send({ error: 'Error pulling changes.' });
        }
    });
};

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
        await query(insertQuery, [
            op.entityId, userId, op.payload.note_id, op.payload.ordinal, 
            op.payload.due || new Date(), op.payload.interval || 0, op.payload.ease_factor || 2.5,
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
        await query(updateQuery, [
            op.payload.note_id, op.payload.ordinal, op.payload.due, op.payload.interval, 
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
        await query(insertQuery, [
            op.entityId, userId, op.payload.card_id, op.payload.timestamp || new Date(), 
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
async function fetchEntityData(userId: string, entityId: string, entityType: 'deck' | 'note' | 'card' | 'review_log') {
    if (entityType === 'deck') {
        const result = await query(
            'SELECT * FROM decks WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        return result.rows[0] || null;
    } else if (entityType === 'note') {
        const result = await query(
            'SELECT * FROM notes WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        return result.rows[0] || null;
    } else if (entityType === 'card') {
        const result = await query(
            'SELECT * FROM cards WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        return result.rows[0] || null;
    } else if (entityType === 'review_log') {
        const result = await query(
            'SELECT * FROM review_logs WHERE id = $1 AND user_id = $2',
            [entityId, userId]
        );
        return result.rows[0] || null;
    }
    return null;
}