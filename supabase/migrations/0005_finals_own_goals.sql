-- Finals & own-goal stats (from UAL statistics pages:
--   ?type=pa&season=all&show=fin  -> finals_appearances
--   ?type=pg&season=all&show=fin  -> finals_goals
--   ?type=pg&season=all&show=og   -> own_goals
-- Stored on the season='all' row of each player.)
alter table public.player_season_stats
  add column if not exists finals_appearances int;
alter table public.player_season_stats
  add column if not exists finals_goals int;
alter table public.player_season_stats
  add column if not exists own_goals int;

comment on column public.player_season_stats.finals_appearances is
  'All-time finals appearances (statistics page, Show: Finals Only).';
comment on column public.player_season_stats.finals_goals is
  'All-time finals goals (goals page, Show: Finals Only).';
comment on column public.player_season_stats.own_goals is
  'All-time own goals (goals page, Show: Own Goals Only).';
