-- Adds per-membership wins and debut age from each club's All Players page.
-- Run this in the Supabase SQL editor, then re-run the scraper to populate.
alter table public.player_clubs
  add column if not exists wins int;
alter table public.player_clubs
  add column if not exists debut_age int;

comment on column public.player_clubs.wins is
  'All-time wins with this club (All Players page).';
comment on column public.player_clubs.debut_age is
  'Player age at debut for this club (All Players page).';
