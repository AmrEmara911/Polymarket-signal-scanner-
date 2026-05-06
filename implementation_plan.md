# Polymarket Signal Scanner Implementation Plan

This document outlines the architecture and implementation steps to complete the BIT Capital Polymarket Signal Scanner based on your requirements. 

## Goal Description
To transition the existing pipeline from Gemini to the OpenAI API, finalize the AI-driven signal reports generation, build a local task scheduler, and create a comprehensive dashboard interface to configure parameters, view filtered signals, and read final analyst reports. 

## User Review Required
> [!IMPORTANT]
> Because you requested a purely local setup, I am storing the user configuration (Sectors & Stocks) using **Browser `localStorage`** instead of modifying your Supabase schema to add a new `settings` table. This keeps the application simple to run and evaluate while adhering strictly to your 5% UI weight criteria.

## Open Questions
> [!WARNING]
> Do you have an active `OPENAI_API_KEY` added to your `.env.local` file? The code has been rewritten to require this key instead of `GEMINI_API_KEY`.

## Proposed Changes

### Backend Pipeline & OpenAI Integration

#### [MODIFY] [filter.ts](file:///c:/Users/Startklar/Polymarket-signal-scanner-/src/lib/filter.ts)
- Switched from `fetch` (Gemini API) to the official `openai` SDK package.
- Formatted the system prompt to explicitly request `json_object` format to ensure reliable array parsing.

#### [MODIFY] [reports.ts](file:///c:/Users/Startklar/Polymarket-signal-scanner-/src/lib/reports.ts)
- Replaced the stubbed function with a fully functional OpenAI integration (using `gpt-4o` for advanced analytical writing).
- The prompt queries the top highest-confidence signals from Supabase, formats them into a readable text block, and instructs the LLM to write a professional financial intelligence report prioritizing macro trends and specific equity holdings.

#### [NEW] [route.ts](file:///c:/Users/Startklar/Polymarket-signal-scanner-/src/app/api/report/route.ts)
- Created an endpoint (`POST /api/report`) to trigger the generation of a report and save it to the database.

---

### Local Scheduling

#### [NEW] [scheduler.js](file:///c:/Users/Startklar/Polymarket-signal-scanner-/scheduler.js)
- A standalone local script using `node-cron` that runs every hour.
- It sequentially calls the three core API endpoints: `GET /api/ingest` -> `GET /api/analyze` -> `POST /api/report`.
- Avoids the complexity of setting up external cron jobs (like Vercel Cron) since this is meant to be run directly on the interviewer's local machine.

#### [MODIFY] [package.json](file:///c:/Users/Startklar/Polymarket-signal-scanner-/package.json)
- Add a new npm script `"scheduler": "node scheduler.js"` for easy execution.

---

### Dashboard Web Interface

#### [MODIFY] [page.tsx](file:///c:/Users/Startklar/Polymarket-signal-scanner-/src/app/page.tsx)
- Removed the Next.js boilerplate.
- Built a modern, lightweight dashboard with three tabs:
  1. **Signals**: Fetches and displays a list of the analyzed Polymarket events, highlighting if the AI deemed them relevant or irrelevant, along with their confidence and reason.
  2. **Reports**: Displays the AI-generated weekly intelligence reports. (I installed `@tailwindcss/typography` to render the markdown beautifully).
  3. **Configuration**: Allows the user to configure "Target Sectors" and "Portfolio Stocks". Also includes developer buttons to manually trigger the pipeline for demo purposes.

#### [MODIFY] [tailwind.config.ts](file:///c:/Users/Startklar/Polymarket-signal-scanner-/tailwind.config.ts)
- Add `require('@tailwindcss/typography')` to the plugins array.

## Verification Plan

### Automated Tests
- N/A for this scope.

### Manual Verification
1. I will add the `typography` plugin to `tailwind.config.ts` and the `scheduler` script to `package.json`.
2. I will instruct you to set your `OPENAI_API_KEY` in your `.env.local`.
3. We will start the dev server (`npm run dev`) and navigate to `http://localhost:3000`.
4. We will use the manual triggers on the "Settings" tab of the dashboard to:
   - Ingest new markets.
   - Run the AI analysis filter.
   - Generate a signal report.
5. We will verify the data appears correctly formatted in the UI.
