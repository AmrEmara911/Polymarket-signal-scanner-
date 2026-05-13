# Project Learnings

> Honest reflection on the build, the decisions, and what I'd do differently.
> Written as a companion to the [README](./README.md) — this is the part where I tell you what didn't work, and why.

---

## TL;DR

I built a working end-to-end Polymarket → Supabase → LLM → analyst-briefing pipeline in roughly seven days. The architecture is sound, the UI is production-grade, and the system delivers a usable subset of high-signal markets. The honest truth: **filter quality is the single biggest weakness of the current build**, and the most valuable thing I can do here is walk you through exactly why — and exactly how I'd fix it with another two weeks.

This document is structured around three questions:

1. What worked, and why?
2. What didn't work, and why?
3. What would I build next, given more time?

---

## What worked

### 1. Architecture and separation of concerns

The pipeline is cleanly separated into four stages: **Ingestion → Storage → LLM Filter → Report Generation**, with each stage owning its own module in `src/lib/`. This is the kind of structure that pays off when you need to debug — and I needed to debug a lot. Being able to isolate "is this an ingestion problem or a filter problem?" without untangling spaghetti was the difference between converging in a week and not.

The Supabase schema (`markets`, `signals`, `reports`, `config`) maps directly to the conceptual model. Foreign keys are explicit. Every signal can be traced back to a specific market and a specific pipeline run.

If I rebuilt this from scratch, I would keep this structure.

### 2. Domain grounding in BIT Capital holdings

I spent the first day before writing any code researching BIT Capital — reading the fund factsheets for BIT Global Technology Leaders, identifying the actual portfolio holdings, and feeding that list directly into the LLM filter prompt. This was the single highest-leverage decision in the entire project.

A generic "is this tech-related?" filter would have produced 10x the noise. Anchoring to a real holdings list means the LLM is grading every market against a concrete reference: "Does this market move NVDA? ASML? MSFT? GOOGL? META? Or none of them?" That framing eliminated most obvious noise on the first pass.

### 3. Structured JSON output, not free text

Every filtered signal returns a strict schema:

```json
{
  "is_relevant": true,
  "confidence": 0.84,
  "reason": "...",
  "affected_stocks": ["NVDA", "AMD"],
  "signal_type": "supply_chain",
  "signal_direction": "negative",
  "urgency": "medium",
  "thematic_buckets": ["semiconductors", "geopolitics"],
  "is_ahead_of_curve": false
}
```

This is queryable, filterable, sortable. The UI doesn't have to parse natural language — it just renders structured fields. An analyst can filter by ticker or urgency in one click. If I had let the LLM return prose, the entire downstream UX would have been impossible.

### 4. The "Ahead of Curve" feature

This is the feature I'm most proud of conceptually. BIT Capital's entire investment philosophy is built around catching tech megatrends before consensus forms — so I built a flag that surfaces markets where:

- Probability is in the contested zone (25–75%)
- Volume is above $50K (credible market, not noise)
- Probability has moved more than 15pp in the last 24 hours

These three conditions together identify the window where a market is updating its view but the equity market hasn't caught up yet. A dedicated Dashboard module surfaces these signals first; a filter chip on the Signals page lets analysts drill in.

The naming is intentional. "Ahead of Curve" mirrors BIT Capital's own language, which is the kind of small detail that signals "I read your fund documents, I understand your thesis."

### 5. Source linking and PDF export

Every signal includes a direct link back to the source Polymarket market. Every morning briefing exports as a PDF in one click. These are not impressive engineering features — they're respect-for-user-time features. Analysts shouldn't have to copy-paste market questions into a search bar to verify the underlying market. They shouldn't have to reformat a briefing to share with their PM. Both of these are five-minute features that save hours over a month of use.

---

## What didn't work (and why)

### The filter quality problem

This is the honest center of the project. I went through three distinct iterations of the LLM relevance filter, and each one had its own failure mode. I want to walk through them in order, because the pattern itself is the most useful thing I learned.

#### Iteration 1: Too loose

My first prompt asked the LLM: *"Is this market relevant to BIT Capital's portfolio?"*

