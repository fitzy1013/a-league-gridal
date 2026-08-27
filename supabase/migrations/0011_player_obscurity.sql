-- Wikipedia-based obscurity scoring.
--   wiki_title          resolved en-wiki article title (null = none found)
--   wiki_views_monthly  median daily->monthly pageviews snapshot used for scoring
--   obscurity           0-100 rating (higher = more obscure); null = not yet crawled
alter table public.players
  add column if not exists wiki_title text;
alter table public.players
  add column if not exists wiki_views_monthly int;
alter table public.players
  add column if not exists obscurity int;

comment on column public.players.wiki_title is
  'Resolved English Wikipedia article title for this player.';
comment on column public.players.wiki_views_monthly is
  'Median monthly Wikipedia pageviews across the last 3 months.';
comment on column public.players.obscurity is
  '0-100 obscurity rating derived from wiki views (log scale, no article = 100).';
