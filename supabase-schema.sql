-- ═══════════════════════════════════════════════════════════
-- TradeLog — Supabase Schema v3 (Multi-device auto-sync)
-- Run this in Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════

DROP TABLE IF EXISTS tradelog;
DROP TABLE IF EXISTS tradelog_cfg;

-- ── Trades table ──
CREATE TABLE tradelog (
  id          TEXT PRIMARY KEY,
  payload     JSONB        NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_tradelog_updated ON tradelog (updated_at DESC);
ALTER TABLE tradelog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON tradelog FOR ALL USING (true) WITH CHECK (true);

-- ── Config table (portfolio value, dropdowns, features) ──
CREATE TABLE tradelog_cfg (
  key         TEXT PRIMARY KEY,
  payload     JSONB        NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE tradelog_cfg ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_cfg" ON tradelog_cfg FOR ALL USING (true) WITH CHECK (true);

-- ── Enable Realtime on both tables ──
ALTER PUBLICATION supabase_realtime ADD TABLE tradelog;
ALTER PUBLICATION supabase_realtime ADD TABLE tradelog_cfg;

-- ═══ DONE ════════════════════════════════════════════════
-- After running:
-- 1. Settings → paste Supabase URL + Anon Key → Save & Test
-- 2. Trades + config auto-sync on every page load
-- 3. Changes on one device appear on other devices in real-time
-- 4. Works across all browsers/devices with the same Supabase project
