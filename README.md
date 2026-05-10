# BIT Capital Signal Scanner

> AI-powered prediction market scanner that filters Polymarket signals relevant to tech equities and generates analyst-grade morning briefings using LLMs.

Built as a technical case study for the **AI Engineering Intern** position at [BIT Capital](https://bitcap.com), a Berlin-based asset manager focused on global technology leaders.

---

## What it does

Polymarket hosts thousands of prediction markets every day — Fed decisions, tariffs, AI regulation, company milestones, sports, celebrity news, weather. **Most are noise.** A small fraction contain real signals for equity investors.

This scanner:

1. **Ingests** ~1,000 active prediction markets from Polymarket every 6 hours
2. **Filters** them using an LLM grounded in BIT Capital's actual portfolio holdings (sourced from public 13F filings)
3. **Classifies** relevant signals by urgency, direction, signal type, and thematic exposure
4. **Generates** structured morning briefings styled as analyst notes
5. **Surfaces** everything through a dark-mode dashboard built for finance professionals

The goal: turn ~1,000 daily markets into a 5-minute morning read with the **3 signals an analyst should act on today**.

---

## Architecture

```
┌─────────────────┐
│  Polymarket API │  (public, no auth)
└────────┬────────┘
         │ fetch every 6 hours
         ▼
┌──────────────────────┐
│  Ingestion Pipeline  │  src/lib/polymarket.ts
└────────┬─────────────┘
         │ upsert
         ▼
┌──────────────────────┐
│  Supabase (Postgres) │  markets, signals, reports, config
└────────┬─────────────┘
         │ query unanalyzed
         ▼
┌──────────────────────┐
│  LLM Filter          │  src/lib/filter.ts (OpenAI GPT-4o-mini)
│  - 15 markets/batch  │
│  - JSON output       │
│  - Domain grounded   │
└────────┬─────────────┘
         │ stores structured signals
         ▼
┌──────────────────────┐
│  Report Generator    │  src/lib/reports.ts
│  - Morning briefing  │
│  - Top 3 to act on   │
│  - Contrarian take   │
└────────┬─────────────┘
         │ rendered in
         ▼
┌──────────────────────┐
│  Next.js Frontend    │  Dashboard, Signals, Reports, Settings
└──────────────────────┘
```

### Tech stack

- **Frontend:** Next.js 14, TypeScript, Tailwind CSS
- **Backend:** Next.js API routes
- **Database:** Supabase (PostgreSQL)
- **LLM:** OpenAI GPT-4o-mini
- **Scheduler:** node-cron (every 6 hours, configurable via UI)
- **PDF generation:** jsPDF
- **Hosting:** Designed to run locally; deployable to Vercel

---

## Why this approach

### 1. Filtering is grounded in real BIT Capital holdings

The LLM filter doesn't use generic tech tickers. It uses a curated list of ~30 tickers derived from BIT Capital's public fund holdings (BIT Global Technology Leaders, etc.) — NVIDIA, ASML, TSMC, Microsoft, Meta, and so on.

This means a market about "EU antitrust action against Apple" gets classified as **directly relevant to AAPL**, while a market about "Will Bitcoin reach $120k?" gets correctly tagged as **thematic** (crypto sentiment / risk-on) rather than directly actionable.

The prompt explicitly tells the model: *"You are filtering signals for analysts at BIT Capital, a fund focused on global technology equities. Here are the tickers we track..."*

This single design choice eliminates ~80% of the noise that a generic "is this finance-related?" filter would let through.

### 2. Structured output, not free text

Every filtered market produces a strict JSON object:

```json
{
  "is_relevant": true,
  "confidence": 0.84,
  "reason": "Direct read on TSMC's Arizona expansion timeline, which BIT Capital portfolio companies depend on for advanced node supply.",
  "affected_stocks": ["TSM", "NVDA", "AMD"],
  "signal_type": "supply_chain",
  "signal_direction": "negative",
  "urgency": "medium",
  "thematic_buckets": ["semiconductors", "geopolitics"],
  "is_ahead_of_curve": false
}
```

This is queryable, sortable, and aggregatable. The UI doesn't have to parse natural language — it just renders structured fields. An analyst can filter by urgency, ticker, or signal type in one click.

### 3. The "ahead of curve" flag

A signal is only valuable if the market doesn't already know about it. The filter checks for markets where:
- Probability sits between 25–75% (genuine uncertainty, not consensus)
- Volume > $50K (real money, not a thin market)
- Probability has moved recently (the market is updating)

These get flagged as **"ahead of curve"** — the kind of signal an analyst would want to investigate before the equity market repriced.

### 4. Reports are written like analyst notes, not chatbot summaries

The report generator uses a separate LLM call with a prompt that explicitly mimics a sell-side analyst tone: short paragraphs, named tickers, explicit direction, contrarian section at the end. Output is rendered as Markdown and exportable as PDF.

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/AmrEmara911/Polymarket-signal-scanner-.git
cd Polymarket-signal-scanner-
npm install
```

### 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Open the SQL editor and run `supabase/schema.sql` to create the tables
3. Optionally, run `supabase/sample_data.sql` to pre-populate demo data so you can see the UI immediately

### 3. Configure environment variables

Copy the example file:

```bash
cp .env.example .env.local
```

Fill in your credentials in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
OPENAI_API_KEY=sk-...
```

Find Supabase credentials at: **Supabase Dashboard → Settings → API → "Publishable key" and "Project URL"**

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Trigger your first pipeline

Click **"Run Pipeline Now"** on the dashboard. Takes ~45–60 seconds:

- Ingests ~1,000 markets from Polymarket
- Analyzes ~30–40 new markets with the LLM
- Generates a fresh morning briefing

After completion, signals populate across the Dashboard, Signals page, and Reports page.

---

## Features

### Dashboard
- KPI strip: total markets tracked, signals today, top urgency level, last pipeline run
- Top 5 signals of the day, sorted by urgency + confidence
- One-click "Run Pipeline Now" trigger
- Most recent morning briefing inline

### Signals page
- Full signals database, filterable by:
  - Affected ticker
  - Signal type (regulation, supply chain, demand, geopolitics, etc.)
  - Direction (positive / negative / neutral)
  - Urgency (high / medium / low)
- Each signal links back to the source Polymarket page

### Reports page
- Archive of all generated morning briefings
- Markdown rendering with collapsible sections
- One-click PDF export

### Settings page
- Edit the watched tickers list (changes flow into the next LLM call)
- Adjust filter sensitivity threshold
- Set scheduler frequency (every 1h, 6h, 12h, 24h)

---

## Project structure

```
Polymarket-signal-scanner-/
├── README.md                          ← this file
├── PROJECT_LEARNINGS.md               ← reflection on the build
├── package.json
├── .env.example
├── next.config.mjs
│
├── src/
│   ├── app/
│   │   ├── page.tsx                   ← Dashboard
│   │   ├── signals/page.tsx           ← Full signals database
│   │   ├── reports/page.tsx           ← Past briefings + PDF download
│   │   ├── settings/page.tsx          ← Watched stocks, filter sensitivity
│   │   └── api/
│   │       ├── ingest/                ← Fetch from Polymarket
│   │       ├── analyze/               ← Run LLM filter
│   │       ├── report/                ← Generate briefing
│   │       └── scheduler/config/      ← Save user preferences
│   │
│   ├── lib/
│   │   ├── polymarket.ts              ← API ingestion logic
│   │   ├── filter.ts                  ← LLM filter pipeline
│   │   ├── reports.ts                 ← Report generation
│   │   ├── scheduler.ts               ← Cron job setup
│   │   ├── supabase.ts                ← DB client
│   │   └── format-time.ts             ← Relative timestamps
│   │
│   └── components/
│       └── MarketLink.tsx             ← Polymarket source links
│
└── supabase/
    ├── schema.sql                     ← Database schema
    └── sample_data.sql                ← Pre-populated demo data
```

---

## Database schema

```sql
markets             -- raw Polymarket data
  id, question, probability, volume, category,
  end_date, slug, market_url, fetched_at

signals             -- LLM-analyzed signals
  id, market_id, is_relevant, confidence, reason,
  affected_stocks, signal_type, signal_direction, urgency,
  thematic_buckets, is_ahead_of_curve, analyzed_at

reports             -- generated analyst briefings
  id, generated_at, content, market_ids, signal_count

config              -- user preferences
  key, value, updated_at
```

Foreign keys link `signals.market_id → markets.id`, and `reports.market_ids` references the markets table.

---

## What I'd build next

Documented in detail in [PROJECT_LEARNINGS.md](./PROJECT_LEARNINGS.md). Short list:

- **Cross-signal pattern detection** — connect related markets (e.g., "Fed cuts rates" + "Recession by 2027") into composite narratives
- **Probability divergence vs. equity prices** — when Polymarket says 60% but the implied probability from stock prices says 30%, that's the real alpha
- **Calibration tracking** — log every prediction and verify that "confidence: 0.85" actually means 85% accuracy over time
- **Multi-pass LLM reasoning** — second pass to challenge the first pass's conclusion, surface dissent

---

## Submission notes

- **Time invested:** ~7 days (compressed from the 2-week brief)
- **Lines of code:** ~3,400 TypeScript across frontend, API, and pipeline
- **API costs incurred during build:** ~$4 in OpenAI usage
- **Live deployment:** runs locally with the steps above

---

## Built by

**Amr Emara** — M.Eng. Integrated Design (Computational Design), TH OWL.
Founder of [Lantern Studio](https://lantern-studio.de) — AI visualization SaaS for interior designers.

For BIT Capital, May 2026.
