ALTER TABLE device_sync_progress
    ALTER COLUMN last_meta_id TYPE TEXT USING last_meta_id::TEXT;
