-- Ruleset stamp so deployed code can evaluate older grids with their original
-- semantics. 'legacy' = career-wide stat pairing; 'v2' = per-club pairing for
-- PAIR_AWARE_CATEGORIES. New grids are written with 'v2'.
alter table public.grids
  add column if not exists ruleset text not null default 'legacy';
