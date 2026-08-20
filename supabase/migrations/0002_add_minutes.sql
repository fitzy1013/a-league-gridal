-- Adds all-time minutes played to player_season_stats.
-- Run this in the Supabase SQL editor, then re-run the scraper to populate.
alter table public.player_season_stats
  add column if not exists minutes int;

comment on column public.player_season_stats.minutes is
  'All-time minutes played (from the Appearances stats page).';