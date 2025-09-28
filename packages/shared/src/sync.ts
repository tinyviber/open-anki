import { z } from 'zod';

export const deckPayloadSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type DeckPayload = z.infer<typeof deckPayloadSchema>;

export const notePayloadSchema = z.object({
  deck_id: z.string(),
  model_name: z.string(),
  fields: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()).optional(),
});

export type NotePayload = z.infer<typeof notePayloadSchema>;

export const cardPayloadSchema = z.object({
  note_id: z.string(),
  ordinal: z.number(),
  due: z.number(),
  interval: z.number(),
  ease_factor: z.number(),
  reps: z.number(),
  lapses: z.number(),
  card_type: z.number(),
  queue: z.number(),
  original_due: z.number().nullable(),
});

export type CardPayload = z.infer<typeof cardPayloadSchema>;

export const reviewLogPayloadSchema = z.object({
  card_id: z.string(),
  timestamp: z.number(),
  rating: z.number(),
  duration_ms: z.number().nullable().optional(),
});

export type ReviewLogPayload = z.infer<typeof reviewLogPayloadSchema>;

export const entityTypeSchema = z.enum(['deck', 'note', 'card', 'review_log']);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const operationTypeSchema = z.enum(['create', 'update', 'delete']);
export type OperationType = z.infer<typeof operationTypeSchema>;

const baseOpSchema = z.object({
  entityId: z.string(),
  entityType: entityTypeSchema,
  version: z.number(),
  op: operationTypeSchema,
  timestamp: z.number(),
});

const createOrUpdateDeckOpSchema = baseOpSchema.extend({
  entityType: z.literal('deck'),
  op: z.enum(['create', 'update']),
  payload: deckPayloadSchema,
});

const createOrUpdateNoteOpSchema = baseOpSchema.extend({
  entityType: z.literal('note'),
  op: z.enum(['create', 'update']),
  payload: notePayloadSchema,
});

const createOrUpdateCardOpSchema = baseOpSchema.extend({
  entityType: z.literal('card'),
  op: z.enum(['create', 'update']),
  payload: cardPayloadSchema,
});

const createOrUpdateReviewLogOpSchema = baseOpSchema.extend({
  entityType: z.literal('review_log'),
  op: z.enum(['create', 'update']),
  payload: reviewLogPayloadSchema,
});

const deleteDeckOpSchema = baseOpSchema.extend({
  entityType: z.literal('deck'),
  op: z.literal('delete'),
  payload: z.undefined(),
});

const deleteNoteOpSchema = baseOpSchema.extend({
  entityType: z.literal('note'),
  op: z.literal('delete'),
  payload: z.undefined(),
});

const deleteCardOpSchema = baseOpSchema.extend({
  entityType: z.literal('card'),
  op: z.literal('delete'),
  payload: z.undefined(),
});

const deleteReviewLogOpSchema = baseOpSchema.extend({
  entityType: z.literal('review_log'),
  op: z.literal('delete'),
  payload: z.undefined(),
});

const deckOpSchema = z.union([createOrUpdateDeckOpSchema, deleteDeckOpSchema]);
const noteOpSchema = z.union([createOrUpdateNoteOpSchema, deleteNoteOpSchema]);
const cardOpSchema = z.union([createOrUpdateCardOpSchema, deleteCardOpSchema]);
const reviewLogOpSchema = z.union([createOrUpdateReviewLogOpSchema, deleteReviewLogOpSchema]);

export const syncOpSchema = z.union([
  deckOpSchema,
  noteOpSchema,
  cardOpSchema,
  reviewLogOpSchema,
]);

export type SyncOp = z.infer<typeof syncOpSchema>;

export const pushBodySchema = z.object({
  deviceId: z.string(),
  ops: z.array(syncOpSchema).min(1),
});

export type PushBody = z.infer<typeof pushBodySchema>;

export const pullQuerySchema = z.object({
  sinceVersion: z.coerce.number().int().nonnegative(),
});

export type PullQuery = z.infer<typeof pullQuerySchema>;

export const pushResponseSchema = z.object({
  message: z.string(),
  currentVersion: z.number(),
});

export type PushResponse = z.infer<typeof pushResponseSchema>;

export const pullResponseSchema = z.object({
  ops: z.array(syncOpSchema),
  newVersion: z.number(),
});

export type PullResponse = z.infer<typeof pullResponseSchema>;
