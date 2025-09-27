import type { DeckCardProps } from '@/components/DeckCard';
import { db, type Deck } from './db';
import { generateGUID } from '@/lib/guidUtils'; // 引入新的工具函数

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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const noteTypeExists = await db.noteTypes.get(DEFAULT_NOTE_TYPE_ID);
  
  if (!noteTypeExists) {
      console.warn(`Default NoteType '${DEFAULT_NOTE_TYPE_ID}' not found.`);
  }

  // 写入事务
  await db.transaction('rw', db.decks, db.syncMeta, async (tx) => {
    // 1. Add the Deck
    await db.decks.add(newDeck); 

    // 2. Log the change for future sync
    await db.syncMeta.add({
        entityId: newDeck.id,
        entityType: 'Deck',
        version: Date.now(), 
        op: 'create',
        timestamp: Date.now() 
    });
  });

  return newDeck.id;
}