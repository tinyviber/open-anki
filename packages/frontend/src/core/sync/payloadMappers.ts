import type { Card, Deck, Note, ReviewLog } from '../db/db';
import type {
  CardPayload,
  DeckPayload,
  NotePayload,
  ReviewLogPayload,
} from '../../../../shared/src/sync.js';

type CardState = Card['state'];

export function mapDeckToPayload(deck: Deck): DeckPayload {
  const description = deck.config?.description ?? null;
  const config: DeckPayload['config'] = { ...deck.config };
  if (description === null) {
    delete (config as Record<string, unknown>).description;
  }
  return {
    name: deck.name,
    description,
    config,
  };
}

export function mapNoteToPayload(note: Note): NotePayload {
  return {
    deck_id: note.deckId,
    model_name: note.modelName,
    fields: { ...note.fields },
    tags: note.tags ?? [],
  };
}

export function mapCardToPayload(card: Card): CardPayload {
  return {
    note_id: card.noteId,
    ordinal: card.templateIndex,
    due: Number.isFinite(card.due) ? card.due : null,
    interval: card.ivl,
    ease_factor: card.ease,
    reps: card.reps,
    lapses: card.lapses,
    card_type: card.cardType ?? cardStateToCardType(card.state),
    queue: card.queue ?? cardStateToQueue(card.state),
    original_due: card.originalDue ?? null,
  };
}

export function mapReviewLogToPayload(log: ReviewLog): ReviewLogPayload {
  return {
    card_id: log.cardId,
    timestamp: Number.isFinite(log.timestamp) ? log.timestamp : Date.now(),
    rating: log.rating,
    duration_ms: log.durationMs ?? null,
  };
}

export function cardStateToCardType(state: CardState): number {
  switch (state) {
    case 'new':
      return 0;
    case 'learning':
      return 1;
    case 'review':
      return 2;
    case 'suspended':
      return 3;
    case 'buried':
      return 4;
    default:
      return 1;
  }
}

export function cardStateToQueue(state: CardState): number {
  switch (state) {
    case 'new':
      return 0;
    case 'learning':
      return 1;
    case 'review':
      return 2;
    case 'suspended':
      return -1;
    case 'buried':
      return -2;
    default:
      return 1;
  }
}

export function deriveCardStateFromQueue(
  queue: number | null | undefined,
  cardType: number | null | undefined,
  fallback: CardState,
): CardState {
  if (queue === 0) {
    return 'new';
  }
  if (queue === 1) {
    return 'learning';
  }
  if (queue === 2) {
    return 'review';
  }
  if (queue === -1) {
    return 'suspended';
  }
  if (queue === -2) {
    return 'buried';
  }

  switch (cardType) {
    case 0:
      return 'new';
    case 1:
      return 'learning';
    case 2:
      return 'review';
    case 3:
      return 'suspended';
    case 4:
      return 'buried';
    default:
      return fallback;
  }
}
