// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

/* ========= ENV ========= */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

/* ========= DEBUG: bus de logs réseau (optionnel mais pratique) ========= */
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
  // eslint-disable-next-line no-console
  console.debug('[NET]', l.method, l.url, l.status ?? '-', l.durationMs ? `${l.durationMs}ms` : '', l.error ?? '');
};

/* ========= DEBUG: fetch avec timeout + logs ========= */
const DEBUG_TIMEOUT_MS = 15000;

/**
 * fetch “emballé” :
 *  - timeout à 15s (évite spinner infini si une requête pendouille)
 *  - log (URL, méthode, durée, statut, erreur)
 */
const debugFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  const method = (init?.method || 'GET').toUpperCase();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const started = performance.now();

  // On utilise un AbortController interne pour le timeout
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('Timeout'), DEBUG_TIMEOUT_MS);

  // Si un signal existe déjà, on le supporte (mais priorité au timeout)
  let signal: AbortSignal | undefined = ac.signal;
  if (init?.signal) {
    const ctrl = new AbortController();
    const abortBoth = () => ctrl.abort();
    init.signal.addEventListener('abort', abortBoth, { once: true });
    ac.signal.addEventListener('abort', abortBoth, { once: true });
    signal = ctrl.signal;
  }

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

/* ========= SUPABASE CLIENT ========= */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // On force Supabase à utiliser notre fetch instrumenté
  global: { fetch: debugFetch },
  // (optionnel) préciser la persistance session si besoin :
  // auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ========= Types projet ========= */
export interface Client {
  id: string;
  nom: string;
  statut: 'actif' | 'inactif';
  created_at: string;
  updated_at: string;
}

export interface UserBase {
  id: string;
  nom: string;
  prenom: string;
  type_utilisateur: 'admin' | 'assistant';
  client_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Patient {
  id: string;
  nom: string;
  prenom: string;
  telephone: string;
  photo_url: string | null;     // URL publique (pour l’affichage)
  photo_path?: string | null;   // chemin storage (ex: "patientId/xxx.jpg")
  client_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DossierSoin {
  id: string;
  patient_id: string;
  motif: string;
  commentaire: string;
  nombre_seances: number;
  pec_cnam: boolean;
  etat_pec: 'en_cours' | 'depose' | null;
  prix_par_seance: number;
  date_debut: string | null;
  date_fin: string | null;
  etat: 'a_venir' | 'en_cours' | 'termine';
  est_actif?: boolean | null;   // lu depuis la DB (trigger)
  client_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Seance {
  id: string;
  dossier_id: string;
  numero_seance: number;
  date_seance: string;
  prestataire_id: string;
  montant_paye: number;
  note: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  dossier_id: string;
  nom: string;
  type_fichier: 'photo' | 'pdf';
  storage_path: string;         // ex: "dossierId/filename.pdf"
  uploaded_by: string | null;
  created_at: string;
}
