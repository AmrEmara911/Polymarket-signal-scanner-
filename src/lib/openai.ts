interface OpenAIMessage {
  role: 'system' | 'user';
  content: string;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}

export async function callOpenAIJson<T>(messages: OpenAIMessage[]): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY - add it to .env.local and restart the dev server.');
  }

  if (apiKey.startsWith('replace') || apiKey === 'your_openai_api_key' || apiKey.length < 30) {
    throw new Error(
      'OPENAI_API_KEY is still a placeholder or malformed. Replace it in .env.local with a real key from the OpenAI dashboard, then restart the dev server.'
    );
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getOpenAIModel(),
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  const payload = (await response.json()) as OpenAIChatResponse;

  if (!response.ok) {
    throw new Error(
      `OpenAI API error ${response.status}: ${payload.error?.message ?? 'Unknown error'}`
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned an empty response.');
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${content.slice(0, 500)}`);
  }
}
