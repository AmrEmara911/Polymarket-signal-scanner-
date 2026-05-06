create extension if not exists pgcrypto;

create table if not exists markets (
  id text primary key,
  slug text,
  question text not null,
  description text,
  probability double precision,
  yes_price double precision,
  no_price double precision,
  volume double precision default 0,
  liquidity double precision default 0,
  category text,
  end_date timestamptz,
  is_active boolean default true,
  raw jsonb,
  first_seen_at timestamptz default now(),
  fetched_at timestamptz default now()
);

alter table markets add column if not exists slug text;
alter table markets add column if not exists description text;
alter table markets add column if not exists yes_price double precision;
alter table markets add column if not exists no_price double precision;
alter table markets add column if not exists liquidity double precision default 0;
alter table markets add column if not exists raw jsonb;
alter table markets add column if not exists first_seen_at timestamptz default now();

create table if not exists analyst_config (
  id text primary key default 'default',
  sectors text[] not null default '{}',
  stocks text[] not null default '{}',
  focus_notes text not null default '',
  updated_at timestamptz default now()
);

insert into analyst_config (id, sectors, stocks, focus_notes)
values (
  'default',
  array[
    'AI infrastructure',
    'Semiconductors',
    'Semiconductor equipment',
    'Cloud platforms',
    'Enterprise software',
    'Consumer internet',
    'Digital payments',
    'Digital assets',
    'Cybersecurity'
  ],
  array[
    'NVDA',
    'AMD',
    'AVGO',
    'ASML',
    'AMAT',
    'LRCX',
    'MSFT',
    'GOOGL',
    'AMZN',
    'META',
    'AAPL',
    'CRM',
    'V',
    'MA',
    'PYPL',
    'ADYEN',
    'COIN',
    'MSTR'
  ],
  'Prioritize public technology equities where Polymarket probabilities can change growth expectations, margins, regulation, supply chains, or valuation multiples.'
)
on conflict (id) do nothing;

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  market_id text unique references markets(id) on delete cascade,
  is_relevant boolean not null default false,
  relevance_score double precision default 0,
  confidence double precision default 0,
  reason text,
  affected_stocks text[] default '{}',
  affected_sectors text[] default '{}',
  signal_type text,
  signal_direction text,
  urgency text default 'low',
  thesis text,
  evidence text[] default '{}',
  key_risks text[] default '{}',
  suggested_action text,
  model text,
  analyzed_at timestamptz default now()
);

alter table signals add column if not exists relevance_score double precision default 0;
alter table signals add column if not exists affected_sectors text[] default '{}';
alter table signals add column if not exists thesis text;
alter table signals add column if not exists evidence text[] default '{}';
alter table signals add column if not exists key_risks text[] default '{}';
alter table signals add column if not exists suggested_action text;
alter table signals add column if not exists model text;

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz default now(),
  title text,
  summary text,
  content text,
  key_takeaways text[] default '{}',
  market_ids text[] default '{}',
  signal_count int default 0,
  model text
);

alter table reports add column if not exists title text;
alter table reports add column if not exists summary text;
alter table reports add column if not exists key_takeaways text[] default '{}';
alter table reports add column if not exists model text;

create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'manual',
  status text not null default 'running',
  started_at timestamptz default now(),
  finished_at timestamptz,
  markets_ingested int default 0,
  markets_analyzed int default 0,
  relevant_signals int default 0,
  report_id uuid references reports(id) on delete set null,
  error text
);

create table if not exists config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create index if not exists markets_active_volume_idx on markets (is_active, volume desc);
create index if not exists signals_relevance_idx on signals (is_relevant, relevance_score desc);
create index if not exists reports_generated_at_idx on reports (generated_at desc);
create index if not exists pipeline_runs_started_at_idx on pipeline_runs (started_at desc);
