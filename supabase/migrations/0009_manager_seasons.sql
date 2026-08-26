-- Manager tenures scraped from UAL manager profiles
-- (/manager/?manager_id=N -> manager-clubs-data-table):
-- one row per manager-club-season with games managed.
create table if not exists public.manager_seasons (
  manager_id int not null,
  manager_name text not null,
  club_id int not null references public.clubs(id),
  season text not null,
  games int,
  primary key (manager_id, club_id, season)
);
alter table public.manager_seasons enable row level security;
drop policy if exists "manager seasons are publicly readable" on public.manager_seasons;
create policy "manager seasons are publicly readable"
  on public.manager_seasons for select using (true);
