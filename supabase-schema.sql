-- ═══════════════════════════════════════════════════════════
-- TradeLog — Supabase Schema v2 (with Realtime)
-- Run this in Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════

DROP TABLE IF EXISTS tradelog;

CREATE TABLE tradelog (
  id          TEXT PRIMARY KEY,
  payload     JSONB        NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_tradelog_updated ON tradelog (updated_at DESC);

ALTER TABLE tradelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON tradelog FOR ALL USING (true) WITH CHECK (true);

-- ── Enable Realtime (auto-sync across devices) ──
ALTER PUBLICATION supabase_realtime ADD TABLE tradelog;

-- ═══ DONE ════════════════════════════════════════════════
-- After running:
-- 1. Settings → paste Supabase URL + Anon Key → Save & Test
-- 2. App auto-syncs on every page load
-- 3. Changes on one device appear on other devices in real-time
