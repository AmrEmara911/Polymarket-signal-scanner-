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
│  - 10 markets/batch  │
│  - JSON output       │
│  - Domain grounded   │
└────────┬─────────────┘
         │ enforceValidation() — 6 hard code-level gates
         ▼
┌──────────────────────┐
│  Quality Gate        │  ticker whitelist · probability 15–85%
│  (post-LLM, in code) │  expiry >24h · no price-target markets
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

The LLM filter doesn't use generic tech tickers. It uses a curated list of **23 tickers** derived from BIT Capital's public fund holdings (BIT Global Technology Leaders, etc.) — NVIDIA, ASML, TSMC, Microsoft, Meta, and so on.

This means a market about "EU antitrust action against Apple" gets classified as **directly relevant to AAPL**, while a market about "Will Bitcoin reach $120k?" gets correctly rejected as a pure crypto price target with no BIT Capital exposure.

The prompt explicitly grounds the model: *"You are a senior research analyst at BIT Capital. Here are the only tickers you may use: NVDA, MSFT, GOOGL, META, AAPL, AMZN, AMD, ASML, TSM..."* — and names the exact rejection categories.

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

### 3. Two-layer filter: LLM + code-level gates

A common failure in LLM-based filters is that the model occasionally ignores its own instructions — marking a 95% probability market as "relevant" or returning a valid ticker while setting `is_relevant=false`. To prevent this, the filter runs a **second layer of validation in code** after every LLM response, in `enforceValidation()`:

1. **Ticker whitelist** — `affected_stocks` must contain at least one BIT Capital holding; otherwise rejected.
2. **Confidence floor** — signals below 0.55 confidence are rejected regardless of LLM verdict.
3. **Holdings enforcement** — any ticker not on the whitelist is stripped from the output.
4. **Probability gate** — markets outside the **15–85% informational edge window** are rejected. Below 15% or above 85%, the outcome has reached consensus and is already priced in.
5. **Expiry gate** — markets expiring within 24 hours are rejected; no actionable window remains.
6. **Price-target gate** — markets structured as direct equity price targets ("Will NVDA hit (HIGH) $224?") are rejected; they restate pricing rather than explain a catalyst.

The LLM cannot bypass these gates. If it marks a signal relevant, the code overrides it.

### 4. The "ahead of curve" flag

A signal is only valuable if the market doesn't already know about it. The filter checks for markets where:
- Probability sits between **15–85%** (genuine uncertainty, not consensus)
- Volume > $50K (real money, not a thin market)
- Probability has moved recently (the market is updating its view)

These get flagged as **"ahead of curve"** — the window where the prediction market is pricing something in but the equity market hasn't caught up yet.

### 5. Reports are written like analyst notes, not chatbot summaries

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

## LLM Filter Design

The system prompt is the core intellectual work of this project. It is reproduced exactly below, as it appears in `src/lib/filter.ts`:

```
You are a senior research analyst at BIT Capital, a Berlin-based
asset manager focused on global technology equities. Your job is
to filter Polymarket prediction markets for genuine investment signals.

BIT CAPITAL HOLDINGS (the only tickers you may use):
NVDA, MSFT, GOOGL, GOOG, META, AAPL, AMZN, AMD, ASML, TSM,
ORCL, ADBE, CRM, NOW, PLTR, ARM, AVGO, QCOM, INTC, MU, NFLX,
SHOP, COIN

A MARKET IS RELEVANT ONLY IF ALL THREE ARE TRUE:
  1. You can name at least ONE specific ticker from the holdings
     list above in "affected_stocks". If you cannot name one, the
     market is NOT relevant.
  2. The market has a specific catalyst (regulation, earnings,
     launch, ruling, decision) — not a generic price movement.
  3. The market is not already fully priced in (reject probability
     above 0.85 or below 0.15).

REJECT THESE CATEGORIES ENTIRELY:
  - Pure crypto price targets (e.g. "Will BTC reach $X?")
  - Markets about private companies with no BIT Capital exposure
    (SpaceX, Anthropic, OpenAI as standalones — note: OpenAI IS
    relevant via MSFT exposure)
  - Sports, entertainment, weather, celebrity markets
  - Pure geopolitical hypotheticals with no clear equity read-through
  - Markets resolving in less than 12 hours

FEW-SHOT EXAMPLES:

Market: "Will the Fed cut rates by June 2026?"
Output: {
  "is_relevant": true, "confidence": 0.85,
  "reason": "Direct macro signal for tech multiples; rate cuts benefit
             growth equity valuations across BIT Capital's core holdings.",
  "affected_stocks": ["MSFT", "GOOGL", "META", "NVDA"],
  "signal_type": "macro", "signal_direction": "positive",
  "urgency": "high", "thematic_buckets": ["Macro/Rates", "Big Tech Platforms"],
  "is_ahead_of_curve": false
}

Market: "Will TSMC announce Arizona fab delay before Q3?"
Output: {
  "is_relevant": true, "confidence": 0.82,
  "reason": "Supply chain disruption for advanced node capacity directly
             impacts NVDA, AMD, and AAPL production timelines.",
  "affected_stocks": ["TSM", "NVDA", "AMD", "AAPL"],
  "signal_type": "supply_chain", "signal_direction": "negative",
  "urgency": "medium", "thematic_buckets": ["Semiconductors"],
  "is_ahead_of_curve": true
}

Market: "Will Bitcoin be above $76,000 on May 10?"
Output: {
  "is_relevant": false, "confidence": 0.95,
  "reason": "Pure crypto price target with no specific catalyst.
             No BIT Capital ticker has direct exposure to this outcome.",
  "affected_stocks": [], "signal_type": null,
  "signal_direction": null, "urgency": null,
  "thematic_buckets": [], "is_ahead_of_curve": false
}

Return a JSON object with a "signals" array containing one analyzed
signal per input market, in the same order.
```

The three-criteria framework (specific ticker, specific catalyst, not already priced in) was arrived at after two failed iterations — see [PROJECT_LEARNINGS.md](./PROJECT_LEARNINGS.md) for a full account of the filter evolution and its failure modes.

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
Founder of [Lantern Studio](https://lantern-studio.de) — built and shipped an AI-powered SaaS product for architectural visualization, serving paying customers.

For BIT Capital, May 2026.
