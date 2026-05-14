alter table public.markets
  add column if not exists probability_24h_ago numeric,
  add column if not exists last_updated_at timestamptz default now();

update public.markets
set last_updated_at = coalesce(last_updated_at, fetched_at, now())
where last_updated_at is null;
