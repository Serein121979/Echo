import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function isValidUrl(value?: string) {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isConfiguredKey(value?: string) {
  return Boolean(value && value.trim() && !value.includes("your_supabase"));
}

// The app currently uses Supabase without generated database types.
// Keep the client wide enough for inserts/updates until typed schema is added.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedClient: ReturnType<typeof createClient<any>> | null = null;

export const supabaseConfigError =
  isValidUrl(supabaseUrl) && isConfiguredKey(supabaseAnonKey)
    ? null
    : "Supabase 环境变量未正确配置，请检查 .env.local。";

export function getSupabaseClient() {
  if (cachedClient) {
    return cachedClient;
  }

  if (supabaseConfigError) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cachedClient = createClient<any>(supabaseUrl!, supabaseAnonKey!);
  return cachedClient;
}
