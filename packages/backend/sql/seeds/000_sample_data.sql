-- Seed data for local development
INSERT INTO decks (id, user_id, name, description, config)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Sample Deck',
  'Demo deck for local development',
  '{}'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notes (id, user_id, deck_id, model_name, fields, tags)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Basic',
  '{"Front": "What is OpenAnki?", "Back": "An open source sync service."}',
  ARRAY['demo']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO cards (id, user_id, note_id, ordinal, due, interval, ease_factor, reps, lapses, card_type, queue, original_due)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  0,
  NOW(),
  0,
  2.5,
  0,
  0,
  0,
  0,
  0
)
ON CONFLICT (id) DO NOTHING;
