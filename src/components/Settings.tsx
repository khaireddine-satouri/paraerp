import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Save, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type DashFilters = {
  etat: 'all' | 'a_venir' | 'en_cours' | 'termine';
  pec: 'all' | 'oui' | 'non';
  etatPec: 'all' | 'en_cours' | 'depose';
  paiement: 'all' | 'paye' | 'debiteur';
  activite: 'all' | 'actif' | 'inactif';
  dateDebut: string;
  dateFin: string;
  patientSearch: string;
  motifSearch: string;
};

const FALLBACK_DASH_FILTERS: DashFilters = {
  etat: 'en_cours',
  pec: 'all',
  etatPec: 'all',
  paiement: 'debiteur',
  activite: 'all',
  dateDebut: '',
  dateFin: '',
  patientSearch: '',
  motifSearch: '',
};

export default function Settings() {
  const { userBase } = useAuth();
  const clientId = userBase?.client_id;

  const [joursInactivite, setJoursInactivite] = useState('4');

  const [dashDefaultFilters, setDashDefaultFilters] = useState<DashFilters>(
    FALLBACK_DASH_FILTERS
  );

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const isAdmin = userBase?.type_utilisateur === 'admin';

  useEffect(() => {
    if (clientId && isAdmin) {
      loadSettings();
    }
  }, [clientId, isAdmin]);

  const loadSettings = async () => {
    try {
      // jours_inactivite
      const { data: inact, error: e1 } = await supabase
        .from('app_settings')
        .select('valeur')
        .eq('client_id', clientId)
        .eq('cle', 'jours_inactivite')
        .maybeSingle();
      if (e1) throw e1;
      if (inact?.valeur) setJoursInactivite(inact.valeur);

      // dashboard_default_filters (JSON)
      const { data: dash, error: e2 } = await supabase
        .from('app_settings')
        .select('valeur')
        .eq('client_id', clientId)
        .eq('cle', 'dashboard_default_filters')
        .maybeSingle();
      if (e2) throw e2;
      if (dash?.valeur) {
        try {
          const parsed: DashFilters = JSON.parse(dash.valeur);
          setDashDefaultFilters({ ...FALLBACK_DASH_FILTERS, ...parsed });
        } catch {
          // si corrompu -> fallback silencieux
          setDashDefaultFilters(FALLBACK_DASH_FILTERS);
        }
      }
    } catch (error) {
      console.error('Erreur chargement paramètres:', error);
    }
  };

  const saveAll = async () => {
    if (!clientId) return;
    setLoading(true);
    setMessage('');

    try {
      // 1) jours_inactivite
      const { error: e1 } = await supabase.from('app_settings').upsert(
        {
          client_id: clientId,
          cle: 'jours_inactivite',
          valeur: joursInactivite,
        },
        { onConflict: ['client_id', 'cle'] }
      );
      if (e1) throw e1;

      // 2) dashboard_default_filters
      const { error: e2 } = await supabase.from('app_settings').upsert(
        {
          client_id: clientId,
          cle: 'dashboard_default_filters',
          valeur: JSON.stringify(dashDefaultFilters),
        },
        { onConflict: ['client_id', 'cle'] }
      );
      if (e2) throw e2;

      setMessage('Paramètres enregistrés avec succès');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Erreur sauvegarde paramètres:', error);
      setMessage('Erreur lors de la sauvegarde');
    } finally {
      setLoading(false);
    }
  };

  const disabled = useMemo(() => !isAdmin, [isAdmin]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="w-6 h-6 text-teal-600" />
          <h2 className="text-2xl font-bold text-gray-900">Paramètres</h2>
        </div>

        {!isAdmin && (
          <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 mb-6">
            Accès en lecture seule — seuls les administrateurs peuvent modifier ces paramètres.
          </div>
        )}

        {/* Jours d'inactivité */}
        <div className="space-y-2 mb-8">
          <label className="block text-sm font-medium text-gray-700">
            Jours d'inactivité
          </label>
          <p className="text-sm text-gray-600">
           Nombre de jours écoulés depuis la dernière séance avant qu’un dossier en cours soit considéré comme inactif.
          </p>
          <input
            type="number"
            min="1"
            value={joursInactivite}
            onChange={(e) => setJoursInactivite(e.target.value)}
            disabled={disabled}
            className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-gray-50"
          />
        </div>

        {/* Filtres par défaut du tableau de bord */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Filtres par défaut — Tableau de bord des dossiers de soins</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">État</label>
              <select
                value={dashDefaultFilters.etat}
                onChange={(e) => setDashDefaultFilters((s) => ({ ...s, etat: e.target.value as DashFilters['etat'] }))}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">Tous</option>
                <option value="a_venir">À venir</option>
                <option value="en_cours">En cours</option>
                <option value="termine">Terminé</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">PEC Assurance</label>
              <select
                value={dashDefaultFilters.pec}
                onChange={(e) => setDashDefaultFilters((s) => ({ ...s, pec: e.target.value as DashFilters['pec'] }))}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">Tous</option>
                <option value="oui">Oui</option>
                <option value="non">Non</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">État PEC</label>
              <select
                value={dashDefaultFilters.etatPec}
                onChange={(e) => setDashDefaultFilters((s) => ({ ...s, etatPec: e.target.value as DashFilters['etatPec'] }))}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">Tous</option>
                <option value="en_cours">En cours</option>
                <option value="depose">Déposé</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Paiement</label>
              <select
                value={dashDefaultFilters.paiement}
                onChange={(e) => setDashDefaultFilters((s) => ({ ...s, paiement: e.target.value as DashFilters['paiement'] }))}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">Tous</option>
                <option value="paye">Payé</option>
                <option value="debiteur">Débiteur</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Activité</label>
              <select
                value={dashDefaultFilters.activite}
                onChange={(e) => setDashDefaultFilters((s) => ({ ...s, activite: e.target.value as DashFilters['activite'] }))}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="all">Tous</option>
                <option value="actif">Actif</option>
                <option value="inactif">Inactif</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date début</label>
              <input
                type="date"
                value={dashDefaultFilters.dateDebut}
                onChange={(e) => setDashDefaultFilters((s) => ({ ...s, dateDebut: e.target.value }))}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date fin</label>
              <input
                type="date"
                value={dashDefaultFilters.dateFin}
                onChange={(e) => setDashDefaultFilters((s) => ({ ...s, dateFin: e.target.value }))}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>

 
          </div>

          {message && (
            <div
              className={`px-4 py-3 rounded-lg ${
                message.includes('succès')
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              {message}
            </div>
          )}

          <button
            onClick={saveAll}
            disabled={loading || disabled}
            className="flex items-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            {loading ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">À propos</h3>
        <div className="space-y-2 text-sm text-gray-600">
          <p><strong>Application :</strong> Cabinet Ayadi Radhouan</p>
          <p><strong>Version :</strong> 1.0.0</p>
          <p><strong>Description :</strong> Gestion des dossiers de soins</p>
        </div>
      </div>
    </div>
  );
}
