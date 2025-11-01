import { db, type Note, type Card } from './db';
import { generateGUID } from '@/lib/guidUtils';
import {
  mapNoteToPayload,
  mapCardToPayload,
  cardStateToCardType,
  cardStateToQueue,
} from '@/core/sync/payloadMappers';

const DEFAULT_NOTE_TYPE_ID = "1-basic"; 

/**
 * Creates a new Note and associated Cards (based on the NoteType's templates) 
 * for the specified deck.
 * @param deckId The ID of the deck to add cards to.
 * @param fields Key-value object of field data (e.g., { "正面": "Hello", "背面": "World" }).
 * @param tags Optional list of tags.
 * @returns The newly created Note ID.
 */
export async function createNoteAndCards({ 
  deckId, 
  fields, 
  tags = [] 
}: { 
  deckId: string; 
  fields: Record<string, string>; 
  tags?: string[];
}): Promise<string> {
  if (!deckId) {
    throw new Error("Deck ID is required to create a note.");
  }
  
  const noteTypeId = DEFAULT_NOTE_TYPE_ID;
  // Note: Assuming NoteType '1-basic' has 1 template and 2 fields: 正面/背面
  const noteType = await db.noteTypes.get(noteTypeId);
  
  if (!noteType) {
    // 理论上 Seeder 已经确保了 NoteType 的存在
    throw new Error(`NoteType with ID ${noteTypeId} not found. Please ensure database is seeded.`);
  }

  const now = Date.now();
  const noteModelName = noteType?.name ?? 'Basic';
  const newNote: Note = {
    id: generateGUID(),
    noteTypeId: noteTypeId,
    deckId,
    modelName: noteModelName,
    fields: { ...fields },
    tags: [...tags],
    guid: generateGUID(),
  };

  // MVP: 为 NoteType 的每个模板创建一张卡片。
  const newCards: Card[] = noteType.templateDefs.map((_, index) => {
    return {
      id: generateGUID(),
      noteId: newNote.id,
      deckId: deckId,
      templateIndex: index,
      state: 'new' as Card['state'],
      due: now,
      ivl: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      cardType: cardStateToCardType('new'),
      queue: cardStateToQueue('new'),
      originalDue: null,
    };
  });


  await db.transaction('rw', db.notes, db.cards, db.syncMeta, async () => {
    // 1. Add the Note
    await db.notes.add(newNote);

    // 2. Add the derived Cards
    if (newCards.length > 0) {
        await db.cards.bulkAdd(newCards);
    }

    const timestamp = Date.now();
    await db.syncMeta.add({
      entityId: newNote.id,
      entityType: 'note',
      op: 'create',
      timestamp,
      payload: mapNoteToPayload(newNote),
    });

    for (const card of newCards) {
      await db.syncMeta.add({
        entityId: card.id,
        entityType: 'card',
        op: 'create',
        timestamp,
        payload: mapCardToPayload(card),
      });
    }
  });

  return newNote.id;
}
