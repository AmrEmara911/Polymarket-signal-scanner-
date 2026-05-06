create table if not exists markets (
  id text primary key,
  question text not null,
  probability float,
  volume float,
  category text,
  end_date timestamptz,
  is_active boolean default true,
  fetched_at timestamptz default now()
);

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  market_id text unique references markets(id),
  is_relevant boolean,
  confidence float,
  reason text,
  affected_stocks text[],
  signal_type text,
  signal_direction text,
  urgency text,
  analyzed_at timestamptz default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz default now(),
  content text,
  market_ids text[],
  signal_count int
);
