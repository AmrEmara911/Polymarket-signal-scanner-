export const DEFAULT_SECTORS = [
  'AI infrastructure and data centers',
  'Big tech platform companies',
  'Fintech disruption',
  'Crypto and digital assets ecosystem',
  'Digital health',
  'Cybersecurity',
];

// BIT Capital confirmed holdings (SEC 13F, December 2025)
export const DEFAULT_STOCKS = [
  // Tier 1 — Core positions
  'IREN',
  'MSFT',
  'GOOGL',
  'HNGE',
  'LMND',
  'RDDT',
  'META',
  'HIMS',
  'NVDA',
  'SOFI',
  // Tier 2 — Recent new positions
  'CRCL',
  'APLD',
  'COHR',
  'GLXY',
  'NTSK',
];

export const BITCAP_RESEARCH_CONTEXT = `
BIT Capital GmbH is a Berlin-based asset manager with $2.7B AUM as of 2025.

CONFIRMED TOP HOLDINGS (SEC 13F filings, December 2025):

TIER 1 — Core positions (highest priority signals):
- IREN (IREN Limited) — #1 holding, AI data centers + Bitcoin mining
- MSFT (Microsoft) — #2 holding, cloud + AI infrastructure
- GOOGL (Alphabet) — #3 holding, AI + search + cloud
- HNGE (Hinge Health) — digital health
- LMND (Lemonade) — insurtech
- RDDT (Reddit) — social/community platform
- META (Meta Platforms) — social + AI + VR
- HIMS (Hims & Hers Health) — digital health/telehealth
- NVDA (Nvidia) — semiconductors/AI chips (actively increasing)
- SOFI (SoFi Technologies) — fintech (actively increasing)

TIER 2 — Recent new positions to watch:
- CRCL (Circle Internet Group) — crypto/stablecoin infrastructure
- APLD (Applied Digital) — AI data centers
- COHR (Coherent Corp) — optical networking/AI infrastructure
- GLXY (Galaxy Digital) — crypto asset management
- NTSK (Netskope) — cybersecurity

INVESTMENT FOCUS AREAS:
1. AI infrastructure and data centers (IREN, APLD, NVDA)
2. Big tech platform companies (MSFT, GOOGL, META)
3. Fintech disruption (SOFI, LMND, HIMS, CRCL)
4. Crypto and digital assets ecosystem (IREN, CRCL, GLXY)
5. Digital health (HNGE, HIMS, LMND)
6. Cybersecurity (NTSK)

INVESTMENT THESIS — "Ahead of the Curve":
BIT Capital identifies technology megatrends BEFORE consensus forms. They want early signals, not confirmation of what the market already knows.

KEY SIGNALS BIT CAPITAL SPECIFICALLY CARES ABOUT:
- Fed rate decisions (affects all growth tech valuations)
- AI regulation in US and EU (affects MSFT, GOOGL, META, NVDA)
- Crypto regulation and ETF decisions (affects IREN, CRCL, GLXY)
- Bitcoin price movements and mining economics (affects IREN)
- Semiconductor export controls (affects NVDA)
- Digital health regulation (affects HNGE, HIMS, LMND)
- Antitrust actions against big tech (affects MSFT, GOOGL, META)
- Data center energy policy (affects IREN, APLD)
- IPOs of major tech companies that compete with holdings
- Tariff impacts on AI hardware supply chains

AUTOMATIC RELEVANCE RULE: If a market directly mentions IREN, MSFT, GOOGL, META, NVDA, SOFI, RDDT, HIMS, LMND, HNGE, CRCL, APLD, COHR, GLXY, or NTSK — always mark relevant unless it is a trivial short-term price target or expiring within 3 days.

VOLUME FLOOR: Markets with volume below $10,000 are automatically marked low confidence and not relevant regardless of your assessment — they are too thin to be reliable signals and can be moved by a single participant. This is enforced after your output. For markets between $10,000 and $50,000, flag the lower liquidity in your reason.
`.trim();
