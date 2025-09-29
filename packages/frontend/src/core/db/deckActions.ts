import type { DeckCardProps } from '@/components/DeckCard';
import { db, type Deck } from './db';
import { generateGUID } from '@/lib/guidUtils'; // 引入新的工具函数
import type { DeckPayload } from '../../../../shared/src/sync.js';

const DEFAULT_NOTE_TYPE_ID = "1-basic"; 

/**
 * Creates a new Deck entity in the database.
 * @param name The name of the new deck.
 * @param description The description of the new deck (stored in config).
 * @returns The newly created Deck ID.
 */
export async function createDeck({ name, description, difficulty }: { name: string; description?: string, difficulty: DeckCardProps['difficulty']; }): Promise<string> {
  if (!name || name.trim() === "") {
    throw new Error("Deck name cannot be empty.");
  }
  
  const trimmedName = name.trim();

  const timestamp = Date.now();

  const newDeck: Deck = {
    id: generateGUID(),
    name: trimmedName,
    parentId: null,
    // Store description inside config as per model, providing a fallback name.
    config: {
        description: description?.trim() || trimmedName,
        difficulty: difficulty, // 👈 存储难度
        algorithmConfig: {
            initialSteps: [1, 10], // Example: 1 minute, 10 minutes
            newCardsPerDay: 20,
            reviewLimit: 200,
        }
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const deckPayload: DeckPayload = {
    name: trimmedName,
    description: description?.trim() ?? null,
    config: newDeck.config,
  };

  const noteTypeExists = await db.noteTypes.get(DEFAULT_NOTE_TYPE_ID);
  
  if (!noteTypeExists) {
      console.warn(`Default NoteType '${DEFAULT_NOTE_TYPE_ID}' not found.`);
  }

  // 写入事务
  await db.transaction('rw', db.decks, db.syncMeta, async () => {
    // 1. Add the Deck
    await db.decks.add(newDeck);

    // 2. Log the change for future sync
    await db.syncMeta.add({
        entityId: newDeck.id,
        entityType: 'deck',
        op: 'create',
        timestamp,
        payload: deckPayload,
        diff: { name: { from: null, to: trimmedName } },
    });
  });

  return newDeck.id;
}

export async function deleteDeck(deckId: string): Promise<void> {
  if (!deckId) {
    throw new Error("Deck ID is required to delete a deck.");
  }

  await db.transaction('rw', db.decks, db.cards, db.notes, db.reviewLogs, db.syncMeta, async () => {
    const deck = await db.decks.get(deckId);
    if (!deck) {
      return;
    }

    const cardsInDeck = await db.cards.where('deckId').equals(deckId).toArray();
    const cardIds = cardsInDeck.map(card => card.id);
    const noteIds = Array.from(new Set(cardsInDeck.map(card => card.noteId)));

    if (cardIds.length > 0) {
      await db.cards.bulkDelete(cardIds);
      await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
    }

    if (noteIds.length > 0) {
      const notesToDelete: string[] = [];
      for (const noteId of noteIds) {
        const existsInOtherDeck = await db.cards
          .where('noteId')
          .equals(noteId)
          .and(card => card.deckId !== deckId)
          .first();

        if (!existsInOtherDeck) {
          notesToDelete.push(noteId);
        }
      }

      if (notesToDelete.length > 0) {
        await db.notes.bulkDelete(notesToDelete);
      }
    }

    await db.decks.delete(deckId);

    const timestamp = Date.now();
    await db.syncMeta.add({
      entityId: deckId,
      entityType: 'deck',
      op: 'delete',
      timestamp,
    });
  });
}
