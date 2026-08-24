-- Player height in centimetres, scraped from UAL player profile pages
-- ("... is 174 cm tall ..."). Populated by scripts/scrape-heights.ts.
alter table public.players
  add column if not exists height int;

comment on column public.players.height is
  'Player height in cm from their UAL profile page.';
