import {
  DEFAULT_PULL_LIMIT,
  type DeckPayload,
  type PullResponse,
  type SessionResponse,
  type SyncOp,
  deckPayloadSchema,
} from '../../../../shared/src/sync.js';
import { db } from '../db/db';
import type { Deck, SyncMeta, SyncState } from '../../../../shared/src/index.js';

const SYNC_STATE_ID = 'singleton';
const DEVICE_ID_STORAGE_KEY = 'open-anki:deviceId';

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

  const pushed = await pushPendingDeckOps(state, auth);
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


async function pushPendingDeckOps(
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
    if (entry.entityType !== 'deck') {
      continue;
    }

    const syncOp = await buildDeckSyncOp(entry, nextVersion);
    ops.push(syncOp);
    nextVersion += 1;
    if (typeof entry.id === 'number') {
      processedIds.push(entry.id);
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

async function buildDeckSyncOp(entry: SyncMeta, version: number): Promise<SyncOp> {
  const base: Omit<SyncOp, 'entityType' | 'op' | 'version'> = {
    entityId: entry.entityId,
    timestamp: entry.timestamp,
    diff: entry.diff,
  } as const;

  if (entry.op === 'delete') {
    return {
      ...base,
      entityType: 'deck',
      op: 'delete',
      version,
    };
  }

  const payload = await resolveDeckPayload(entry.entityId, entry.payload);
  deckPayloadSchema.parse(payload);

  const opType = entry.op === 'update' ? 'update' : 'create';

  return {
    ...base,
    entityType: 'deck',
    op: opType,
    version,
    payload,
  };
}

async function resolveDeckPayload(entityId: string, payload: SyncMeta['payload']): Promise<DeckPayload> {
  if (payload) {
    return deckPayloadSchema.parse(payload);
  }

  const deck = await db.decks.get(entityId);
  if (!deck) {
    throw new Error(`Unable to resolve deck ${entityId} for sync payload`);
  }

  return mapDeckToPayload(deck);
}

function mapDeckToPayload(deck: Deck): DeckPayload {
  const description = deck.config?.description ?? null;
  const config: DeckPayload['config'] = { ...deck.config };
  if (description === null) {
    delete (config as Record<string, unknown>).description;
  }
  return {
    name: deck.name,
    description,
    config,
  };
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
  if (op.entityType === 'deck') {
    await applyDeckOp(op);
    return;
  }

  console.warn('Skipping unsupported sync entity type', op.entityType);
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
