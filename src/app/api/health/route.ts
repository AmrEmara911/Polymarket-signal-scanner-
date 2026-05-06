import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.OPENAI_API_KEY ?? '';
  const hasOpenAIKey = key.length > 0;
  const looksLikePlaceholder =
    key.startsWith('replace') || key === 'your_openai_api_key' || key.length < 30;

  return NextResponse.json({
    success: true,
    openai: {
      has_key: hasOpenAIKey,
      looks_like_placeholder: looksLikePlaceholder,
      key_prefix: key ? `${key.slice(0, 10)}...` : null,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    },
    supabase: {
      has_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      has_anon_key: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      has_service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
  });
}
