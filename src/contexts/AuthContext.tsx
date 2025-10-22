import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, UserBase, Client } from '../lib/supabase';

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadUserBase(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadUserBase(session.user.id);
      } else {
        setUserBase(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

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
          await supabase.auth.signOut();
          throw new Error('INACTIVE_CLIENT');
        }
      }
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
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
