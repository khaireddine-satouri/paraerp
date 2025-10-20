import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

function dayBoundsUTC(isoDate: string) {
  const start = `${isoDate}T00:00:00.000Z`;
  const end = new Date(`${isoDate}T00:00:00.000Z`);
  end.setDate(end.getDate() + 1);
  return { start, end: end.toISOString() };
}

/**
 * Compteur des tickets "non_traite" du JOUR (par client_id).
 * - Realtime sur INSERT/UPDATE de la table `tickets`
 * - Badge réinitialisé via markAsSeen() (persisté dans localStorage par jour + client)
 */
export function useNewTicketsIndicator(clientId?: string | null, isAdmin?: boolean) {
  const [count, setCount] = useState<number>(0);
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const storageKey = useMemo(
    () => (clientId ? `tickets_seen_${clientId}_${today}` : ''),
    [clientId, today]
  );

  const recompute = useCallback(
    async (markSeenInstead = false) => {
      if (!clientId || !isAdmin) return;
      const { start, end } = dayBoundsUTC(today);

      const { count: total, error } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('statut', 'non_traite')
        .gte('created_at', start)
        .lt('created_at', end);

      if (error) return;

      const exact = total ?? 0;

      if (markSeenInstead) {
        localStorage.setItem(storageKey, String(exact));
        setCount(0);
        return;
      }

      const seen = Number(localStorage.getItem(storageKey) || '0');
      setCount(Math.max(0, exact - seen));
    },
    [clientId, isAdmin, storageKey, today]
  );

  useEffect(() => {
    recompute();

    if (!clientId || !isAdmin) return;

    // Realtime : on écoute tous les changements de la table tickets de ce client
    const channel = supabase
      .channel('tickets_indicator')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `client_id=eq.${clientId}` },
        () => recompute()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, isAdmin, recompute]);

  const markAsSeen = useCallback(async () => {
    await recompute(true);
  }, [recompute]);

  const refresh = useCallback(async () => {
    await recompute(false);
  }, [recompute]);

  return { count, markAsSeen, refresh };
}
