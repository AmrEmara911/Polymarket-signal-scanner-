import { GoogleGenerativeAI } from '@google/generative-ai';
import { Market } from './polymarket';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function generateReport(markets: Market[]): Promise<string> {
  // TODO: generate analyst report using Gemini
  return '';
}
