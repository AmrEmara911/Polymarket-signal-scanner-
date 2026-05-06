export interface Market {
  id: string;
  question: string;
  description: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  endDate: string;
  active: boolean;
}

export async function fetchMarkets(): Promise<Market[]> {
  // TODO: integrate Polymarket CLOB API
  return [];
}
