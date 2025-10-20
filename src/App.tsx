// src/App.tsx
import { useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import Layout from './components/Layout';
import PatientsList from './components/PatientsList';
import PatientDetail from './components/PatientDetail';
import DossierDetail from './components/DossierDetail';
import EffectifDuJour from './components/EffectifDuJour';
import Dashboard, { Filters as DashboardFilters } from './components/Dashboard';
import Settings from './components/Settings';
import AdminAnalytics from './components/AdminAnalytics';
import TicketsCollaborateur from './components/TicketsCollaborateur';
import TicketsAdmin from './components/TicketsAdmin';
import Planning from './components/Planning'; // ⬅️ nouveau

import { supabase, Patient, DossierSoin } from './lib/supabase';

type View =
  | 'dashboard'
  | 'analyse'
  | 'patients'
  | 'effectif'
  | 'planning'   // ⬅️ ajouté
  | 'settings'
  | 'tickets_collab'
  | 'tickets_admin';

function AppContent() {
  const { user, userBase, loading } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';
  const isAssistant = userBase?.type_utilisateur === 'assistant';

  // Valeur neutre avant initialisation ; la vue de départ sera fixée après auth via useEffect
  const [currentView, setCurrentView] = useState<View>('patients');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDossier, setSelectedDossier] = useState<DossierSoin | null>(null);

  /** Filtres à forcer sur le Dashboard (clic depuis Analytics) */
  const [dashOverrideFilters, setDashOverrideFilters] = useState<DashboardFilters | null>(null);

  /** Empêche de ré-initialiser la vue par défaut après que l'utilisateur a commencé à naviguer */
  const hasInitializedDefaultView = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user || !userBase) return;

    if (!hasInitializedDefaultView.current) {
      let startView: View = 'patients';
      if (isAdmin) startView = 'analyse';
      else if (isAssistant) startView = 'effectif';
      else startView = 'patients';

      setCurrentView(startView);
      hasInitializedDefaultView.current = true;
    }
  }, [loading, user, userBase, isAdmin, isAssistant]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (!user || !userBase) {
    // En cas de déconnexion, on autorise une réinitialisation à la prochaine connexion
    hasInitializedDefaultView.current = false;
    return <Login />;
  }

  const handleNavigate = (view: string) => {
    setCurrentView(view as View);
    setSelectedPatient(null);
    setSelectedDossier(null);

    // Si on clique “Dashboard” dans le menu, on enlève l’override pour revenir aux filtres par défaut
    if (view === 'dashboard') {
      setDashOverrideFilters(null);
    }
  };

  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setSelectedDossier(null);
  };

  const handleSelectDossier = (dossier: DossierSoin) => {
    setSelectedDossier(dossier);
  };

  const handleBackToPatients = () => {
    setSelectedPatient(null);
    setSelectedDossier(null);
  };

  const handleBackToDossiers = () => {
    setSelectedDossier(null);
  };

  /** ====== Liens de navigation depuis Tickets (admin & assistants) ====== */
  const openPatientById = async (patientId: string) => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('id', patientId)
        .single();
      if (error || !data) return;
      setSelectedPatient(data as Patient);
      setSelectedDossier(null);
      setCurrentView('patients');
    } catch (e) {
      console.error('Erreur chargement patient:', e);
    }
  };

  const openDossierById = async (dossierId: string) => {
    try {
      const { data: dossier, error: dErr } = await supabase
        .from('dossiers_soins')
        .select('*')
        .eq('id', dossierId)
        .single();
      if (dErr || !dossier) return;

      const { data: patient, error: pErr } = await supabase
        .from('patients')
        .select('*')
        .eq('id', dossier.patient_id)
        .single();
      if (pErr || !patient) return;

      setSelectedPatient(patient as Patient);
      setSelectedDossier(dossier as DossierSoin);
      setCurrentView('patients');
    } catch (e) {
      console.error('Erreur chargement dossier/patient:', e);
    }
  };

  /** ====== Clics depuis AdminAnalytics vers Dashboard ====== */
  const openDashboardWithFilters = (filters: DashboardFilters) => {
    setDashOverrideFilters(filters);
    setCurrentView('dashboard');
  };

  /** ====== Rendu principal ====== */
  const renderContent = () => {
    if (selectedDossier && selectedPatient) {
      return (
        <DossierDetail
          dossier={selectedDossier}
          patient={selectedPatient}
          onBack={handleBackToDossiers}
        />
      );
    }

    if (selectedPatient) {
      return (
        <PatientDetail
          patient={selectedPatient}
          onBack={handleBackToPatients}
          onSelectDossier={handleSelectDossier}
        />
      );
    }

    switch (currentView) {
      case 'dashboard':
        return isAdmin ? (
          <Dashboard
            overrideInitialFilters={dashOverrideFilters}
            onSelectDossier={(dossier, patient) => {
              setSelectedPatient(patient);
              setSelectedDossier(dossier);
            }}
          />
        ) : (
          <PatientsList onSelectPatient={handleSelectPatient} />
        );

      case 'analyse':
        return isAdmin ? (
          <AdminAnalytics onOpenDashboardWithFilters={openDashboardWithFilters} />
        ) : (
          <PatientsList onSelectPatient={handleSelectPatient} />
        );

      case 'patients':
        return <PatientsList onSelectPatient={handleSelectPatient} />;

      case 'effectif':
        return (
          <EffectifDuJour
            onOpenDossier={(dossier, patient) => {
              setSelectedPatient(patient);
              setSelectedDossier(dossier);
              setCurrentView('patients');
            }}
          />
        );

      case 'planning':
        return (
          <Planning
            onOpenDossier={(dossier, patient) => {
              setSelectedPatient(patient);
              setSelectedDossier(dossier);
              setCurrentView('patients');
            }}
          />
        );

      case 'settings':
        return isAdmin ? <Settings /> : <PatientsList onSelectPatient={handleSelectPatient} />;

      case 'tickets_collab':
        return userBase?.type_utilisateur !== 'admin' ? (
          <TicketsCollaborateur
            onOpenPatient={openPatientById}
            onOpenDossier={openDossierById}
          />
        ) : (
          <PatientsList onSelectPatient={handleSelectPatient} />
        );

      case 'tickets_admin':
        return isAdmin ? (
          <TicketsAdmin
            onOpenPatient={openPatientById}
            onOpenDossier={openDossierById}
          />
        ) : (
          <PatientsList onSelectPatient={handleSelectPatient} />
        );

      default:
        return <PatientsList onSelectPatient={handleSelectPatient} />;
    }
  };

  return (
    <Layout currentView={currentView} onNavigate={handleNavigate}>
      {renderContent()}
    </Layout>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
