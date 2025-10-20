// Dashboard.tsx
import { useState, useEffect, useMemo } from 'react';
import { supabase, DossierSoin, Patient, Seance } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { exportDossiersToExcel } from '../utils/exportDossiersExcel';

interface DashboardProps {
  onSelectDossier: (dossier: DossierSoin, patient: Patient) => void;
  /** Permet d’ouvrir le dashboard avec des filtres préremplis (depuis Analytics) */
  overrideInitialFilters?: Filters | null;
}

export type Filters = {
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

const FALLBACK_FILTERS: Filters = {
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

export default function Dashboard({ onSelectDossier, overrideInitialFilters }: DashboardProps) {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';
  const clientId = userBase?.client_id;

  const [dossiers, setDossiers] = useState<(DossierSoin & { patient?: Patient; seances?: Seance[] })[]>([]);
  const [filteredDossiers, setFilteredDossiers] = useState<(DossierSoin & { patient?: Patient; seances?: Seance[] })[]>([]);
  const [loading, setLoading] = useState(true);

  const [showFilters, setShowFilters] = useState(false);
  const [defaultFilters, setDefaultFilters] = useState<Filters>(FALLBACK_FILTERS);
  const [filters, setFilters] = useState<Filters>(overrideInitialFilters ?? FALLBACK_FILTERS);

  // ✅ Case à cocher pour exporter tous les dossiers
  const [exportAll, setExportAll] = useState(false);

  // Charger filtres par défaut (si pas d’override)
  useEffect(() => {
    const loadDefaultFilters = async () => {
      if (!clientId || !isAdmin) return;

      if (overrideInitialFilters) {
        setDefaultFilters(FALLBACK_FILTERS);
        setFilters(overrideInitialFilters);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('app_settings')
          .select('valeur')
          .eq('client_id', clientId)
          .eq('cle', 'dashboard_default_filters')
          .maybeSingle();
        if (error) throw error;

        if (data?.valeur) {
          try {
            const parsed = JSON.parse(data.valeur);
            const merged = { ...FALLBACK_FILTERS, ...parsed };
            setDefaultFilters(merged);
            setFilters(merged);
          } catch {
            setDefaultFilters(FALLBACK_FILTERS);
            setFilters(FALLBACK_FILTERS);
          }
        } else {
          setDefaultFilters(FALLBACK_FILTERS);
          setFilters(FALLBACK_FILTERS);
        }
      } catch (e) {
        console.error('Erreur chargement filtres par défaut:', e);
        setDefaultFilters(FALLBACK_FILTERS);
        setFilters(FALLBACK_FILTERS);
      }
    };
    loadDefaultFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, isAdmin]);

  // Si l’override change (clic depuis Analytics)
  useEffect(() => {
    if (overrideInitialFilters) {
      setFilters(overrideInitialFilters);
    }
  }, [overrideInitialFilters]);

  useEffect(() => {
    loadDossiers();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [filters, dossiers]);

  const activeFiltersCount = useMemo(() => {
    let n = 0;
    (Object.keys(filters) as (keyof Filters)[]).forEach((k) => {
      if (filters[k] !== defaultFilters[k]) n++;
    });
    return n;
  }, [filters, defaultFilters]);

  const loadDossiers = async () => {
    try {
      const { data: dossiersData, error } = await supabase
        .from('dossiers_soins')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const dossiersWithDetails = await Promise.all(
        (dossiersData || []).map(async (dossier) => {
          const [patientResult, seancesResult] = await Promise.all([
            supabase.from('patients').select('*').eq('id', dossier.patient_id).maybeSingle(),
            // jointure prestataire pour enrichir l’export Excel (onglet détail)
            supabase
              .from('seances')
              .select('*, prestataire:users_base(id, nom, prenom)')
              .eq('dossier_id', dossier.id),
          ]);
          return {
            ...dossier,
            patient: patientResult.data || undefined,
            seances: (seancesResult.data || []) as any[],
          };
        })
      );
      setDossiers(dossiersWithDetails);
    } catch (error) {
      console.error('Erreur chargement dossiers:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...dossiers];

    if (filters.etat !== 'all') filtered = filtered.filter((d) => d.etat === filters.etat);

    if (filters.pec !== 'all') {
      const pecValue = filters.pec === 'oui';
      filtered = filtered.filter((d) => d.pec_cnam === pecValue);
    }

    if (filters.etatPec !== 'all') {
      filtered = filtered.filter((d) => d.pec_cnam && d.etat_pec === filters.etatPec);
    }

    if (filters.paiement !== 'all') {
      filtered = filtered.filter((d) => {
        // Paiement basé sur les séances RÉALISÉES
        const realised = (d.seances || []).filter(
          (s: any) => s.etat_seance === 'réalisée' || s.etat_seance === 'realisee'
        );
        const realisedCount = realised.length;
        const totalDu = realisedCount * (d.prix_par_seance ?? 0);
        const totalPaye = realised.reduce((sum: number, s: any) => sum + (Number(s.montant_paye) || 0), 0);
        const estPaye = totalPaye >= totalDu;
        return filters.paiement === 'paye' ? estPaye : !estPaye;
      });
    }

    if (filters.activite !== 'all') {
      filtered = filtered.filter((d) => (!!d.est_actif) === (filters.activite === 'actif'));
    }

    if (filters.dateDebut) {
      filtered = filtered.filter(
        (d) => !d.created_at || new Date(d.created_at) >= new Date(filters.dateDebut)
      );
    }

    if (filters.dateFin) {
      const endDate = new Date(filters.dateFin);
      endDate.setHours(23, 59, 59);
      filtered = filtered.filter(
        (d) => !d.created_at || new Date(d.created_at) <= endDate
      );
    }

    if (filters.patientSearch) {
      const term = filters.patientSearch.toLowerCase();
      filtered = filtered.filter((d) => {
        if (!d.patient) return false;
        const full = `${d.patient.prenom} ${d.patient.nom}`.toLowerCase();
        return full.includes(term);
      });
    }

    if (filters.motifSearch) {
      const term = filters.motifSearch.toLowerCase();
      filtered = filtered.filter((d) => d.motif.toLowerCase().includes(term));
    }

    // Tri sur dernière séance
    filtered.sort((a, b) => {
      const aLast = (a.seances || []).sort(
        (x, y) => new Date(y.date_seance).getTime() - new Date(x.date_seance).getTime()
      )[0];
      const bLast = (b.seances || []).sort(
        (x, y) => new Date(y.date_seance).getTime() - new Date(x.date_seance).getTime()
      )[0];

      if (aLast && bLast) {
        const cmp = new Date(bLast.date_seance).getTime() - new Date(aLast.date_seance).getTime();
        if (cmp !== 0) return cmp;
      } else if (aLast) return -1;
      else if (bLast) return 1;

      const today = new Date().getTime();
      const aStart = a.date_debut ? new Date(a.date_debut).getTime() : today;
      const bStart = b.date_debut ? new Date(b.date_debut).getTime() : today;
      return Math.abs(today - aStart) - Math.abs(today - bStart);
    });

    setFilteredDossiers(filtered);
  };

  const resetFilters = () => {
    if (overrideInitialFilters) {
      setFilters(overrideInitialFilters);
    } else {
      setFilters(defaultFilters);
    }
  };

  // Bouton unique d’export
  const handleExport = () => {
    if (exportAll) {
      exportDossiersToExcel(dossiers as any, { filtered: false }); // => dossiers_tous_JJ-MM-YYYY-HH-MM-SS.xlsx
    } else {
      exportDossiersToExcel(filteredDossiers as any, { filtered: true }); // => dossiers_filtres_...
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900">Dossiers de soin</h2>
            <span className="text-sm text-gray-600">({filteredDossiers.length})</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Case à cocher "Exporter tous les dossiers" */}
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={exportAll}
                onChange={(e) => setExportAll(e.target.checked)}
              />
              Exporter tous les dossiers
            </label>

            {/* Bouton d’export unique */}
            <button
              type="button"
              onClick={handleExport}
              disabled={
                loading ||
                (exportAll ? dossiers.length === 0 : filteredDossiers.length === 0)
              }
              className={`px-3 py-2 text-sm rounded-lg transition ${
                loading ||
                (exportAll ? dossiers.length === 0 : filteredDossiers.length === 0)
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
              title={exportAll ? 'Exporter tous les dossiers' : 'Exporter les dossiers filtrés'}
            >
              Exporter
            </button>

            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              aria-expanded={showFilters}
              aria-controls="dashboard-filters"
            >
              {showFilters ? 'Masquer les filtres' : 'Afficher les filtres'}
            </button>
          </div>
        </div>

        {showFilters && (
          <>
            <div id="dashboard-filters" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Patient */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nom du patient</label>
                <input
                  type="text"
                  placeholder="Rechercher par nom…"
                  value={filters.patientSearch}
                  onChange={(e) => setFilters({ ...filters, patientSearch: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Motif */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Motif du dossier</label>
                <input
                  type="text"
                  placeholder="Rechercher par motif…"
                  value={filters.motifSearch}
                  onChange={(e) => setFilters({ ...filters, motifSearch: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Etat */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">État</label>
                <select
                  value={filters.etat}
                  onChange={(e) => setFilters({ ...filters, etat: e.target.value as Filters['etat'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                >
                  <option value="all">Tous</option>
                  <option value="a_venir">À venir</option>
                  <option value="en_cours">En cours</option>
                  <option value="termine">Terminé</option>
                </select>
              </div>

              {/* PEC */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">PEC Assurance</label>
                <select
                  value={filters.pec}
                  onChange={(e) => setFilters({ ...filters, pec: e.target.value as Filters['pec'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                >
                  <option value="all">Tous</option>
                  <option value="oui">Oui</option>
                  <option value="non">Non</option>
                </select>
              </div>

              {/* État PEC */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">État PEC</label>
                <select
                  value={filters.etatPec}
                  onChange={(e) => setFilters({ ...filters, etatPec: e.target.value as Filters['etatPec'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                >
                  <option value="all">Tous</option>
                  <option value="en_cours">En cours</option>
                  <option value="depose">Déposé</option>
                </select>
              </div>

              {/* Paiement */}
              <div>
                <label className="block textsm font-medium text-gray-700 mb-2">Paiement</label>
                <select
                  value={filters.paiement}
                  onChange={(e) => setFilters({ ...filters, paiement: e.target.value as Filters['paiement'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                >
                  <option value="all">Tous</option>
                  <option value="paye">Payé</option>
                  <option value="debiteur">Débiteur</option>
                </select>
              </div>

              {/* Activité */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Activité</label>
                <select
                  value={filters.activite}
                  onChange={(e) => setFilters({ ...filters, activite: e.target.value as Filters['activite'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                >
                  <option value="all">Tous</option>
                  <option value="actif">Actif</option>
                  <option value="inactif">Inactif</option>
                </select>
              </div>

              {/* Dates */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date début</label>
                <input
                  type="date"
                  value={filters.dateDebut}
                  onChange={(e) => setFilters({ ...filters, dateDebut: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date fin</label>
                <input
                  type="date"
                  value={filters.dateFin}
                  onChange={(e) => setFilters({ ...filters, dateFin: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={resetFilters}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Réinitialiser {overrideInitialFilters ? '(raccourci)' : '(valeurs par défaut)'}
              </button>
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDossiers.map((dossier) => (
            <DossierRow
              key={dossier.id}
              dossier={dossier}
              onClick={() => {
                if (isAdmin && dossier.patient) {
                  onSelectDossier(dossier, dossier.patient);
                }
              }}
              isClickable={isAdmin}
            />
          ))}
          {filteredDossiers.length === 0 && (
            <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
              Aucun dossier trouvé
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --- DossierRow identique --- */
interface DossierRowProps {
  dossier: DossierSoin & { patient?: Patient; seances?: Seance[] };
  onClick?: () => void;
  isClickable?: boolean;
}

function DossierRow({ dossier, onClick, isClickable }: DossierRowProps) {
  const seances = dossier.seances || [];
  const totalPaye = seances.reduce((sum, s) => sum + (s.montant_paye || 0), 0);
  const totalDu = seances.length * dossier.prix_par_seance;
  const estPaye = totalPaye >= totalDu;

  const derniereSeanceDate = seances.length > 0
    ? seances.slice().sort((a, b) => new Date(b.date_seance).getTime() - new Date(a.date_seance).getTime())[0].date_seance
    : null;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getEtatColor = (etat: string) => {
    switch (etat) {
      case 'a_venir':
        return 'bg-blue-100 text-blue-700';
      case 'en_cours':
        return 'bg-green-100 text-green-700';
      case 'termine':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getEtatLabel = (etat: string) => {
    switch (etat) {
      case 'a_venir':
        return 'À venir';
      case 'en_cours':
        return 'En cours';
      case 'termine':
        return 'Terminé';
      default:
        return etat;
    }
  };

  return (
    <div
      className={`bg-white rounded-lg shadow p-4 hover:shadow-md transition ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{dossier.motif}</h3>
            <p className="text-sm text-gray-600 truncate">
              {dossier.patient ? `${dossier.patient.prenom} ${dossier.patient.nom}` : 'Patient inconnu'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getEtatColor(dossier.etat)}`}>
              {getEtatLabel(dossier.etat)}
            </span>

            {dossier.pec_cnam && (
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                PEC Assurance - {dossier.etat_pec === 'depose' ? 'Déposé' : 'En cours'}
              </span>
            )}

            {seances.length > 0 && (
              <span
                className={`px-2 py-1 rounded-full text-xs font-medium ${
                  estPaye ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                }`}
              >
                {estPaye ? 'Payé' : 'Débiteur'}
              </span>
            )}

            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${
                dossier.est_actif ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {dossier.est_actif ? 'Actif' : 'Inactif'}
            </span>

            <span className="text-sm text-gray-600">
              {seances.length} / {dossier.nombre_seances} séances
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          <div><span className="font-medium">Début :</span> {formatDate(dossier.date_debut)}</div>
          <div><span className="font-medium">Dernière séance :</span> {formatDate(derniereSeanceDate)}</div>
          <div><span className="font-medium">Fin :</span> {formatDate(dossier.date_fin)}</div>
        </div>
      </div>
    </div>
  );
}
