import type {
  CardPayload,
  DeckPayload,
  EntityType,
  NotePayload,
  OperationType,
  ReviewLogPayload,
} from './sync.js';

export interface DeckConfig {
  description?: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'auto';
  algorithmConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Deck {
  id: string;
  name: string;
  parentId: string | null;
  config: DeckConfig;
  createdAt: number;
  updatedAt: number;
}

export interface NoteTypeFieldDef {
  name: string;
  type: 'text' | 'rich';
}

export interface NoteTypeTemplateDef {
  name: string;
  qfmt: string;
  afmt: string;
}

export interface NoteType {
  id: string;
  name: string;
  fieldDefs: NoteTypeFieldDef[];
  templateDefs: NoteTypeTemplateDef[];
}

export interface Note {
  id: string;
  noteTypeId: string;
  deckId: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
  guid: string;
}

export interface Card {
  id: string;
  noteId: string;
  deckId: string;
  templateIndex: number;
  state: 'new' | 'learning' | 'review' | 'suspended' | 'buried';
  due: number;
  ivl: number;
  ease: number;
  reps: number;
  lapses: number;
  cardType: number;
  queue: number;
  originalDue: number | null;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  timestamp: number;
  rating: number;
  durationMs: number;
}

export interface SyncMeta {
  id?: number;
  entityId: string;
  entityType: EntityType;
  op: OperationType;
  timestamp: number;
  version?: number;
  payload?: DeckPayload | NotePayload | CardPayload | ReviewLogPayload;
  diff?: unknown;
}

export interface SyncState {
  id: string;
  deviceId: string;
  lastPulledVersion: number;
  latestServerVersion: number;
  continuationToken: string | null;
  lastSyncedAt?: number | null;
}
