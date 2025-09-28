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
}

export interface ReviewLog {
  id: string;
  cardId: string;
  timestamp: number;
  rating: number;
  durationMs: number;
}

export interface SyncMeta {
  entityId: string;
  entityType: string;
  version: number;
  op: 'create' | 'update' | 'delete';
  timestamp: number;
}
