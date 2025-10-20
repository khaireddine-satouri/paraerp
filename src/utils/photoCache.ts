// src/utils/photoCache.ts
import { supabase } from '../lib/supabase'

// Cache mémoire processe : path -> { url, exp } ou { errExp } (cache négatif)
const CACHE = new Map<string, { url?: string; exp?: number; errExp?: number }>()
// Déduplication des requêtes simultanées : path -> Promise<string|null>
const INFLIGHT = new Map<string, Promise<string | null>>()

// TTL succès = 10 min ; TTL erreur = 30 s (pour éviter les boucles de retry)
const OK_TTL_MS = 10 * 60 * 1000
const ERR_TTL_MS = 30 * 1000

export async function getSignedUrlWithCache(path?: string | null): Promise<string | null> {
  if (!path) return null

  // Si on vient de se déconnecter → refuse toute requête
  if ((window as any).__SIGNED_OUT__) return null

  const now = Date.now()
  const hit = CACHE.get(path)
  if (hit) {
    if (hit.exp && hit.exp > now && hit.url) return hit.url
    if (hit.errExp && hit.errExp > now) return null // cache négatif encore valide
  }

  // Déduplication
  const pending = INFLIGHT.get(path)
  if (pending) return pending

  const p = (async () => {
    try {
      // garde : si la session a disparu entre-temps, on n’appelle pas le storage
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        CACHE.set(path, { errExp: now + ERR_TTL_MS })
        return null
      }

      const { data, error } = await supabase.storage
        .from('patient_photos')
        .createSignedUrl(path, Math.floor(OK_TTL_MS / 1000)) // 600s

      if (error || !data?.signedUrl) {
        CACHE.set(path, { errExp: now + ERR_TTL_MS })
        return null
      }

      const url = data.signedUrl
      CACHE.set(path, { url, exp: now + OK_TTL_MS })
      return url
    } catch {
      CACHE.set(path, { errExp: now + ERR_TTL_MS })
      return null
    } finally {
      INFLIGHT.delete(path)
    }
  })()

  INFLIGHT.set(path, p)
  return p
}

/** Utilitaire pour purge manuelle (appelé déjà dans ton signOut) */
export function clearPhotoCache() {
  CACHE.clear()
  INFLIGHT.clear()
}
