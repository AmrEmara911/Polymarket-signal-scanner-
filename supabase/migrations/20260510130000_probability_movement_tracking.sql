create table if not exists public.probability_snapshots (
  id uuid default gen_random_uuid() primary key,
  market_id text references public.markets(id),
  probability float,
  recorded_at timestamptz default now()
);

create index if not exists prob_snapshots_market_time_idx
  on public.probability_snapshots (market_id, recorded_at desc);

alter table public.signals add column if not exists probability_change float;
alter table public.signals add column if not exists is_moving boolean default false;
