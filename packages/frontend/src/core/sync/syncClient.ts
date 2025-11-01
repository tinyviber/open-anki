import {
  DEFAULT_PULL_LIMIT,
  type CardPayload,
  type DeckPayload,
  type NotePayload,
  type PullResponse,
  type ReviewLogPayload,
  type SessionResponse,
  type SyncOp,
  cardPayloadSchema,
  deckPayloadSchema,
  notePayloadSchema,
  reviewLogPayloadSchema,
} from '../../../../shared/src/sync.js';
import { db } from '../db/db';
import type { Card, Deck, Note, ReviewLog, SyncMeta, SyncState } from '../../../../shared/src/index.js';
import {
  cardStateToCardType,
  cardStateToQueue,
  deriveCardStateFromQueue,
  mapCardToPayload,
  mapDeckToPayload,
  mapNoteToPayload,
  mapReviewLogToPayload,
} from './payloadMappers';

const SYNC_STATE_ID = 'singleton';
const DEVICE_ID_STORAGE_KEY = 'open-anki:deviceId';
const DEFAULT_NOTE_TYPE_ID = '1-basic';

const apiBaseUrl = (() => {
  const raw = import.meta.env?.VITE_API_BASE_URL ?? '';
  if (!raw) {
    return '';
  }
  return raw.replace(/\/+$/, '');
})();

const SYNC_BASE_URL = `${apiBaseUrl}/api/v1/sync`;

export interface SyncAuthContext {
  getAccessToken: () => Promise<string | null>;
  requestReauthentication: () => void | Promise<void>;
}

export class SyncConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: unknown,
    public readonly guidance?: string,
  ) {
    super(message);
    this.name = 'SyncConflictError';
  }
}

export class SyncNetworkError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'SyncNetworkError';
  }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  lastSyncedAt: number | null;
}

async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  auth: SyncAuthContext,
): Promise<Response> {
  const token = await auth.getAccessToken();
  if (!token) {
    await Promise.resolve(auth.requestReauthentication());
    throw new SyncNetworkError('Authentication required.', 401);
  }

  const headers = new Headers(init?.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: init?.credentials ?? 'include',
  });

  if (response.status === 401) {
    await Promise.resolve(auth.requestReauthentication());
    throw new SyncNetworkError('Authentication expired.', 401);
  }

  return response;
}

export async function runSyncWorkflow(auth: SyncAuthContext): Promise<SyncResult> {
  const state = await ensureSyncState();
  const session = await fetchSession(auth);
  state.latestServerVersion = Math.max(state.latestServerVersion, session.latestVersion);

  const pushed = await pushPendingOps(state, auth);
  let pulled = 0;

  const pullOutcome = await pullRemoteOps(state, auth);
  pulled = pullOutcome.pulled;
  state.lastPulledVersion = Math.max(state.lastPulledVersion, pullOutcome.latestVersion);
  state.latestServerVersion = Math.max(state.latestServerVersion, pullOutcome.latestVersion);
  state.continuationToken = pullOutcome.continuationToken;

  if (pushed > 0 || pulled > 0) {
    state.lastSyncedAt = Date.now();
  }

  await saveSyncState(state);

  return {
    pushed,
    pulled,
    lastSyncedAt: state.lastSyncedAt ?? null,
  };
}

export async function getSyncStateSnapshot(): Promise<SyncState> {
  return ensureSyncState();
}

async function ensureSyncState(): Promise<SyncState> {
  const existing = await db.syncState.get(SYNC_STATE_ID);
  if (existing) {
    return existing;
  }

  const deviceId = loadOrCreateDeviceId();
  const initialState: SyncState = {
    id: SYNC_STATE_ID,
    deviceId,
    lastPulledVersion: 0,
    latestServerVersion: 0,
    continuationToken: null,
    lastSyncedAt: null,
  };
  await db.syncState.put(initialState);
  return initialState;
}

async function saveSyncState(state: SyncState): Promise<void> {
  await db.syncState.put(state);
}

function loadOrCreateDeviceId(): string {
  if (typeof window === 'undefined') {
    return generateDeviceId();
  }
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    const fresh = generateDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch (error) {
    console.warn('Unable to access localStorage for device ID, falling back to ephemeral ID', error);
    return generateDeviceId();
  }
}

