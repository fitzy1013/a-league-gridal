-- A-League Grid Game — initial schema
-- Tables are public-read (RLS select=true). user_results is owner-only.

create table if not exists public.clubs (
  id int primary key,            -- matches Ultimate A-League club_id
  name text not null,
  short_name text not null,      -- e.g. ADL, AKL
  logo_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id int primary key,            -- matches Ultimate A-League player_id
  name text not null,
  position text,
  club_id int references public.clubs (id) on delete set null,
  nationality text,
  nationality_flag_url text,
  updated_at timestamptz not null default now()
);

create index if not exists players_nationality_idx on public.players (nationality);
create index if not exists players_club_id_idx on public.players (club_id);

create table if not exists public.player_season_stats (
  player_id int references public.players (id) on delete cascade,
  season text not null,          -- 'all' = all-time, else '2025-26'
  appearances int,
  goals int,
  assists int,
  yellow_cards int,
  red_cards int,
  clean_sheets int,
  updated_at timestamptz not null default now(),
  primary key (player_id, season)
);

create index if not exists player_season_stats_season_idx on public.player_season_stats (season);

-- All-time club membership. Every player has at least one row (their
-- current/last club); players who moved clubs get additional rows.
create table if not exists public.player_clubs (
  player_id int references public.players (id) on delete cascade,
  club_id int references public.clubs (id) on delete cascade,
  primary key (player_id, club_id)
);

create index if not exists player_clubs_club_id_idx on public.player_clubs (club_id);

create table if not exists public.player_titles (
  player_id int references public.players (id) on delete cascade,
  title text not null,           -- e.g. 'Johnny Warren Medal', 'Golden Boot'
  season text not null default 'All',
  count int not null default 1,
  primary key (player_id, title, season)
);

create table if not exists public.club_titles (
  club_id int references public.clubs (id) on delete cascade,
  title text not null,           -- e.g. 'Premiership', 'Championship', 'FFA Cup'
  season text not null default 'All',
  count int not null default 1,
  primary key (club_id, title, season)
);

create table if not exists public.grids (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,     -- the daily grid's date (UTC)
  row_type text not null,        -- JSON array of category per row, e.g. '["club","goals","nationality"]'
  col_type text not null,
  row_values jsonb not null,     -- label per row
  col_values jsonb not null,
  solution jsonb not null,       -- [{rowIdx,colIdx,playerId}]
  created_at timestamptz not null default now()
);

create table if not exists public.user_results (
  user_id uuid references auth.users (id) on delete cascade,
  grid_id uuid references public.grids (id) on delete cascade,
  correct int not null,
  total int not null,
  finished_at timestamptz not null default now(),
  primary key (user_id, grid_id)
);

-- RLS ----------------------------------------------------------------------

alter table public.clubs enable row level security;
alter table public.players enable row level security;
alter table public.player_season_stats enable row level security;
alter table public.player_clubs enable row level security;
alter table public.player_titles enable row level security;
alter table public.club_titles enable row level security;
alter table public.grids enable row level security;
alter table public.user_results enable row level security;

drop policy if exists "clubs are publicly readable" on public.clubs;
create policy "clubs are publicly readable" on public.clubs
  for select using (true);

drop policy if exists "players are publicly readable" on public.players;
create policy "players are publicly readable" on public.players
  for select using (true);

drop policy if exists "stats are publicly readable" on public.player_season_stats;
create policy "stats are publicly readable" on public.player_season_stats
  for select using (true);

drop policy if exists "club memberships are publicly readable" on public.player_clubs;
create policy "club memberships are publicly readable" on public.player_clubs
  for select using (true);

drop policy if exists "player titles are publicly readable" on public.player_titles;
create policy "player titles are publicly readable" on public.player_titles
  for select using (true);

drop policy if exists "club titles are publicly readable" on public.club_titles;
create policy "club titles are publicly readable" on public.club_titles
  for select using (true);

drop policy if exists "grids are publicly readable" on public.grids;
create policy "grids are publicly readable" on public.grids
  for select using (true);

drop policy if exists "users can read own results" on public.user_results;
create policy "users can read own results" on public.user_results
  for select using (auth.uid() = user_id);

drop policy if exists "users can insert own results" on public.user_results;
create policy "users can insert own results" on public.user_results
  for insert with check (auth.uid() = user_id);

drop policy if exists "users can update own results" on public.user_results;
create policy "users can update own results" on public.user_results
  for update using (auth.uid() = user_id);