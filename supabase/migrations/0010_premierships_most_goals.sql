-- Most goals scored by a player in a single game (pg page, Show: Single Game)
-- plus season-level Premiership winners (achievements ?show=pr).
alter table public.player_season_stats
  add column if not exists most_goals_game int;

comment on column public.player_season_stats.most_goals_game is
  'Most goals the player scored in a single A-League game.';

create table if not exists public.premiership_seasons (
  club_id int not null references public.clubs(id),
  season text not null,
  primary key (club_id, season)
);
alter table public.premiership_seasons enable row level security;
drop policy if exists "premiership seasons are publicly readable" on public.premiership_seasons;
create policy "premiership seasons are publicly readable"
  on public.premiership_seasons for select using (true);
