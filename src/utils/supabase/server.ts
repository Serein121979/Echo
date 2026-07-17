import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 服务端环境变量未配置");
  return { url, key };
}

export async function getRequestSupabase(request?: Request) {
  const { url, key } = getConfig();
  const authorization = request?.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    return createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; Route Handlers can.
        }
      },
    },
  });
}

export async function requireUser(request?: Request) {
  const supabase = await getRequestSupabase(request);
  const token = request?.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { data, error } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();
  if (error || !data.user) throw new Error("UNAUTHORIZED");
  return { supabase, user: data.user };
}
