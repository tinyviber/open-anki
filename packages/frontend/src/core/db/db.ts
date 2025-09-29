import Dexie, { type Table } from 'dexie';
import {
  type Card,
  type Deck,
  type Note,
  type NoteType,
  type ReviewLog,
  type SyncMeta,
  type SyncState,
} from '../../../../shared/src/index.js';

export class OpenAnkiDB extends Dexie {
  decks!: Table<Deck>;
  noteTypes!: Table<NoteType>;
  notes!: Table<Note>;
  cards!: Table<Card>;
  reviewLogs!: Table<ReviewLog>;
  syncMeta!: Table<SyncMeta>;
  syncState!: Table<SyncState>;

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

    this.version(2)
      .stores({
        decks: '++id, parentId',
        noteTypes: '++id',
        notes: '++id, guid, *tags, noteTypeId',
        cards: '++id, deckId, [state+due], state, noteId',
        reviewLogs: '++id, cardId, timestamp',
        syncMeta: '++id, entityId, entityType',
        syncState: '&id',
      })
      .upgrade(async tx => {
        const syncMetaTable = tx.table('syncMeta');

        await syncMetaTable.toCollection().modify((entry: any) => {
          if (typeof entry.entityType === 'string') {
            entry.entityType = entry.entityType.toLowerCase();
          }
          if (typeof entry.op === 'string') {
            entry.op = entry.op.toLowerCase();
          }
          if (entry.version != null && !Number.isFinite(entry.version)) {
            entry.version = undefined;
          }
        });

        await syncMetaTable
          .filter((entry: any) => entry.entityType !== 'deck')
          .delete();
      });
  }
}

export const db = new OpenAnkiDB();
