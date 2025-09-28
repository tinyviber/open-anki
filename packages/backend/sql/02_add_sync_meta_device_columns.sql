-- Migration to add device tracking columns to sync_meta
ALTER TABLE sync_meta
    ADD COLUMN IF NOT EXISTS device_id TEXT NOT NULL DEFAULT 'unknown-device';

ALTER TABLE sync_meta
    ADD COLUMN IF NOT EXISTS diff JSONB;

CREATE INDEX IF NOT EXISTS idx_sync_meta_user_device ON sync_meta(user_id, device_id);
