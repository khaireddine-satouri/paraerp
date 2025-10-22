import { ReactNode, useEffect, useMemo, useState } from 'react';
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

  // true  -> il existe au moins un assistant pour ce client
  // false -> aucun assistant trouvé
  // null  -> inconnu (chargement)
  const [hasAssistants, setHasAssistants] = useState<boolean | null>(null);

  // --- Compteur de nouveaux tickets pour l'admin (du jour) ---
  const { count: newTicketsCount, markAsSeen, refresh } = useNewTicketsIndicator(clientId, isAdmin);
  const showTicketsUI = isAdmin && hasAssistants === true;

  useEffect(() => {
    let cancelled = false;

    const checkAssistants = async () => {
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
    };

    checkAssistants();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, clientId]);

  // Si l’admin n’a pas d’assistants et qu’on est sur l’onglet “tickets_admin”, on renvoie vers Analyse
  useEffect(() => {
    if (isAdmin && hasAssistants === false && currentView === 'tickets_admin') {
      onNavigate('analyse');
    }
  }, [isAdmin, hasAssistants, currentView, onNavigate]);

  // Quand on arrive déjà sur la page tickets_admin, purge le badge
  useEffect(() => {
    if (showTicketsUI && currentView === 'tickets_admin') {
      markAsSeen();
    }
  }, [showTicketsUI, currentView, markAsSeen]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      if (typeof window !== 'undefined') window.location.reload();
    } catch (e) {
      console.error('Erreur déconnexion:', e);
      if (typeof window !== 'undefined') window.location.reload();
    } finally {
      setSigningOut(false);
    }
  };

  const goTicketsAdmin = async () => {
    if (!showTicketsUI) return;
    // on purge le compteur puis on navigue
    await markAsSeen();
    onNavigate('tickets_admin');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-50">
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
                  className="relative p-3 sm:p-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition active:scale-[0.98] touch-manipulation"
                  title="Tickets collaborateurs"
                >
                  <Bell className="w-6 h-6 sm:w-5 sm:h-5" />
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
                className="p-3 sm:p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition active:scale-[0.98] touch-manipulation"
                title="Déconnexion"
              >
                <LogOut className="w-6 h-6 sm:w-5 sm:h-5" />
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
                <BarChart3 className="w-4 h-4" />
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
                <FileText className="w-4 h-4" />
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
              <Users className="w-4 h-4" />
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
              <Calendar className="w-4 h-4" />
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
              <CalendarRange className="w-4 h-4" />
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
                <Send className="w-4 h-4" />
                Envoyer un ticket
              </button>
            )}

            {/* Tickets collaborateurs (admin) — visible uniquement s’il y a des assistants) */}
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
                <Inbox className="w-4 h-4" />
                <span>Tickets staff</span>

                {/* Badge mini dans l’onglet */}
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
                <Settings className="w-4 h-4" />
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
