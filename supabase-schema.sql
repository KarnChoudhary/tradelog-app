-- ═══════════════════════════════════════════════════════════
-- TradeLog — Supabase Schema
-- Run this in Supabase → SQL Editor before first sync
-- ═══════════════════════════════════════════════════════════

-- Drop if re-running
DROP TABLE IF EXISTS tradelog;

CREATE TABLE tradelog (
  id          TEXT PRIMARY KEY,
  payload     JSONB        NOT NULL,   -- full trade object as JSON
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index for faster ordering
CREATE INDEX idx_tradelog_updated ON tradelog (updated_at DESC);

-- RLS: enable but keep permissive for anon key access
-- (If you add Supabase Auth later, tighten these policies)
ALTER TABLE tradelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read"
  ON tradelog FOR SELECT USING (true);

CREATE POLICY "Allow anon insert"
  ON tradelog FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anon update"
  ON tradelog FOR UPDATE USING (true);

CREATE POLICY "Allow anon delete"
  ON tradelog FOR DELETE USING (true);

-- ═══ DONE ════════════════════════════════════════════════
-- After running this, go to Settings in the app and enter:
--   Project URL  → https://YOUR-PROJECT-ID.supabase.co
--   Anon Key     → eyJhbGci… (from Supabase → Settings → API)
-- Then tap "Push to Cloud" to sync.
