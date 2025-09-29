import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Card, type Deck, type Note } from '@/core/db/db';
import { formatRelativeTime } from '@/lib/dateUtils';

export interface DeckCardDetail {
  id: string;
  state: Card['state'];
  due: number;
  dueLabel: string;
  noteId: string;
  front?: string;
  back?: string;
  tags: string[];
}

export interface DeckDetailData {
  deck: Deck;
  stats: {
    total: number;
    new: number;
    learning: number;
    review: number;
    suspended: number;
    buried: number;
    due: number;
    progress: number;
  };
  lastStudied?: string;
  cards: DeckCardDetail[];
}

async function fetchDeckDetail(deckId: string): Promise<DeckDetailData | null> {
  const deck = await db.decks.get(deckId);
  if (!deck) {
    return null;
  }

  const cards = await db.cards.where('deckId').equals(deckId).toArray();
  const noteIds = Array.from(new Set(cards.map(card => card.noteId)));
  const notes = noteIds.length > 0 ? await db.notes.bulkGet(noteIds) : [];
  const noteMap = new Map<string, Note>();
  notes.forEach(note => {
    if (note) {
      noteMap.set(note.id, note);
    }
  });

  const cardIds = cards.map(card => card.id);
  const logs = cardIds.length > 0
    ? await db.reviewLogs.where('cardId').anyOf(cardIds).toArray()
    : [];

  const lastStudiedTimestamp = logs.length > 0
    ? logs.reduce((max, log) => Math.max(max, log.timestamp), 0)
    : undefined;

  const now = Date.now();
  type MutableStats = {
    total: number;
    new: number;
    learning: number;
    review: number;
    suspended: number;
    buried: number;
    due: number;
    learned: number;
  };

  const stats = cards.reduce<MutableStats>(
      (acc, card) => {
        const stateKey = card.state as keyof MutableStats;
        acc.total += 1;
        acc[stateKey] += 1;
        if ((card.state === 'learning' || card.state === 'review') && card.due <= now) {
          acc.due += 1;
        }
        if (card.state !== 'new') {
          acc.learned += 1;
        }
        return acc;
      },
    {
      total: 0,
      new: 0,
      learning: 0,
      review: 0,
      suspended: 0,
      buried: 0,
      due: 0,
      learned: 0,
    },
  );

  const progress = stats.total === 0 ? 0 : Math.round((stats.learned / stats.total) * 100);

  const cardDetails = cards
    .slice()
    .sort((a, b) => a.due - b.due)
    .map(card => {
      const note = noteMap.get(card.noteId);
      const front = note?.fields?.['正面'];
      const back = note?.fields?.['背面'];
      const dueLabel = formatRelativeTime(card.due, { now });
      return {
        id: card.id,
        state: card.state,
        due: card.due,
        dueLabel: dueLabel ?? '未知',
        noteId: card.noteId,
        front,
        back,
        tags: note?.tags ?? [],
      };
    });

  return {
    deck,
    stats: {
      total: stats.total,
      new: stats.new,
      learning: stats.learning,
      review: stats.review,
      suspended: stats.suspended,
      buried: stats.buried,
      due: stats.due,
      progress,
    },
    lastStudied: formatRelativeTime(lastStudiedTimestamp),
    cards: cardDetails,
  };
}

export function useDeckDetail(deckId: string | undefined) {
  return useLiveQuery(() => {
    if (!deckId) {
      return undefined;
    }
    return fetchDeckDetail(deckId);
  }, [deckId]);
}
