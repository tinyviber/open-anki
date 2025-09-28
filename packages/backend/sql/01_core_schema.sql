-- Anki Core Schema for OpenAnki Sync Service
-- This schema implements user isolation via Row Level Security (RLS)

-- Cleanup: Drop tables if they exist to allow clean re-creation
DROP TABLE IF EXISTS device_sync_progress, sync_meta, review_logs, cards, notes, decks CASCADE;

-- 1. Enable Row Level Security (RLS) on the database
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Core Tables

-- Decks table: Represents Anki decks
CREATE TABLE IF NOT EXISTS decks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Supabase Auth User ID
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    config JSONB DEFAULT '{}', -- Deck configuration (new interval, etc.)
    -- FIX: Adding UNIQUE constraint for composite FK
    UNIQUE(user_id, id) 
);

-- Notes table: Represents Anki notes (the content that cards are based on)
CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Supabase Auth User ID
    deck_id UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL, -- e.g., "Basic", "Cloze", etc.
    fields JSONB NOT NULL, -- Contains the actual note content like {"Front": "Hello", "Back": "World"}
    tags TEXT[], -- Array of tags
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- FIX: Adding UNIQUE constraint for composite FK
    UNIQUE(user_id, id), 
    -- Ensure notes belong to the correct user's deck
    FOREIGN KEY (user_id, deck_id) REFERENCES decks(user_id, id) ON DELETE CASCADE
);

-- Cards table: Represents individual flashcards generated from notes
CREATE TABLE IF NOT EXISTS cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Supabase Auth User ID
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL, -- Which card template was used (0 for first, etc.)
    -- SRS scheduling fields (SM-2 algorithm)
    due TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- Next review time
    interval INTEGER DEFAULT 0, -- Interval in days
    ease_factor REAL DEFAULT 2.5, -- Difficulty factor
    reps INTEGER DEFAULT 0, -- Total number of reviews
    lapses INTEGER DEFAULT 0, -- Number of times forgotten
    -- Card state
    card_type INTEGER DEFAULT 0, -- 0=new, 1=learning, 2=review, 3=relearning
    queue INTEGER DEFAULT 0, -- -3=sched buried, -2=user buried, -1=suspended, 0=new, 1=learning, 2=due, 3=in review
    -- Original Anki fields
    original_due INTEGER DEFAULT 0, -- For v1 scheduler compatibility
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- FIX: Adding UNIQUE constraint for composite FK
    UNIQUE(user_id, id), 
    -- Ensure cards belong to the correct user's note
    FOREIGN KEY (user_id, note_id) REFERENCES notes(user_id, id) ON DELETE CASCADE
);

-- Review logs table: Tracks all review events for statistics and scheduling
CREATE TABLE IF NOT EXISTS review_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Supabase Auth User ID
    card_id UUID NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    rating INTEGER NOT NULL, -- 1-4 (Again, Hard, Good, Easy)
    duration_ms INTEGER, -- Time taken to answer the card in milliseconds
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure logs belong to the correct user's card
    FOREIGN KEY (user_id, card_id) REFERENCES cards(user_id, id) ON DELETE CASCADE
);

-- Sync metadata table: Tracks operations for sync conflict resolution
CREATE TABLE IF NOT EXISTS sync_meta (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Supabase Auth User ID
    entity_id UUID NOT NULL, -- ID of the entity that was changed
    entity_type TEXT NOT NULL, -- 'deck', 'note', 'card', 'review_log'
    version BIGINT NOT NULL, -- Timestamp-based version for ordering operations
    op TEXT NOT NULL, -- 'create', 'update', 'delete'
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Payload for additional operation data
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Prevent duplicate operations
    UNIQUE(user_id, entity_id, version)
);

-- Device sync progress table: Tracks per-device pull progress for resuming syncs
CREATE TABLE IF NOT EXISTS device_sync_progress (
    user_id UUID NOT NULL,
    device_id TEXT NOT NULL,
    last_version BIGINT NOT NULL DEFAULT 0,
    last_meta_id BIGINT,
    continuation_token TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, device_id)
);

-- 3. Row Level Security (RLS) Policies
-- These ensure that users can only access their own data

-- RLS helper function assumed (auth.uid() comes from Supabase GoTrue context)

-- Decks RLS
ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
CREATE POLICY decks_isolation_policy ON decks
    FOR ALL USING (user_id = auth.uid());

-- Notes RLS
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_isolation_policy ON notes
    FOR ALL USING (user_id = auth.uid());

-- Cards RLS
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY cards_isolation_policy ON cards
    FOR ALL USING (user_id = auth.uid());

-- Review logs RLS
ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_logs_isolation_policy ON review_logs
    FOR ALL USING (user_id = auth.uid());

-- Sync meta RLS
ALTER TABLE sync_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_meta_isolation_policy ON sync_meta
    FOR ALL USING (user_id = auth.uid());

ALTER TABLE device_sync_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_sync_progress_isolation_policy ON device_sync_progress
    FOR ALL USING (user_id = auth.uid());

-- 4. Indexes for Performance

-- Indexes for foreign key relationships
CREATE INDEX idx_decks_user_id ON decks(user_id);
CREATE INDEX idx_notes_user_id ON notes(user_id);
CREATE INDEX idx_notes_deck_id ON notes(deck_id);
CREATE INDEX idx_cards_user_id ON cards(user_id);
CREATE INDEX idx_cards_note_id ON cards(note_id);
CREATE INDEX idx_review_logs_user_id ON review_logs(user_id);
CREATE INDEX idx_review_logs_card_id ON review_logs(card_id);
CREATE INDEX idx_sync_meta_user_id ON sync_meta(user_id);
CREATE INDEX idx_sync_meta_entity ON sync_meta(entity_id, entity_type);

-- Indexes for common queries
CREATE INDEX idx_decks_created_at ON decks(created_at);
CREATE INDEX idx_notes_updated_at ON notes(updated_at);
CREATE INDEX idx_cards_due ON cards(due);
CREATE INDEX idx_cards_queue ON cards(queue);
CREATE INDEX idx_review_logs_timestamp ON review_logs(timestamp);
CREATE INDEX idx_sync_meta_version ON sync_meta(version);
CREATE INDEX idx_sync_meta_user_version ON sync_meta(user_id, version); -- Critical for sync pull
CREATE INDEX idx_device_sync_progress_user ON device_sync_progress(user_id);

-- 5. Update trigger for "updated_at" columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW(); -- FIX: Syntax corrected to NEW.updated_at
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_decks_updated_at BEFORE UPDATE ON decks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notes_updated_at BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
