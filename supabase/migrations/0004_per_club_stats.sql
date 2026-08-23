-- Per-club all-time stats (from each club's All Players page).
-- Used for Club x Stat cells so e.g. "Melbourne Victory x 20+ Goals"
-- requires 20+ goals scored FOR Melbourne Victory.
alter table public.player_clubs
  add column if not exists appearances int;
alter table public.player_clubs
  add column if not exists goals int;
alter table public.player_clubs
  add column if not exists yellow_cards int;
alter table public.player_clubs
  add column if not exists red_cards int;

comment on column public.player_clubs.appearances is
  'All-time appearances for this club (GP column, All Players page).';
comment on column public.player_clubs.goals is
  'All-time goals for this club (All Players page).';
comment on column public.player_clubs.yellow_cards is
  'All-time yellow cards for this club (All Players page).';
comment on column public.player_clubs.red_cards is
  'All-time red cards for this club (All Players page).';
