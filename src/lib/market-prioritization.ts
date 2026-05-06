import type { AnalystConfig } from './analyst-config';

export interface PrioritizableMarket {
  id: string;
  question: string;
  description?: string | null;
  category?: string | null;
  volume?: number | null;
  liquidity?: number | null;
  probability?: number | null;
  end_date?: string | null;
}

export interface MarketPriority {
  score: number;
  reasons: string[];
  noise: string[];
}

const COMPANY_TERMS: Record<string, string[]> = {
  NVDA: ['nvda', 'nvidia'],
  AMD: ['amd', 'advanced micro devices'],
  AVGO: ['avgo', 'broadcom'],
  ASML: ['asml'],
  AMAT: ['amat', 'applied materials'],
  LRCX: ['lrcx', 'lam research'],
  MSFT: ['msft', 'microsoft', 'azure'],
  GOOGL: ['googl', 'google', 'alphabet', 'youtube', 'gemini'],
  AMZN: ['amzn', 'amazon', 'aws'],
  META: ['meta', 'facebook', 'instagram', 'whatsapp'],
  AAPL: ['aapl', 'apple', 'iphone', 'app store'],
  CRM: ['crm', 'salesforce'],
  V: ['visa'],
  MA: ['mastercard'],
  PYPL: ['paypal'],
  ADYEN: ['adyen'],
  COIN: ['coinbase'],
  MSTR: ['microstrategy', 'mstr'],
};

const POSITIVE_THEMES = [
  {
    label: 'rates/macro',
    weight: 0.34,
    terms: ['fed', 'fomc', 'rate cut', 'rate hike', 'interest rate', 'cpi', 'inflation', 'recession', 'jobs report', 'unemployment', 'gdp', 'treasury yield'],
  },
  {
    label: 'tariffs/export controls',
    weight: 0.46,
    terms: ['tariff', 'import duty', 'export control', 'china export', 'semiconductor ban', 'sanctions', 'taiwan', 'chips act'],
  },
  {
    label: 'semiconductors',
    weight: 0.5,
    terms: ['semiconductor', 'chip', 'gpu', 'h100', 'h200', 'blackwell', 'tsmc', 'foundry', 'wafer', 'lithography'],
  },
  {
    label: 'AI regulation/infrastructure',
    weight: 0.42,
    terms: ['artificial intelligence', 'openai', 'anthropic', 'data center', 'compute', 'llm', 'ai regulation', 'ai safety', 'chatbot arena'],
  },
  {
    label: 'platform/antitrust regulation',
    weight: 0.4,
    terms: ['antitrust', 'doj', 'ftc', 'digital markets act', 'dma', 'app store', 'google search', 'browser choice', 'privacy regulation'],
  },
  {
    label: 'crypto policy',
    weight: 0.34,
    terms: ['bitcoin', 'ethereum', 'crypto', 'stablecoin', 'coinbase', 'etf approval', 'digital asset'],
  },
  {
    label: 'company event',
    weight: 0.38,
    terms: ['earnings', 'guidance', 'revenue', 'acquisition', 'merger', 'ipo', 'product launch', 'approval'],
  },
];

const NOISE_THEMES = [
  {
    label: 'sports',
    weight: 0.48,
    terms: ['fifa', 'world cup', 'nba', 'nfl', 'mlb', 'nhl', 'ufc', 'soccer', 'football', 'tennis', 'cricket', 'game 1:', 'champions league', 'super bowl'],
  },
  {
    label: 'entertainment',
    weight: 0.52,
    terms: ['oscar', 'grammy', 'box office', 'album', 'movie', 'streaming chart', 'celebrity', 'podcast', 'song', 'lyrics'],
  },
  {
    label: 'generic election horse race',
    weight: 0.24,
    terms: ['win the 2028 democratic presidential nomination', 'win the 2028 republican presidential nomination'],
  },
];

function normalizeText(value: string) {
  return ` ${value.toLowerCase().replace(/[^a-z0-9%$]+/g, ' ')} `;
}

function includesTerm(text: string, term: string) {
  const normalizedTerm = normalizeText(term).trim();
  return normalizedTerm ? text.includes(` ${normalizedTerm} `) : false;
}

function addUnique(items: string[], item: string) {
  if (!items.includes(item)) items.push(item);
}

export function scoreMarketCandidate(
  market: PrioritizableMarket,
  config: Pick<AnalystConfig, 'sectors' | 'stocks'>
): MarketPriority {
  const questionText = normalizeText([market.question, market.category].filter(Boolean).join(' '));
  const text = normalizeText(
    [market.question, market.description, market.category].filter(Boolean).join(' ')
  );
  const reasons: string[] = [];
  const noise: string[] = [];
  let score = 0;
  let noisePenalty = 0;

  for (const theme of POSITIVE_THEMES) {
    if (theme.terms.some((term) => includesTerm(text, term))) {
      score += theme.weight;
      addUnique(reasons, theme.label);
    }
  }

  for (const stock of config.stocks) {
    const terms = COMPANY_TERMS[stock.toUpperCase()] ?? [stock.toLowerCase()];
    if (terms.some((term) => includesTerm(questionText, term))) {
      score += 0.56;
      addUnique(reasons, `stock:${stock.toUpperCase()}`);
    }
  }

  for (const sector of config.sectors) {
    if (includesTerm(questionText, sector)) {
      score += 0.18;
      addUnique(reasons, `sector:${sector}`);
    }
  }

  for (const theme of NOISE_THEMES) {
    if (theme.terms.some((term) => includesTerm(text, term))) {
      noisePenalty += theme.weight;
      addUnique(noise, theme.label);
    }
  }

  const volume = market.volume ?? 0;
  if (volume >= 1_000_000) score += 0.12;
  else if (volume >= 100_000) score += 0.08;
  else if (volume >= 10_000) score += 0.04;

  const probability = market.probability;
  if (typeof probability === 'number' && probability > 0.08 && probability < 0.92) {
    score += 0.04;
  }

  if (reasons.length === 0) {
    noisePenalty += 0.12;
  }

  if (noise.includes('entertainment') && !reasons.some((reason) => reason.startsWith('stock:'))) {
    noisePenalty += 0.36;
  }

  return {
    score: Math.max(0, Math.min(1, score - noisePenalty)),
    reasons,
    noise,
  };
}

export function sortMarketsForAnalysis<T extends PrioritizableMarket>(
  markets: T[],
  config: Pick<AnalystConfig, 'sectors' | 'stocks'>
) {
  return [...markets]
    .map((market) => ({
      market,
      priority: scoreMarketCandidate(market, config),
    }))
    .sort((a, b) => {
      if (b.priority.score !== a.priority.score) {
        return b.priority.score - a.priority.score;
      }

      return (b.market.volume ?? 0) - (a.market.volume ?? 0);
    });
}
