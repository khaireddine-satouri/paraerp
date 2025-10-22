// src/contexts/AuthContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase, UserBase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  userBase: UserBase | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userBase, setUserBase] = useState<UserBase | null>(null);
  const [loading, setLoading] = useState(true);

  // ---------- Helpers ----------
  const clearStateAndRedirect = (redirectTo: string = '/login') => {
    setUser(null);
    setUserBase(null);
    // Remplace l’historique (évite “back” qui relogue)
    if (typeof window !== 'undefined') {
      window.location.replace(redirectTo);
    }
  };

  const loadUserBase = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('users_base')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      setUserBase(data);
    } catch (error) {
      console.error('Erreur chargement profil utilisateur:', error);
      setUserBase(null);
    } finally {
      setLoading(false);
    }
  };

  // ---------- Bootstrapping session ----------
  useEffect(() => {
    let unsubscribed = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const sessUser = data.session?.user ?? null;
        if (unsubscribed) return;

        setUser(sessUser);
        if (sessUser) {
          await loadUserBase(sessUser.id);
        } else {
          setUserBase(null);
          setLoading(false);
        }
      } catch (e) {
        console.error('Erreur getSession:', e);
        setUser(null);
        setUserBase(null);
        setLoading(false);
      }
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session) => {
        const u = session?.user ?? null;
        setUser(u);

        // Cas de sortie / expiration : on nettoie l’état
        if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
          setUserBase(null);
          setLoading(false);
          return;
        }

        // Cas de connexion / refresh token : on recharge le profil
        if (u) {
          await loadUserBase(u.id);
        } else {
          setUserBase(null);
          setLoading(false);
        }
      }
    );

    return () => {
      unsubscribed = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // ---------- Actions ----------
  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Vérification client actif (logique existante)
    if (data.user) {
      const { data: userData, error: userError } = await supabase
        .from('users_base')
        .select('client_id')
        .eq('id', data.user.id)
        .maybeSingle();
      if (userError) throw userError;

      if (userData?.client_id) {
        const { data: clientData, error: clientError } = await supabase
          .from('clients')
          .select('statut')
          .eq('id', userData.client_id)
          .maybeSingle();

        if (clientError) throw clientError;

        if (clientData?.statut === 'inactif') {
          // Déconnexion locale pour éviter un résidu de session
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          // Tentative best-effort (peut 403 sur mobile si cookie manquant)
          await supabase.auth.signOut({ scope: 'global' }).catch(() => {});
          throw new Error('INACTIVE_CLIENT');
        }
      }
    }
  };

  const signOut = async () => {
    // 1) Déconnexion locale (toujours possible car basée sur le storage, pas sur cookie)
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});

    // 2) Best-effort global (peut échouer en 403 si cookie non attaché sur mobile)
    await supabase.auth.signOut({ scope: 'global' }).catch(() => {});

    // 3) Nettoyage état + redirection (clé pour que l’UX marche même si 403 global)
    clearStateAndRedirect('/login');
  };

  return (
    <AuthContext.Provider value={{ user, userBase, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
