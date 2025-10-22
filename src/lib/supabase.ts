// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

/** ------- Debug bus simple en mémoire (lu par l’overlay) ------- */
type NetLog = {
  id: string;
  ts: number;
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  durationMs?: number;
  error?: string;
};
export const __netLogs: NetLog[] = [];
const pushLog = (l: NetLog) => {
  __netLogs.unshift(l);
  if (__netLogs.length > 200) __netLogs.pop();
  // Optionnel: aussi log console
  // eslint-disable-next-line no-console
  console.debug('[NET]', l.method, l.url, l.status ?? '-', l.durationMs ? `${l.durationMs}ms` : '', l.error ?? '');
};

/** ------- fetch avec timeout + logs ------- */
const DEBUG_TIMEOUT_MS = 15000;

const debugFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  const method = (init?.method || 'GET').toUpperCase();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const started = performance.now();

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('Timeout'), DEBUG_TIMEOUT_MS);

  // Fusionner les signaux si on nous en donne un
  const signal = init?.signal
    ? ((): AbortSignal => {
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        init!.signal!.addEventListener('abort', onAbort);
        // quand notre fetch finit on détache (voir finally)
        return ctrl.signal;
      })()
    : ac.signal;

  try {
    const res = await fetch(input, { ...init, signal });
    const duration = Math.round(performance.now() - started);
    pushLog({ id, ts: Date.now(), method, url, status: res.status, ok: res.ok, durationMs: duration });
    return res;
  } catch (e: any) {
    const duration = Math.round(performance.now() - started);
    pushLog({
      id,
      ts: Date.now(),
      method,
      url,
      status: undefined,
      ok: false,
      durationMs: duration,
      error: e?.message || String(e),
    });
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: debugFetch }, // ✅ on force Supabase à utiliser notre fetch
});