The model said **yes to almost everything that mentioned a tech topic.** I had 200+ "relevant" signals out of 3,000 markets, including pure crypto price targets ("Will BTC be above $76,000 on May 10?") that have zero analytical value for a tech equity fund. The model was grading on **topic match** ("this mentions Bitcoin → digital assets → tech-adjacent → relevant") rather than on **informational edge** (does this tell an analyst something they don't already know?).

The bug was structural. The prompt didn't define what "relevant" *meant*, so the model defaulted to a generous interpretation.

#### Iteration 2: Too strict

I rewrote the prompt with explicit rejection rules: reject pure crypto price targets, reject markets resolving in <24 hours, reject markets at >85% or <15% probability, require a specific catalyst, require actionability. The hit rate collapsed from 6% to **0.23%** — 7 signals out of 3,028. I had over-corrected so hard that I was rejecting legitimate macro signals (Fed decisions, AI regulation) that any analyst would want to track.

The lesson: **rejection rules need calibration.** Saying "reject high-probability markets" is correct in principle, but the threshold matters. >85% is too aggressive — 85–92% markets are often "consensus confirmations" that analysts want to see even if they can't trade them. >92% is the right cutoff.

#### Iteration 3: The tooling regression

This is the most interesting failure, and the most honest part of this document.

I gave Codex a prompt to relax the filter with five specific changes and one new hard validation rule. Instead of updating the LLM prompt, **Codex replaced the LLM-based relevance check with a rules-based topic classifier.** Every signal's analysis reason now begins with:

> *"Broad sensitivity: deterministic thematic triage (company event) qualifies this market as an indirect BIT Capital signal."*

The phrase **"deterministic thematic triage"** is the smoking gun. Codex took a shortcut: instead of running the LLM with my new prompt, it built a rule-based classifier that buckets markets by topic ("company event," "rates/macro," "crypto policy") and hardcodes a 36% confidence value on anything that lands in a tech-adjacent bucket. That's why 17 of my 23 current "relevant" signals show **exactly 36% confidence** — it's a constant, not a model rating.

The hard validation rule I added — *"if affected_stocks is None, the signal cannot be relevant"* — was never wired in. As a result, several signals like *"Will SpaceX IPO above $1.4T"* are currently marked relevant ✓ with `All Stocks: None`, and the reasoning literally states *"This market does not directly impact any BIT Capital holdings."* That's a self-contradicting signal sitting in production.

**What this taught me about AI-assisted coding:** delegating prompt engineering to an agentic coding tool is risky. When I describe changes to an LLM prompt to another LLM, there's an interpretation layer that can swap the architecture entirely without changing the API surface. The tool *thinks* it solved my problem (count went from 7 to 23). The actual implementation is materially worse. I now know to read the diff line-by-line, not just the test output.

### The broken sensitivity slider

I built a Settings page control to let users switch between Strict / Balanced / Broad filter sensitivity. After Codex's regression, I tested all three modes and got:

- **Strict:** 22 signals
- **Balanced:** 20 signals
- **Broad:** 20 signals

Strict produced *more* signals than Broad. That's not a tuning problem — that's the control being entirely disconnected from the filter logic. The setting was being written to the `config` table but never read at filter-time.

I made the deliberate call to **remove the control entirely** rather than ship a broken one. A non-functional UI element is a credibility leak — it tells the user the system isn't reliable. Better to ship one mode that works than three modes that are indistinguishable. This is the kind of trade-off I'd argue for in a code review: optionality has a cost, and broken optionality has a higher cost than no optionality.

### Data freshness lag

The pipeline initially re-ingested only new markets on each "Run Pipeline Now" click — existing markets retained their stale probabilities, sometimes 5+ days old. A market showing 50.5% in my UI while Polymarket showed 53% live is the kind of credibility-killer that makes an analyst stop trusting the entire tool.

I patched this mid-build to re-ingest fresh probabilities for *all* tracked markets on every run, but the underlying lesson is broader: **for a tool that surfaces "ahead of curve" signals — which are by definition signals that just moved — data freshness is not a nice-to-have. It's the entire premise.** I should have designed for this on day one.

### Specific failure modes I'd fix on day 1

After multiple iterations, two failure patterns persist in the filter that I would address first with another two days:

**Failure mode 1: Batch context contamination**

Markets are evaluated in batches of 10 in a single LLM call. When several crypto price-target markets appear earlier in a batch, the model occasionally chains their reasoning into unrelated downstream markets. Example: the market "Fed rate hike in 2026?" was incorrectly classified as a "cryptocurrency price target" because crypto markets preceded it in the batch. The model's reasoning literally began "Similar to the previous market..." — diagnostic evidence of context leakage.

**Fix:** evaluate markets individually rather than in batches. The token cost increases ~3x but the contamination is eliminated. For a research tool where false rejections cost real signals, this trade-off is worth making.

**Failure mode 2: Self-contradictory output across fields**

The LLM is asked to produce four related fields per market: `is_relevant` (boolean), `confidence` (float), `reason` (string), and `affected_stocks` (array). On edge cases, these fields contradict each other within a single output. Example: "Will Microsoft have the top AI model at end of June 2026?" returned MSFT as the affected stock, "positive" signal direction, and reasoning that correctly identified the read-through to MSFT's valuation — but `is_relevant=false` with `confidence=0%`.

**Fix:** add a second LLM pass for any signal where `is_relevant` disagrees with the presence of valid `affected_stocks`. The second pass asks: *"Your reasoning identifies a BIT Capital holding affected by this market. Reconsider your is_relevant flag."* This is the structured equivalent of asking a junior analyst to explain why they recommended against something their own analysis supports.

Both failure modes are documented and reproducible. Neither is a fundamental flaw in the architecture — they are calibration and prompt-engineering gaps that would resolve with another two days of focused iteration and a slightly higher token budget.

---

## Postscript: how the failure modes were resolved

After writing the diagnosis above, I went back in and fixed them. The fixes are now in the codebase. Documenting them here because the *path* matters more than the endpoint — the value of this section is showing how the diagnosis above led to a specific architectural change, not claiming the problems were never real.

### The architectural change: LLM as extractor, code as judge

The earlier design used the LLM as the gatekeeper of relevance. It decided `is_relevant`, and the code gates only refined the result. This was the source of failure mode 2 above (self-contradictory output): the LLM correctly named MSFT as affected, wrote correct reasoning, but flagged `is_relevant=false` anyway. The code respected that flag and the signal was lost.

The new design inverts this. The LLM is now an **extractor** with one job: name the BIT Capital holdings affected by each market, plus signal type, direction, and confidence. It is explicitly told *not* to gatekeep — the prompt says *"Do NOT set is_relevant = false purely because you are uncertain. Use confidence for that. Code gates will reject low-confidence or weak-ticker cases automatically."*

The **code** then decides relevance deterministically, in `enforceValidation()`:

1. Must have at least one BIT Capital ticker in `affected_stocks`
2. Probability must sit in the 15–85% informational edge window
3. Market must not expire within 24 hours
4. Market must not be a direct equity price-target ("Will NVDA hit $X?")
5. Confidence must be ≥ 0.45

If all five gates pass, the signal is marked relevant — regardless of what the LLM thought. The LLM's `is_relevant` field is no longer read.

This eliminates failure mode 2 entirely: the LLM can no longer contradict its own structured output, because its structured output is the only thing the code consults.

### The performance fixes

Two additional changes landed alongside the architectural shift:

1. **SQL-layer pre-filter for candidate selection.** The earlier flow sent the top 36 highest-volume markets to the LLM regardless of probability. Most of those sat at extremes (>85% or <15%) and were guaranteed to fail gate 2. The new flow adds `WHERE probability BETWEEN 0.15 AND 0.85` to the candidate query, so every market sent to the LLM has a real chance of passing the gates. Roughly two-thirds of the API spend that used to be wasted is now eliminated.

2. **Parallel batch execution.** The earlier loop sent batches to OpenAI sequentially — 10 calls at ~12 seconds each = ~2 minutes wall time. The new code uses `Promise.allSettled` to fire all batches in parallel. gpt-4o-mini's rate limit (200 req/min) easily accommodates this; total wall time dropped to ~15 seconds. `Promise.allSettled` rather than `Promise.all` so one failed batch doesn't poison the rest of the run.

### Diagnostics, finally

The most important addition was unrelated to either fix above: I added per-rejection logging. Every market that gets dropped now logs *which specific gate caught it* (no_stocks, no_valid_ticker, probability_extreme, expires_soon, price_target, low_confidence), and the end of each pipeline run prints a breakdown summary:

```
[Filter] === Rejection breakdown ===
[Filter]   No affected_stocks:        45
[Filter]   No valid ticker:           20
[Filter]   Probability outside 15-85: 0
[Filter]   Expires within 24h:        8
[Filter]   Direct price-target:       5
[Filter]   Confidence < 0.45:         7
[Filter]   PASSED:                    15
```

This is the kind of instrumentation that should have been there from day one. Without it, every tuning decision was a guess. With it, the next round of calibration is data-driven: if `no_valid_ticker` is the biggest bucket, the LLM is naming tickers outside our holdings list and the prompt needs to clamp that. If `low_confidence` is biggest, gpt-4o-mini is being too cautious and the confidence floor needs to drop further. The system is now fully diagnosable from server logs.

### Failure mode 1 (batch contamination) — still open

Worth being honest: failure mode 1 in the section above (batch context contamination — the model occasionally chaining reasoning across unrelated markets in the same batch) is **not yet fixed**. The architectural change addressed failure mode 2 but not this one. The proposed fix — evaluate markets individually rather than in batches of 10 — is straightforward but trades 3x token cost for cleaner extraction. I'd make that trade for a production deployment but did not make it for this submission because the impact is bounded and the cost increase is meaningful at scale.

---

## The hardest decision I made

When the sensitivity slider broke, my first instinct was to debug it. I had spent real time building the UI for it. Removing it felt like throwing away work.

I removed it anyway. The reasoning: a broken control is *worse* than no control. It silently lies to the user about what they're configuring, which is worse than honestly offering them one mode that works.

This is the engineering decision I'm proudest of in the whole project, because it's the one that goes against the sunk-cost instinct. If BIT Capital takes one thing from this submission, I want it to be that I'd rather ship less and ship honest than ship more and ship deceiving.

---

## What I'd build next (in priority order)

Given another two weeks, here's exactly what I'd build, in order. Each item is here because I can already describe how I'd implement it — these aren't aspirational, they're queued.

### 1. Per-market analysis (eliminate batch contamination)

Replace the 10-markets-per-batch LLM call with single-market evaluation. This is the fix for failure mode 1 (batch context contamination) that I deferred from this submission. Cost increases ~3x; quality improves because the model can no longer chain reasoning across unrelated markets in the same batch. For a research tool where false rejections cost real signals, the trade is worth making.

### 2. Probability divergence vs. implied equity probabilities

This is the actual alpha-generating signal type, and the one I most regret not getting to. The logic: pull related equity prices (e.g., NVDA, AMD, ASML for a semiconductor market), derive an implied probability from option-implied moves, and compare against the Polymarket probability. When they diverge significantly, that's the signal. *"Polymarket says 60%, but options pricing implies 30%"* — that's where alpha lives, not in restating consensus.

### 3. Cross-signal pattern detection

Right now the filter analyzes markets one at a time. It doesn't know that *"Will the Fed cut rates by June?"* + *"Will recession arrive by 2027?"* together tell a different story than each alone. I'd add a synthesis pass that clusters related markets by ticker or thematic bucket and writes a paragraph in the morning briefing about each cluster. This is what real research desks do.

### 4. Calibration tracking

Log every prediction the LLM makes with its claimed confidence, then verify against eventual outcomes. If the model says "confidence: 0.85" and is right 60% of the time, we know to discount. This requires three months of data minimum — but the logging infrastructure to support it could be built in a day.

### 5. Question semantics parsing

A market titled *"Will TSMC announce Arizona fab delay?"* is structurally different from *"Will TSMC's Arizona fab open on time?"* — the framing affects whether "Yes" is bullish or bearish. Right now my filter relies on the LLM to figure this out implicitly. A dedicated semantic parser would catch the edge cases the LLM misses.

---

## What I learned about AI engineering

A few takeaways that I'll carry into the next thing I build:

**1. LLMs + structured outputs ≠ guaranteed quality.** I had the JSON schema, the typed fields, the source grounding — all the things that look like "AI engineering hygiene" in a blog post. None of it prevented the filter from producing self-contradicting signals. The schema can be correct and the content can still be garbage. Quality requires per-output evaluation, not just per-output structure.

**2. Prompt iteration is its own discipline.** It looks like editing English, but it behaves like editing a configuration of a model you can't introspect. Small wording changes produce non-linear effects on output quality. The discipline is closer to control system tuning than to writing.

**3. AI-assisted coding tools can regress your architecture silently.** Codex didn't break my tests. It made my filter produce *more* signals, which superficially looked like an improvement. The actual implementation was materially worse. The lesson: when you delegate to an agentic coding tool, you have to read the diff, not just the test output.

**4. Topic match ≠ informational edge.** This is the single most important lesson. Most "AI-powered" tools I've seen grade content by topic relevance. Real research grades content by informational edge: *does this tell the user something they don't already know?* The two are not the same. Most of my filter's failure modes traced back to confusing them.

---

## Honest assessment of final state

If I had to grade this submission as a third party, I'd give it a **6.5/10**.

**What's working:** the architecture, the UI, the conceptual design (holdings grounding, Ahead of Curve, structured outputs, source linking), and a usable subset of high-quality signals (Fed rate cuts, inflation, OpenAI IPO, AI safety bill, Gemini release).

**What's not:** the filter still leaves room for improvement. The deterministic triage regression and the self-contradiction failure mode were resolved by the "LLM as extractor, code as judge" refactor (see Postscript above), and the hard validation rules are now actually enforced in `enforceValidation()`. What remains: batch context contamination is not yet fixed, calibration tracking does not exist yet, and probability-vs-equity divergence (the real alpha-generating signal type) is on the roadmap but unimplemented.

**What I'd want a BIT Capital reviewer to take from this:** I built a real system, I caught my own bugs, I made trade-off decisions under time pressure, and I know exactly where the limits are. That's the package I'd want from an intern on my own team. Not a perfect system — a self-aware one.

---

## Closing

The week was harder than I expected, and I learned more in it than in the last month of coursework. I came in thinking the engineering would be the hard part; I left understanding that the engineering is the easy part, and the discipline of building AI systems that *don't lie to you* is the actual job.

Thank you for the case study. It was a real one.

— Amr Emara
