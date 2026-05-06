-- Polymarket Signal Scanner schema

create table if not exists markets (
  id text primary key,
  question text not null,
  description text,
  outcomes text[],
  outcome_prices numeric[],
  volume numeric,
  end_date timestamptz,
  active boolean default true,
  fetched_at timestamptz default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_at timestamptz default now()
);