function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `device-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function clearStoredDeviceId(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
  } catch (error) {
    console.warn('Unable to clear stored device ID during sign-out', error);
  }
}

async function fetchSession(auth: SyncAuthContext): Promise<SessionResponse> {
  const response = await fetchWithAuth(
    `${SYNC_BASE_URL}/session`,
    { credentials: 'include' },
    auth,
  );

  if (!response.ok) {
    throw new SyncNetworkError('Failed to establish sync session.', response.status);
  }

  const body: SessionResponse = await response.json();
  return body;
}


async function pushPendingOps(
  state: SyncState,
  auth: SyncAuthContext,
): Promise<number> {
  const pending = await db.syncMeta.orderBy('id').toArray();
  if (pending.length === 0) {
    return 0;
  }

  let nextVersion = Math.max(state.latestServerVersion, state.lastPulledVersion) + 1;
  const ops: SyncOp[] = [];
  const processedIds: number[] = [];

  for (const entry of pending) {
    try {
      const syncOp = await buildSyncOp(entry, nextVersion);
      if (!syncOp) {
        continue;
      }
      ops.push(syncOp);
      nextVersion += 1;
      if (typeof entry.id === 'number') {
        processedIds.push(entry.id);
      }
    } catch (error) {
      console.warn('Skipping sync meta entry due to unresolved payload', entry, error);
    }
  }

  if (ops.length === 0) {
    return 0;
  }


  const response = await fetchWithAuth(
    `${SYNC_BASE_URL}/push`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ deviceId: state.deviceId, ops }),
    },
    auth,
  );

  if (!response.ok) {
    if (response.status === 409) {
      const body = await response.json();
      throw new SyncConflictError(body?.error ?? 'Sync conflict detected', body?.conflicts, body?.guidance);
    }
    throw new SyncNetworkError('Failed to push local changes.', response.status);
  }

  const body = await response.json();
  const currentVersion = typeof body?.currentVersion === 'number' ? body.currentVersion : state.latestServerVersion;
  state.latestServerVersion = Math.max(state.latestServerVersion, currentVersion);
  state.lastPulledVersion = Math.max(state.lastPulledVersion, currentVersion);

  if (processedIds.length > 0) {
    await db.syncMeta.bulkDelete(processedIds);
  }

  await saveSyncState(state);
  return ops.length;
}

async function buildSyncOp(entry: SyncMeta, version: number): Promise<SyncOp | null> {
  const base: Omit<SyncOp, 'entityType' | 'op' | 'version'> = {
    entityId: entry.entityId,
    timestamp: entry.timestamp,
    diff: entry.diff,
  } as const;

  const opType = entry.op === 'update' ? 'update' : 'create';

  switch (entry.entityType) {
    case 'deck':
      if (entry.op === 'delete') {
        return {
          ...base,
          entityType: 'deck',
          op: 'delete',
          version,
        };
      }
      return {
        ...base,
        entityType: 'deck',
        op: opType,
        version,
        payload: await resolveDeckPayload(entry.entityId, entry.payload),
      } satisfies Extract<SyncOp, { entityType: 'deck' }>;
    case 'note':
      if (entry.op === 'delete') {
        return {
          ...base,
          entityType: 'note',
          op: 'delete',
          version,
        };
      }
      return {
        ...base,
        entityType: 'note',
        op: opType,
        version,
        payload: await resolveNotePayload(entry.entityId, entry.payload),
      } satisfies Extract<SyncOp, { entityType: 'note' }>;
    case 'card':
      if (entry.op === 'delete') {
        return {
          ...base,
          entityType: 'card',
          op: 'delete',
          version,
        };
      }
      return {
        ...base,
        entityType: 'card',
        op: opType,
        version,
        payload: await resolveCardPayload(entry.entityId, entry.payload),
      } satisfies Extract<SyncOp, { entityType: 'card' }>;
    case 'review_log':
      if (entry.op === 'delete') {
        return {
          ...base,
          entityType: 'review_log',
          op: 'delete',
          version,
        };
      }
      return {
        ...base,
        entityType: 'review_log',
        op: opType,
        version,
        payload: await resolveReviewLogPayload(entry.entityId, entry.payload),
      } satisfies Extract<SyncOp, { entityType: 'review_log' }>;
    default:
      return null;
  }
}

async function resolveDeckPayload(entityId: string, payload: SyncMeta['payload']): Promise<DeckPayload> {
  if (payload) {
    return deckPayloadSchema.parse(payload);
  }

  const deck = await db.decks.get(entityId);
  if (!deck) {
    throw new Error(`Unable to resolve deck ${entityId} for sync payload`);
  }

  return mapDeckToPayload(deck as Deck);
}

async function resolveNotePayload(entityId: string, payload: SyncMeta['payload']): Promise<NotePayload> {
  if (payload) {
    return notePayloadSchema.parse(payload);
  }

  const note = await db.notes.get(entityId);
  if (!note) {
    throw new Error(`Unable to resolve note ${entityId} for sync payload`);
  }

  return mapNoteToPayload(note as Note);
}

async function resolveCardPayload(entityId: string, payload: SyncMeta['payload']): Promise<CardPayload> {
  if (payload) {
    return cardPayloadSchema.parse(payload);
  }

  const card = await db.cards.get(entityId);
  if (!card) {
    throw new Error(`Unable to resolve card ${entityId} for sync payload`);
  }

  return mapCardToPayload(card as Card);
}

async function resolveReviewLogPayload(
  entityId: string,
  payload: SyncMeta['payload'],
): Promise<ReviewLogPayload> {
  if (payload) {
    return reviewLogPayloadSchema.parse(payload);
  }

  const reviewLog = await db.reviewLogs.get(entityId);
  if (!reviewLog) {
    throw new Error(`Unable to resolve review log ${entityId} for sync payload`);
  }

  return mapReviewLogToPayload(reviewLog as ReviewLog);
}

async function pullRemoteOps(
  state: SyncState,
  auth: SyncAuthContext,
): Promise<{ pulled: number; latestVersion: number; continuationToken: string | null }> {
  let pulled = 0;
  let latestVersion = state.lastPulledVersion;
  let continuationToken = state.continuationToken;
  const baselineVersion = state.lastPulledVersion;

  while (true) {
    const params = new URLSearchParams();
    if (baselineVersion > 0) {
      params.set('sinceVersion', baselineVersion.toString());
    }
    params.set('limit', DEFAULT_PULL_LIMIT.toString());
    params.set('deviceId', state.deviceId);
    if (continuationToken) {
      params.set('continuationToken', continuationToken);
    }

    const response = await fetchWithAuth(
      `${SYNC_BASE_URL}/pull?${params.toString()}`,
      { credentials: 'include' },
      auth,
    );

    if (!response.ok) {
      throw new SyncNetworkError('Failed to pull remote changes.', response.status);
    }

    const body: PullResponse = await response.json();

    for (const op of body.ops) {
      await applyServerOp(op);
    }

    pulled += body.ops.length;
    latestVersion = Math.max(latestVersion, body.newVersion);

    if (!body.hasMore || !body.continuationToken) {
      continuationToken = null;
      break;
    }

    continuationToken = body.continuationToken;
  }

  return { pulled, latestVersion, continuationToken };
}

async function applyServerOp(op: SyncOp): Promise<void> {
  switch (op.entityType) {
    case 'deck':
      await applyDeckOp(op);
      return;
    case 'note':
      await applyNoteOp(op);
      return;
    case 'card':
      await applyCardOp(op);
      return;
    case 'review_log':
      await applyReviewLogOp(op);
      return;
    default:
      console.warn('Skipping unsupported sync entity type', op.entityType);
  }
}

async function applyDeckOp(op: Extract<SyncOp, { entityType: 'deck' }>): Promise<void> {
  if (op.op === 'delete') {
    await db.transaction('rw', db.decks, db.cards, db.reviewLogs, async () => {
      const cardIds = await db.cards.where('deckId').equals(op.entityId).primaryKeys();
      if (cardIds.length > 0) {
        await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
        await db.cards.bulkDelete(cardIds);
      }
      await db.decks.delete(op.entityId);
    });
    return;
  }

  const payload = op.payload;
  if (!payload) {
    throw new Error(`Missing payload for deck operation ${op.entityId}`);
  }

  const existing = await db.decks.get(op.entityId);
  const baseConfig = (payload.config ?? {}) as Record<string, unknown>;
  const existingConfig = existing?.config ?? { difficulty: 'auto' as Deck['config']['difficulty'] };

  const difficultyCandidate = baseConfig.difficulty;
  const difficulty = normalizeDifficulty(
    difficultyCandidate,
    existingConfig.difficulty ?? 'auto',
  );

  const mergedConfig: Deck['config'] = {
    ...existingConfig,
    ...baseConfig,
    difficulty,
  } as Deck['config'];

  if (payload.description !== undefined) {
    mergedConfig.description = payload.description ?? undefined;
  }

  const nextDeck: Deck = {
    id: op.entityId,
    name: payload.name,
    parentId: existing?.parentId ?? null,
    config: mergedConfig,
    createdAt: existing?.createdAt ?? op.timestamp,
    updatedAt: op.timestamp,
  };

  await db.decks.put(nextDeck);
}

async function applyNoteOp(op: Extract<SyncOp, { entityType: 'note' }>): Promise<void> {
  if (op.op === 'delete') {
    await db.transaction('rw', db.notes, db.cards, db.reviewLogs, async () => {
      const cardIds = await db.cards.where('noteId').equals(op.entityId).primaryKeys();
      if (cardIds.length > 0) {
        await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
        await db.cards.bulkDelete(cardIds);
      }
      await db.notes.delete(op.entityId);
    });
    return;
  }

  const payload = op.payload;
  if (!payload) {
    throw new Error(`Missing payload for note operation ${op.entityId}`);
  }

  const normalizedFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.fields ?? {})) {
    normalizedFields[key] = typeof value === 'string' ? value : value != null ? String(value) : '';
  }

  await db.transaction('rw', db.notes, async () => {
    const existing = await db.notes.get(op.entityId);
    const note: Note = {
      id: op.entityId,
      noteTypeId: existing?.noteTypeId ?? resolveNoteTypeId(payload.model_name),
      deckId: payload.deck_id,
      modelName: payload.model_name,
      fields: normalizedFields,
      tags: payload.tags ?? [],
      guid: existing?.guid ?? op.entityId,
    };
    await db.notes.put(note);
  });
}

async function applyCardOp(op: Extract<SyncOp, { entityType: 'card' }>): Promise<void> {
  if (op.op === 'delete') {
    await db.transaction('rw', db.cards, db.reviewLogs, async () => {
      await db.reviewLogs.where('cardId').equals(op.entityId).delete();
      await db.cards.delete(op.entityId);
    });
    return;
  }

  const payload = op.payload;
  if (!payload) {
    throw new Error(`Missing payload for card operation ${op.entityId}`);
  }

  await db.transaction('rw', db.cards, db.notes, async () => {
    const existing = await db.cards.get(op.entityId);
    const relatedNote = await db.notes.get(payload.note_id);
    const fallbackState: Card['state'] = existing?.state ?? 'learning';
    const state = deriveCardStateFromQueue(payload.queue, payload.card_type, fallbackState);

    const deckId = existing?.deckId ?? relatedNote?.deckId ?? 'unknown-deck';
    const due = typeof payload.due === 'number' && Number.isFinite(payload.due)
      ? payload.due
      : existing?.due ?? Date.now();

    const nextCard: Card = {
      id: op.entityId,
      noteId: payload.note_id,
      deckId,
      templateIndex: payload.ordinal ?? existing?.templateIndex ?? 0,
      state,
      due,
      ivl: payload.interval ?? existing?.ivl ?? 0,
      ease: payload.ease_factor ?? existing?.ease ?? 2.5,
      reps: payload.reps ?? existing?.reps ?? 0,
      lapses: payload.lapses ?? existing?.lapses ?? 0,
      cardType: payload.card_type ?? cardStateToCardType(state),
      queue: payload.queue ?? cardStateToQueue(state),
      originalDue: payload.original_due ?? existing?.originalDue ?? null,
    };

    await db.cards.put(nextCard);
  });
}

async function applyReviewLogOp(op: Extract<SyncOp, { entityType: 'review_log' }>): Promise<void> {
  if (op.op === 'delete') {
    await db.reviewLogs.delete(op.entityId);
    return;
  }

  const payload = op.payload;
  if (!payload) {
    throw new Error(`Missing payload for review log operation ${op.entityId}`);
  }

  await db.transaction('rw', db.reviewLogs, async () => {
    const existing = await db.reviewLogs.get(op.entityId);
    const reviewLog: ReviewLog = {
      id: op.entityId,
      cardId: payload.card_id,
      timestamp: payload.timestamp ?? existing?.timestamp ?? Date.now(),
      rating: payload.rating,
      durationMs: payload.duration_ms ?? existing?.durationMs ?? 0,
    };
    await db.reviewLogs.put(reviewLog);
  });
}

function normalizeDifficulty(
  value: unknown,
  fallback: Deck['config']['difficulty'],
): Deck['config']['difficulty'] {
  const allowed: Deck['config']['difficulty'][] = ['easy', 'medium', 'hard', 'auto'];
  if (typeof value === 'string' && allowed.includes(value as Deck['config']['difficulty'])) {
    return value as Deck['config']['difficulty'];
  }
  return fallback ?? 'auto';
}

function resolveNoteTypeId(modelName: string): string {
  const normalized = modelName.trim().toLowerCase();
  if (normalized === 'basic' || normalized === '1-basic') {
    return DEFAULT_NOTE_TYPE_ID;
  }
  return DEFAULT_NOTE_TYPE_ID;
}
