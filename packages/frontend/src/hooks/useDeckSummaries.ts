import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/core/db/db'
import { type DeckCardProps } from '@/components/DeckCard';
import { type Card } from '@/core/db/db'; // Import Card interface for state check
import { formatRelativeTime } from '@/lib/dateUtils';

// Helper function to calculate a simple progress/difficulty score for MVP
function calculateDifficulty(deckId: string): DeckCardProps['difficulty'] {
  // Simple deterministic logic matching App.tsx mocks loosely
  if (deckId === 'deck-1') return 'easy';
  if (deckId === 'deck-2') return 'medium';
  if (deckId === 'deck-3') return 'hard';
  return 'medium';
}

export interface DeckSummary extends DeckCardProps {
    id: string; // Ensure ID is part of the output
}

export function useDeckSummaries(): DeckSummary[] | undefined {
  const query = async () => {
    // 1. Fetch all decks
    const decks = await db.decks.toArray()

    const summaries: DeckSummary[] = []
    const now = Date.now()

    for (const deck of decks) {
      
      const allCardsInDeck: Card[] = await db.cards.where({ deckId: deck.id }).toArray();
      const totalCards = allCardsInDeck.length;

      // Filter due cards (state learning/review AND due time passed)
      const dueCards = allCardsInDeck.filter(card =>
        (card.state === 'learning' || card.state === 'review') && card.due <= now
      ).length;

      // Simplified progress: based on how many cards are no longer 'new'
      const learnedCards = allCardsInDeck.filter(card => card.state !== 'new').length;
      const progress = totalCards === 0 ? 0 : Math.min(100, Math.round((learnedCards / totalCards) * 100))

      // Determine Last Studied time: find the latest review log entry for any card in this deck
      let lastStudiedTimestamp: number | undefined = undefined;

      // Note: This next query step is tricky but crucial. We need the latest log whose cardId
      // is one of the card IDs in the current deck.
      // Since we already loaded all cards in memory, we can use their IDs to query the logs,
      // but to maximize performance (if totalCards is large), we use indices:
      
      const cardIdsInDeck = allCardsInDeck.map(c => c.id);
      
      if (cardIdsInDeck.length > 0) {
        // Find the latest ReviewLog whose cardId is in our deck
        const latestDeckLog = await db.reviewLogs
            .where('cardId') // Indexed field
            .anyOf(cardIdsInDeck)
            .reverse() // Sort by timestamp implicitly by finding the last item in a reverse query on primary key
            .first(); 

        // If no primary index defined, we rely on timestamp sort if it exists or use filter/sort
        // Since reviewLogs is indexed '++id, cardId, timestamp', a reverse query on cardId filter
        // will still require iteration/sorting for time.
        
        // Simpler implementation for MVP leveraging the secondary index and sorting:
        const mostRecentLog = await db.reviewLogs
            .toCollection()
            .filter(log => cardIdsInDeck.includes(log.cardId)) // Inefficient filter if cardIdsInDeck is huge
            .sortBy('timestamp')
            .then(logs => logs[logs.length - 1]); // Get the last one (highest timestamp)

        if (mostRecentLog) {
            lastStudiedTimestamp = mostRecentLog.timestamp;
        }
      }

      const difficulty = deck.config.difficulty || "medium"; // 👈 从 config 中读取难度
      summaries.push({
        id: deck.id,
        title: deck.name,
        description: deck.config.description || deck.name,
        totalCards: totalCards,
        dueCards: dueCards,
        progress: progress,
        lastStudied: formatRelativeTime(lastStudiedTimestamp),
        difficulty: difficulty as DeckCardProps['difficulty'], 
      })
    }

    // Dexie's useLiveQuery subscribes to all tables touched in the query. 
    // Changes to db.decks, db.cards, or db.reviewLogs will re-trigger the query.
    return summaries
  }

  return useLiveQuery(query, []) 
}
