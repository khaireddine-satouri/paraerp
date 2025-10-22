// src/components/Layout.tsx
import React, { ReactNode, useEffect, useState } from 'react';
import { Send, Inbox, Bell } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, Users, FileText, Calendar, Settings, BarChart3, CalendarRange } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNewTicketsIndicator } from '../hooks/useNewTicketsIndicator';

interface LayoutProps {
  children: ReactNode;
  currentView: string;
  onNavigate: (view: string) => void;
}

export default function Layout({ children, currentView, onNavigate }: LayoutProps) {
  const { userBase, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const isAdmin = userBase?.type_utilisateur === 'admin';
  const clientId = userBase?.client_id ?? null;

  const [hasAssistants, setHasAssistants] = useState<boolean | null>(null);

  const { count: newTicketsCount, markAsSeen } = useNewTicketsIndicator(clientId, isAdmin);
  const showTicketsUI = isAdmin && hasAssistants === true;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isAdmin || !clientId) {
        setHasAssistants(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('users_base')
          .select('id')
          .eq('client_id', clientId)
          .eq('type_utilisateur', 'assistant')
          .limit(1);
        if (cancelled) return;
        if (error) {
          console.error('Erreur vérification assistants:', error);
          setHasAssistants(false);
          return;
        }
        setHasAssistants((data?.length ?? 0) > 0);
      } catch (e) {
        if (!cancelled) {
          console.error('Erreur vérification assistants:', e);
          setHasAssistants(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, clientId]);

  useEffect(() => {
    if (isAdmin && hasAssistants === false && currentView === 'tickets_admin') {
      onNavigate('analyse');
    }
  }, [isAdmin, hasAssistants, currentView, onNavigate]);

  useEffect(() => {
    if (showTicketsUI && currentView === 'tickets_admin') {
      markAsSeen();
    }
  }, [showTicketsUI, currentView, markAsSeen]);

  const handleSignOut = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (signingOut) return;
    setSigningOut(true);
    try {
      // ✅ Attendre la fin de la déconnexion (Supabase vide la session)
      await signOut();
      // ✅ NE PAS recharger : laisser l’AuthContext remonter l’écran de login
      // (si besoin de rediriger, fais-le ici vers la route "login" de ton router)
      // ex: navigate('/login')
    } catch (err) {
      console.error('Erreur déconnexion:', err);
    } finally {
      setSigningOut(false);
    }
  };

  const goTicketsAdmin = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!showTicketsUI) return;
    await markAsSeen();
    onNavigate('tickets_admin');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-[100] pointer-events-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-bold text-teal-600">Cabinet Ayadi Radhouan</h1>

            <div className="flex items-center gap-3">
              {/* Cloche de notifications (admin + a des assistants) */}
              {showTicketsUI && (
                <button
                  type="button"
                  onClick={goTicketsAdmin}
                  aria-label="Tickets collaborateurs"
                  className="relative p-3 sm:p-3 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition active:opacity-80 touch-manipulation select-none"
                  title="Tickets collaborateurs"
                >
                  <Bell className="w-6 h-6 sm:w-5 sm:h-5 pointer-events-none" />
                  {newTicketsCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px] flex items-center justify-center">
                      {newTicketsCount > 99 ? '99+' : newTicketsCount}
                    </span>
                  )}
                </button>
              )}

              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">
                  {userBase?.prenom} {userBase?.nom}
                </p>
                <p className="text-xs text-gray-500 capitalize">
                  {userBase?.type_utilisateur === 'assistant' ? 'Assistant(e)' : userBase?.type_utilisateur}
                </p>
              </div>

              <button
                type="button"
                onClick={handleSignOut}
                aria-label="Déconnexion"
                disabled={signingOut}
                className={`p-3 sm:p-3 rounded-lg transition touch-manipulation select-none ${
                  signingOut ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 active:opacity-80'
                }`}
                title="Déconnexion"
              >
                <LogOut className="w-6 h-6 sm:w-5 sm:h-5 pointer-events-none" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-1 py-2">
            {/* Analyse (admin) */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('analyse')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
                  currentView === 'analyse'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                title="Indicateurs & statistiques"
              >
                <BarChart3 className="w-4 h-4 pointer-events-none" />
                Analyse
              </button>
            )}

            {/* Dashboard (admin) */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
                  currentView === 'dashboard'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <FileText className="w-4 h-4 pointer-events-none" />
                Tableau de bord
              </button>
            )}

            {/* Patients (tous) */}
            <button
              type="button"
              onClick={() => onNavigate('patients')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
                currentView === 'patients'
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Users className="w-4 h-4 pointer-events-none" />
              Patients
            </button>

            {/* Effectif du jour (tous) */}
            <button
              type="button"
              onClick={() => onNavigate('effectif')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
                currentView === 'effectif'
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Calendar className="w-4 h-4 pointer-events-none" />
              Séances du jour
            </button>

            {/* Planning (tous) */}
            <button
              type="button"
              onClick={() => onNavigate('planning')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
                currentView === 'planning'
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
              title="Agenda par heure"
            >
              <CalendarRange className="w-4 h-4 pointer-events-none" />
              Planning
            </button>

            {/* Tickets collaborateur (assistants) */}
            {!isAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('tickets_collab')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
                  currentView === 'tickets_collab'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Send className="w-4 h-4 pointer-events-none" />
                Envoyer un ticket
              </button>
            )}

            {/* Tickets collaborateurs (admin) */}
            {showTicketsUI && (
              <button
                type="button"
                onClick={goTicketsAdmin}
                className={`relative flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
                  currentView === 'tickets_admin'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Inbox className="w-4 h-4 pointer-events-none" />
                <span>Tickets staff</span>
                {newTicketsCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px]">
                    {newTicketsCount > 99 ? '99+' : newTicketsCount}
                  </span>
                )}
              </button>
            )}

            {/* Paramètres (admin) */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${
                  currentView === 'settings'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Settings className="w-4 h-4 pointer-events-none" />
                Paramètres
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
