import { db, type Card, type ReviewLog } from './db';
import { generateGUID } from '@/lib/guidUtils';
import {
  cardStateToCardType,
  cardStateToQueue,
  mapCardToPayload,
  mapReviewLogToPayload,
} from '@/core/sync/payloadMappers';

const DEFAULT_EASE_FACTOR = 2.5; // 默认初始易度
const SECONDS_IN_DAY = 24 * 60 * 60 * 1000;

/**
 * Calculates the new interval and ease factor based on the SM-2 algorithm (MVP implementation).
 * Anki mapping: rating 1=Again, 2=Hard, 3=Good, 4=Easy.
 * @param card The current card state.
 * @param rating The user's rating (1: Again, 2: Hard, 3: Good, 4: Easy).
 * @returns { interval: number, ease: number, nextDue: number }
 */
function calculateSM2({ card, rating }: { card: Card, rating: ReviewLog['rating'] }): {
  newIvl: number,
  newEase: number,
  nextDue: number
} {
  const q = rating;
  let nextIvl = card.ivl || 0;
  let newEase = card.ease || DEFAULT_EASE_FACTOR;
  let nextDue = Date.now(); 

  // 1. Calculate New Ease Factor (Min 1.3)
  // Remap Anki 1-4 to a 0-5 scale where 3/Good -> 4 and 4/Easy -> 5 for SM-2 formula (simplified)
  let sm2Quality = 0;
  if (q === 4) sm2Quality = 5; 
  else if (q === 3) sm2Quality = 4;
  else if (q === 2) sm2Quality = 3; 
  else if (q === 1) sm2Quality = 2; // Treat 'Again' (1) as SM2 quality 2

  // Update ease only if rated > 1
  if (q > 1) {
    newEase = newEase + (0.1 - (5 - sm2Quality) * (0.08 + (5 - sm2Quality) * 0.02));
    newEase = Math.max(1.3, newEase);
  }
  
  // 2. Calculate next interval (in days)
  if (q < 3) {
      // Again (1) or Hard (2): Lapsed/failed, reset to short step (1 minute for MVP learning)
      newEase = Math.max(1.3, newEase - 0.2);
      nextIvl = 1 / (60 * 24); // 1 minute in days
      nextDue = Date.now() + (1 * 60 * 1000); 
  } else {
      // Good (3) or Easy (4): Successful review
      if (card.ivl === 0 || card.state === 'new') { 
        // Initial Steps (1m, 10m -> graduate to 1d/4d. This skips short steps in MVP, assumes graduating.)
        // Anki default steps: 1m, 10m. Then Good=1d, Easy=4d (Simplified to 10m, 1d/4d from step list)
        if (q === 3) {
           nextIvl = 1; // 1 day for Good
           nextDue = Date.now() + SECONDS_IN_DAY;
        } else { // q === 4
           nextIvl = 4; // 4 days for Easy
           nextDue = Date.now() + (4 * SECONDS_IN_DAY);
        }
      } else {
          // Standard Review Interval
          const ivlMultiplier = q === 4 ? newEase : (q === 3 ? newEase : 1); 
          nextIvl = Math.round(card.ivl * ivlMultiplier);
          nextDue = Date.now() + (nextIvl * SECONDS_IN_DAY);
      }
      // Ensure minimum 1 day interval if graduated
      if (nextIvl < 1) { 
        nextIvl = 1;
        nextDue = Date.now() + SECONDS_IN_DAY;
      }
  }
  
  return { 
    newIvl: nextIvl, 
    newEase: newEase, 
    nextDue: nextDue 
  };
}


/**
 * Processes a user review, updates the card state, and logs the review.
 * @param cardId ID of the card being reviewed.
 * @param rating User rating (1=Again to 4=Easy).
 */
export async function gradeCard(cardId: string, rating: ReviewLog['rating']): Promise<void> {
  const card = await db.cards.get(cardId);
  
  if (!card) {
    console.warn(`Card ${cardId} not found.`);
    return;
  }
  
  const now = Date.now();
  
  // 1. Calculate new schedule parameters
  const { newIvl, newEase, nextDue } = calculateSM2({ card, rating });

  // 2. Determine new state
  let newState: Card['state'] = card.state;

  if (rating <= 2) { 
      // Failed (Again or Hard): return to learning state for short interval (due calculation above handles the step reset)
      newState = 'learning';
  } else if (newIvl >= 1) { 
      // Passed with >= 1 day interval: graduate to review state
      newState = 'review';
  } else {
      // Passed with sub-day interval: remains learning
      newState = 'learning'; 
  }

  
  // 3. Prepare Card Update
  const nextReps = (card.reps ?? 0) + 1;
  const nextLapses = rating <= 2 ? (card.lapses ?? 0) + 1 : card.lapses ?? 0;
  const nextCardType = cardStateToCardType(newState);
  const nextQueue = cardStateToQueue(newState);

  const nextCardState: Card = {
    ...card,
    state: newState,
    due: nextDue,
    ivl: newIvl,
    ease: newEase,
    reps: nextReps,
    lapses: nextLapses,
    cardType: nextCardType,
    queue: nextQueue,
    originalDue: card.originalDue ?? null,
  };
  
  // 4. Create Review Log
  const reviewLog: ReviewLog = {
    id: generateGUID(),
    cardId: cardId,
    timestamp: now,
    rating: rating,
    durationMs: 2000,
  };
  
  // 5. Atomic Update and Logging
  await db.transaction('rw', db.cards, db.reviewLogs, db.syncMeta, async () => {
    await db.cards.put(nextCardState);
    await db.syncMeta.add({
      entityId: nextCardState.id,
      entityType: 'card',
      op: 'update',
      timestamp: now,
      payload: mapCardToPayload(nextCardState),
    });

    await db.reviewLogs.add(reviewLog);
    await db.syncMeta.add({
      entityId: reviewLog.id,
      entityType: 'review_log',
      op: 'create',
      timestamp: now,
      payload: mapReviewLogToPayload(reviewLog),
    });
  });
}


/**
 * Fetches all cards that are currently due.
 */
export async function getDueCards(deckId?: string): Promise<Card[]> {
    const now = Date.now();
    let query = db.cards
        .where('state')
        .anyOf('learning', 'review')
        // Only select cards due up to NOW
        .and(card => card.due <= now);
        
    // Optionally filter by deck
    if (deckId) {
        query = query.and(card => card.deckId === deckId);
    }
    
    const dueCards = await query.toArray();

    // Prioritization: prioritize learning (shorter steps) over review, then by oldest due first.
    return dueCards.sort((a, b) => {
        if (a.state === 'learning' && b.state === 'review') return -1;
        if (a.state === 'review' && b.state === 'learning') return 1;
        return a.due - b.due; 
    });
}