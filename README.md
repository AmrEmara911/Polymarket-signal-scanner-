# Polymarket Signal Scanner

AI-powered scanner that ingests active Polymarket markets, filters for public-equity relevance with OpenAI, and generates analyst-ready signal reports for a BIT Capital-style technology equity workflow.

## What It Does

- Pulls active markets from the public Polymarket Gamma API.
- Stores normalized market data in Supabase Postgres.
- Lets analysts configure sectors and stock tickers.
- Uses OpenAI to judge whether each market has an equity transmission path.
- Stores structured signals with relevance score, confidence, affected tickers, thesis, risks, and next research action.
- Generates markdown signal reports from the strongest current signals.
- Exposes a small local web UI for configuration, pipeline runs, signal browsing, and report history.
- Includes a scheduled `/api/cron` endpoint for Vercel Cron or another scheduler.

## Priority Alignment With The Case Study

The implementation focuses on the requested weighting:

1. LLM pipeline and intelligent filtering: `src/lib/filter.ts`
2. Signal reports: `src/lib/reports.ts`
3. Scheduled market extraction: `src/lib/pipeline.ts`, `src/app/api/cron/route.ts`, `vercel.json`
4. Database structure: `supabase/schema.sql`
5. BIT Capital research focus: `src/lib/bitcap.ts`
6. Web interface: `src/app/page.tsx`

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
CRON_SECRET=choose_a_long_random_string_for_deployed_cron
```

3. Apply the schema in Supabase SQL editor:

```sql
-- paste and run supabase/schema.sql
```

4. Start the app:

```bash
npm run dev
```

5. Open:

```text
http://localhost:3000
```

## Demo Flow

1. Save or adjust the analyst focus sectors and tickers.
2. Click `Ingest Markets` to pull active Polymarket markets.
3. Click `Analyze Signals` to classify markets with OpenAI.
4. Review relevant and non-relevant signals in the signal database.
5. Click `Generate Report` to create an analyst signal report.
6. Use `Run Full Pipeline` to run ingestion, analysis, and reporting together.

## Scheduled Pipeline

The app includes:

- `GET /api/cron`: scheduler endpoint
- `POST /api/pipeline`: manual full pipeline endpoint
- `vercel.json`: runs `/api/cron` every 6 hours on Vercel
- `scheduler.js`: local scheduler that calls `/api/pipeline` every 6 hours

For local testing, keep `npm run dev` running and trigger:

```bash
npm run pipeline
```

For local scheduled operation, keep `npm run dev` running in one terminal and run:

```bash
npm run scheduler
```

If `CRON_SECRET` is set, deployed cron requests must send:

```text
Authorization: Bearer <CRON_SECRET>
```

## Database Tables

- `markets`: normalized active Polymarket markets plus raw API payload.
- `analyst_config`: sectors, tickers, and focus notes.
- `signals`: OpenAI-generated relevance decisions and equity impact theses.
- `reports`: generated analyst reports.
- `pipeline_runs`: history of scheduled/manual pipeline executions.

## Notes

- The app uses OpenAI only for LLM work.
- Supabase service role is recommended for local/server-side pipeline writes.
- The UI is intentionally minimal because the case study weights filtering and reporting much higher than interface polish.
