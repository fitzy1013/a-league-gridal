-- Per-club tenure detail from player profile History tables, plus
-- season-level Championship winners from the achievements page.
-- Populated by scripts/scrape-player-history.ts and the main scraper.

alter table public.player_clubs
  add column if not exists clean_sheets int;
alter table public.player_clubs
  add column if not exists minutes int;
alter table public.player_clubs
  add column if not exists seasons text;

comment on column public.player_clubs.clean_sheets is
  'All-time clean sheets at this club (from profile History tables).';
comment on column public.player_clubs.minutes is
  'All-time minutes at this club (from profile History tables).';
comment on column public.player_clubs.seasons is
  'Comma-separated seasons the player was registered at this club.';

create table if not exists public.championship_seasons (
  club_id int not null references public.clubs(id),
  season text not null,
  primary key (club_id, season)
);
alter table public.championship_seasons enable row level security;
drop policy if exists "championship seasons are publicly readable" on public.championship_seasons;
create policy "championship seasons are publicly readable"
  on public.championship_seasons for select using (true);
