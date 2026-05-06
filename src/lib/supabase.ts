import { createClient } from '@supabase/supabase-js';

const publicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!publicSupabaseUrl) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL - add it to .env.local and restart the dev server.'
  );
}

if (!publicSupabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY - add it to .env.local and restart the dev server.'
  );
}

export const supabase = createClient(publicSupabaseUrl, publicSupabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export function getSupabaseClient() {
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY - add one to .env.local and restart the dev server.'
    );
  }

  return createClient(publicSupabaseUrl!, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
