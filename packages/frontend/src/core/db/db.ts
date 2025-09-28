import Dexie, { type Table } from 'dexie';
import {
  type Card,
  type Deck,
  type Note,
  type NoteType,
  type ReviewLog,
  type SyncMeta,
} from '../../../../shared/src/index.js';

export class OpenAnkiDB extends Dexie {
  decks!: Table<Deck>;
  noteTypes!: Table<NoteType>;
  notes!: Table<Note>;
  cards!: Table<Card>;
  reviewLogs!: Table<ReviewLog>;
  syncMeta!: Table<SyncMeta>;

  constructor() {
    super('OpenAnkiDB');
    this.version(1).stores({
      decks: '++id, parentId',
      noteTypes: '++id',
      notes: '++id, guid, *tags, noteTypeId',
      cards: '++id, deckId, [state+due], state, noteId',
      reviewLogs: '++id, cardId, timestamp',
      syncMeta: '++id, entityId, entityType',
    });
  }
}

export const db = new OpenAnkiDB();
