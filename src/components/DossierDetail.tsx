// DossierDetail.tsx
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase, DossierSoin, Seance, Patient, UserBase } from '../lib/supabase';
import {
  ArrowLeft,
  Calendar,
  User,
  Edit as Edit2,
  Save,
  X,
  Download,
  Plus,
  AlertTriangle,
  Trash2,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import DocumentsManager from './DocumentsManager';
import EditSeanceModal from './EditSeanceModal';
import { exportDossierToPDF } from '../utils/pdfExport';

// ✅ modale spécialisée dossier (programmation multiple)
import ScheduleSeancesForDossierModal from './ScheduleSeancesForDossierModal';

// ✅ modale d’édition/suppression d’une séance programmée (externalisée)
import EditScheduledSeanceModal from './EditScheduledSeanceModal';

type EtatSeanceDB = 'programmée' | 'réalisée' | 'programmee' | 'realisee';

interface DossierDetailProps {
  dossier: DossierSoin;
  patient: Patient;
  onBack: () => void;
}

/* ---------- Helpers date/heure ---------- */
function toDateTimeKey(dateISO?: string | null, time?: string | null) {
  if (!dateISO) return null;
  const hhmm = time ? String(time).slice(0, 5) : '00:00';
  return `${dateISO}T${hhmm}:00`;
}
function isBeforeOrEqual(a: string, b: string) {
  return new Date(a).getTime() <= new Date(b).getTime();
}
function toHHMM(date: Date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
function cmpKeys(a: string, b: string) { // 'YYYY-MM-DDTHH:MM:00'
  return new Date(a).getTime() - new Date(b).getTime();
}
// Heure/Date actuelles à Tunis (évite les soucis de TZ navigateur)
function nowInTunis() {
  const parts = new Intl.DateTimeFormat('fr-TN', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  const yyyy = get('year'), mm = get('month'), dd = get('day');
  const hh = get('hour'), mi = get('minute');
  return {
    todayISO: `${yyyy}-${mm}-${dd}`,
    nowHHMM: `${hh}:${mi}`,
    curH: Number(hh),
    curM: Number(mi),
  };
}

export default function DossierDetail({ dossier, patient, onBack }: DossierDetailProps) {
  const { user, userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';

  const [dossierFromDB, setDossierFromDB] = useState<DossierSoin | null>(null);
  const [seances, setSeances] = useState<(Seance & { prestataire?: UserBase })[]>([]);
  const [loading, setLoading] = useState(true);

  const [isEditing, setIsEditing] = useState(false);
  const [editedDossier, setEditedDossier] = useState<DossierSoin>(dossier);
  const [editingSeance, setEditingSeance] = useState<Seance | null>(null);

  // Ajouts / programmation
  const [showAddSeance, setShowAddSeance] = useState(false);
  const [showProgram, setShowProgram] = useState(false);

  // Réalisation / édition d’une “programmée”
  const [scheduledToRealize, setScheduledToRealize] = useState<Seance | null>(null);
  const [scheduledToEdit, setScheduledToEdit] = useState<Seance | null>(null);

  // Erreur soumission globale
  const [submitError, setSubmitError] = useState<string>('');

  useEffect(() => {
    loadDossier();
    loadSeances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossier.id]);

  const loadDossier = async () => {
    try {
      const { data, error } = await supabase
        .from('dossiers_soins')
        .select('*')
        .eq('id', dossier.id)
        .single();

      if (error) throw error;
      setDossierFromDB(data as DossierSoin);
      setEditedDossier(data as DossierSoin);
    } catch (err) {
      console.error('Erreur chargement dossier:', err);
    }
  };

  const loadSeances = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('seances')
        .select('*, prestataire:users_base(nom, prenom)')
        .eq('dossier_id', dossier.id)
        .order('numero_seance', { ascending: true });

      if (error) throw error;

      const seancesWithPrestataire = (data || []).map((s: any) => ({
        ...s,
        prestataire: s.prestataire,
      }));

      setSeances(seancesWithPrestataire);
    } catch (error) {
      console.error('Erreur chargement séances:', error);
    } finally {
      setLoading(false);
    }
  };

  const canEdit = isAdmin;

  const handleSaveEdit = async () => {
    try {
      setSubmitError('');

      if (isDownsizeConflict) {
        setSubmitError(
          `Impossible d'enregistrer : ${seancesRealiseesCount} séance(s) déjà réalisée(s). ` +
            `Supprimez d'abord ${seancesRealiseesCount - (editedDossier.nombre_seances ?? 0)} séance(s) dans l'historique.`
        );
        return;
      }

      const { error } = await supabase
        .from('dossiers_soins')
        .update({
          motif: editedDossier.motif,
          commentaire: editedDossier.commentaire,
          nombre_seances: editedDossier.nombre_seances,
          pec_cnam: editedDossier.pec_cnam,
          etat_pec: editedDossier.etat_pec,
          prix_par_seance: editedDossier.prix_par_seance,
          date_debut: editedDossier.date_debut,
          date_fin: editedDossier.date_fin,
          updated_by: userBase?.id,
        })
        .eq('id', dossier.id);

      if (error) throw error;

      setIsEditing(false);
      await loadDossier();
    } catch (error: any) {
      console.error('Erreur mise à jour dossier:', error);
      setSubmitError(error?.message || 'Erreur lors de la mise à jour du dossier');
    }
  };

  const handleExportPDF = () => {
    if (!dossierFromDB) return;

    const realizedOnly = seances.filter((s) => isRealisee((s as any).etat_seance));

    const paymentStatusOverride =
      dossierFromDB.est_paye === null ? 'Non disponible' : undefined;

    exportDossierToPDF({
      dossier: dossierFromDB,
      patient,
      seances: realizedOnly,
      paymentStatusOverride,
    });
  };

  // --- Totaux / états ---
  const isRealisee = (etat?: string | null) =>
    etat === 'réalisée' || etat === 'realisee';
  const isProgrammee = (etat?: string | null) =>
    etat === 'programmée' || etat === 'programmee';

  const seancesRealiseesCount = useMemo(
    () => seances.filter((s) => isRealisee((s as any).etat_seance)).length,
    [seances]
  );
  const seancesProgrammeesCount = useMemo(
    () => seances.filter((s) => isProgrammee((s as any).etat_seance)).length,
    [seances]
  );

  const totalPaye = seances
    .filter((s) => isRealisee((s as any).etat_seance))
    .reduce((sum, s) => sum + (s.montant_paye ?? 0), 0);
  const totalDu = (dossierFromDB?.prix_par_seance ?? 0) * seancesRealiseesCount;

  const programDisabled =
    (dossierFromDB?.nombre_seances ?? 0) > 0 &&
    seancesRealiseesCount + seancesProgrammeesCount >= (dossierFromDB?.nombre_seances ?? 0);

  const isDownsizeConflict =
    isEditing &&
    editedDossier.nombre_seances !== undefined &&
    editedDossier.nombre_seances < seancesRealiseesCount;

  const lastProgrammedDateISO = useMemo(() => {
    const program = seances
      .filter(s => isProgrammee((s as any).etat_seance))
      .map(s => String(s.date_seance).slice(0,10));
    if (program.length === 0) return null;
    return program.sort().at(-1)!;
  }, [seances]);

  const { todayISO: todayTunis } = nowInTunis();
  const minDateForProgramming = lastProgrammedDateISO ?? todayTunis;

  if (!dossierFromDB) {
    return (
      <div className="flex justify-center py-10 text-gray-500">
        Chargement du dossier...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition"
      >
        <ArrowLeft className="w-5 h-5" />
        Retour
      </button>

      <div className="bg-white rounded-xl shadow p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {isEditing ? (
              <input
                type="text"
                value={editedDossier.motif}
                onChange={(e) => setEditedDossier({ ...editedDossier, motif: e.target.value })}
                className="text-2xl font-bold text-gray-900 border-b-2 border-teal-500 focus:outline-none w-full"
              />
            ) : (
              <h2 className="text-2xl font-bold text-gray-900">{dossierFromDB.motif}</h2>
            )}
            <p className="text-gray-600 mt-1">
              {patient.prenom} {patient.nom}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExportPDF}
              className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
              title="Exporter en PDF"
            >
              <Download className="w-5 h-5" />
            </button>

            {canEdit && (
              <>
                {isEditing ? (
                  <>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setSubmitError('');
                      }}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                    >
                      <X className="w-5 h-5" />
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={isDownsizeConflict}
                      className={`p-2 rounded-lg transition ${
                        isDownsizeConflict
                          ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                          : 'text-teal-600 hover:bg-teal-50'
                      }`}
                      title={
                        isDownsizeConflict ? 'Supprimez des séances avant de sauvegarder' : 'Enregistrer'
                      }
                    >
                      <Save className="w-5 h-5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {isDownsizeConflict && (
          <div className="flex items-start gap-3 p-3 rounded-lg border bg-red-50 border-red-200">
            <div className="p-2 rounded-lg bg-red-100 text-red-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1 text-sm text-red-800">
              <p className="font-medium">Réduction non autorisée</p>
              <p className="mt-1">
                Ce dossier contient déjà <span className="font-semibold">{seancesRealiseesCount}</span> séance(s)
                <span className="text-gray-600"> réalisées</span>. Vous tentez de fixer{' '}
                <span className="font-semibold">{editedDossier.nombre_seances}</span> séance(s).
                Pour diminuer le nombre de séances prévues, vous devez d'abord supprimer
                <span className="font-semibold">
                  {' '}
                  {seancesRealiseesCount - (editedDossier.nombre_seances ?? 0)}{' '}
                </span>
                séance(s) réalisée(s).
              </p>

              <button
                type="button"
                onClick={() => {
                  document.getElementById('historique-seances')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 transition text-xs"
              >
                <Trash2 className="w-4 h-4" />
                Gérer les séances
              </button>
            </div>
          </div>
        )}

        {/* =====================  DÉTAILS DU DOSSIER  ===================== */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <span className="text-sm text-gray-600">État</span>
            <p className="font-medium text-gray-900 capitalize">{dossierFromDB.etat.replace('_', ' ')}</p>
          </div>

          <div>
            <span className="text-sm text-gray-600">Séances</span>
            {isEditing ? (
              <input
                type="number"
                min={0}
                value={editedDossier.nombre_seances}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value || '0', 10);
                  const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
                  setEditedDossier({ ...editedDossier, nombre_seances: safe });
                }}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            ) : (
              <p className="font-medium text-gray-900">
                {seancesRealiseesCount} / {dossierFromDB.nombre_seances}
              </p>
            )}
          </div>

          <div>
            <span className="text-sm text-gray-600">PEC Assurance</span>
            {isEditing ? (
              <input
                type="checkbox"
                checked={!!editedDossier.pec_cnam}
                onChange={(e) => setEditedDossier({ ...editedDossier, pec_cnam: e.target.checked })}
                className="mt-2 w-4 h-4"
              />
            ) : (
              <p className="font-medium text-gray-900">{dossierFromDB.pec_cnam ? 'Oui' : 'Non'}</p>
            )}
          </div>

          <div>
            <span className="text-sm text-gray-600">Activité</span>
            <p className={`font-medium ${dossierFromDB.est_actif ? 'text-green-600' : 'text-orange-600'}`}>
              {dossierFromDB.est_actif ? 'Actif' : 'Inactif'}
            </p>
          </div>
        </div>

        {dossierFromDB.pec_cnam && (
          <div className="border-t pt-4">
            <span className="text-sm text-gray-600">État PEC</span>
            {isEditing ? (
              <select
                value={editedDossier.etat_pec || 'en_cours'}
                onChange={(e) =>
                  setEditedDossier({
                    ...editedDossier,
                    etat_pec: e.target.value as 'en_cours' | 'depose',
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="en_cours">PEC en cours</option>
                <option value="depose">PEC déposé</option>
              </select>
            ) : (
              <p className="font-medium text-gray-900">
                {dossierFromDB.etat_pec === 'depose' ? 'PEC déposé' : 'PEC en cours'}
              </p>
            )}
          </div>
        )}

        {/* Prix & paiement */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Prix par séance (DT)</span>
          </div>
          <div className="mt-2">
            {isEditing ? (
              <input
                type="number"
                step="0.01"
                min={0}
                value={editedDossier.prix_par_seance}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value || '0');
                  const safe = Number.isFinite(v) ? Math.max(0, v) : 0;
                  setEditedDossier({ ...editedDossier, prix_par_seance: safe });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            ) : (
              <p className="text-lg font-semibold text-gray-900">
                {dossierFromDB.prix_par_seance.toFixed(2)} DT
              </p>
            )}
          </div>

          <div className="mt-4 space-y-1">
            {dossierFromDB.est_paye !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Statut paiement</span>
                <span
                  className={`font-medium ${
                    dossierFromDB.est_paye ? 'text-green-600' : 'text-orange-600'
                  }`}
                >
                  {dossierFromDB.est_paye ? 'Payé' : 'Débiteur'}
                </span>
              </div>
            )}

            <p className="text-sm text-gray-600">
              {totalPaye.toFixed(2)} DT / {totalDu.toFixed(2)} DT
            </p>
          </div>
        </div>

        {(dossierFromDB.commentaire || isEditing) && (
          <div className="border-t pt-4">
            <span className="text-sm text-gray-600">Commentaire</span>
            {isEditing ? (
              <textarea
                value={editedDossier.commentaire || ''}
                onChange={(e) => setEditedDossier({ ...editedDossier, commentaire: e.target.value })}
                rows={3}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            ) : (
              <p className="text-gray-900 mt-2">{dossierFromDB.commentaire}</p>
            )}
          </div>
        )}

        {(dossierFromDB.date_debut || dossierFromDB.date_fin || isEditing) && (
          <div className="border-t pt-4 grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm text-gray-600">Date début</span>
              {isEditing ? (
                <input
                  type="date"
                  value={editedDossier.date_debut || ''}
                  onChange={(e) => setEditedDossier({ ...editedDossier, date_debut: e.target.value })}
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              ) : (
                <p className="text-gray-900 mt-1">
                  {dossierFromDB.date_debut
                    ? new Date(dossierFromDB.date_debut).toLocaleDateString('fr-FR')
                    : '-'}
                </p>
              )}
            </div>
            <div>
              <span className="text-sm text-gray-600">Date fin</span>
              {isEditing ? (
                <input
                  type="date"
                  value={editedDossier.date_fin || ''}
                  onChange={(e) => setEditedDossier({ ...editedDossier, date_fin: e.target.value })}
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              ) : (
                <p className="text-gray-900 mt-1">
                  {dossierFromDB.date_fin
                    ? new Date(dossierFromDB.date_fin).toLocaleDateString('fr-FR')
                    : '-'}
                </p>
              )}
            </div>
          </div>
        )}

        {submitError && (
          <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
            {submitError}
          </div>
        )}
      </div>

      <DocumentsManager dossierId={dossier.id} />

      {/* Historique des séances + boutons */}
      <div id="historique-seances" className="bg-white rounded-xl shadow p-6">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Historique des séances</h3>
          <div className="flex gap-2">
            {/* Programmer (admin) */}
            <button
              onClick={() => setShowProgram(true)}
              disabled={!isAdmin || programDisabled}
              className={`px-4 py-2 rounded-lg text-sm transition ${
                !isAdmin || programDisabled
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
              title={
                !isAdmin
                  ? "Réservé à l'administrateur"
                  : programDisabled
                  ? 'Nombre de séances prévues atteint'
                  : 'Programmer des séances'
              }
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Programmer
              </span>
            </button>

            {/* Ajouter séance RÉALISÉE */}
            <button
              onClick={() => setShowAddSeance(true)}
              disabled={seancesProgrammeesCount > 0}
              className={`px-4 py-2 rounded-lg text-sm transition ${
                seancesProgrammeesCount > 0
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-teal-600 hover:bg-teal-700 text-white'
              }`}
              title={
                seancesProgrammeesCount > 0
                  ? 'Traitez les séances programmées avant d’ajouter une séance réalisée'
                  : 'Ajouter une séance'
              }
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Ajouter séance
              </span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
          </div>
        ) : seances.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            Aucune séance enregistrée
          </div>
        ) : (
          <div className="space-y-3">
            {seances.map((seance) => {
              const etat = (seance as any).etat_seance as EtatSeanceDB | undefined;
              const prog = isProgrammee(etat);
              const timeLabel = seance.heure_seance ? String(seance.heure_seance).slice(0, 5) : null;

              // --- règles d'activation du bouton "Réaliser" (TZ Tunis)
              const { todayISO, nowHHMM } = nowInTunis();
              const keyNow = `${todayISO}T${nowHHMM}:00`;
              const dateISO = String(seance.date_seance).slice(0, 10);
              const timeHHMM = seance.heure_seance ? String(seance.heure_seance).slice(0,5) : '00:00';
              const keySeance = `${dateISO}T${timeHHMM}:00`;
              const isFuture = cmpKeys(keySeance, keyNow) > 0;
              const isTodayTN = dateISO === todayISO;
              const isAssignedToMe = seance.prestataire_id ? seance.prestataire_id === user?.id : true; // si non assignée, on autorise l’assistant courant

              const canRealize =
                prog && (
                  (isAdmin && !isFuture) ||
                  (!isAdmin && isAssignedToMe && isTodayTN && !isFuture)
                );

              return (
                <div
                  key={seance.id}
                  className={`relative p-4 bg-gray-50 rounded-lg ${isAdmin ? 'pr-12 sm:pr-14' : ''}`}
                >
                  {/* Actions (droite) */}
                  <div className="absolute top-2 right-2 flex gap-1">
                    {/* Réaliser (admin ou assistant selon règles ci-dessus) */}
                    {canRealize && (
                      <button
                        onClick={() => setScheduledToRealize(seance)}
                        className="p-2 rounded-lg transition text-emerald-700 hover:bg-emerald-50"
                        title={
                          isAdmin
                            ? 'Enregistrer la réalisation'
                            : 'Enregistrer (séance programmée d’aujourd’hui, horaire passé)'
                        }
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}

                    {/* Modifier / supprimer la programmée (admin) */}
                    {isAdmin && prog && (
                      <button
                        onClick={() => setScheduledToEdit(seance)}
                        className="p-2 text-blue-700 hover:bg-blue-50 rounded-lg transition"
                        title="Modifier / supprimer la séance programmée"
                      >
                        <Clock className="w-4 h-4" />
                      </button>
                    )}

                    {/* Éditer une séance réalisée (admin) */}
                    {isAdmin && !prog && (
                      <button
                        onClick={() => setEditingSeance(seance)}
                        className="p-2 text-teal-600 hover:bg-teal-50 rounded-lg transition"
                        title="Modifier la séance"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-3 sm:gap-4">
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 bg-teal-100 rounded-full flex items-center justify-center font-semibold text-teal-700 shrink-0">
                        {seance.numero_seance}
                      </div>

                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          Séance {seance.numero_seance} / {dossierFromDB.nombre_seances}
                        </p>

                        <div className="mt-1 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1.5 sm:gap-4 text-sm text-gray-600">
                          <span className="inline-flex items-center gap-1 shrink-0">
                            <Calendar className="w-4 h-4" />
                            {new Date(seance.date_seance).toLocaleDateString('fr-FR')}
                          </span>

                          {timeLabel && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {timeLabel}
                            </span>
                          )}

                          <span
                            className={`inline-flex items-center gap-2 px-2 py-0.5 text-xs rounded ${
                              prog ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {prog ? 'Programmée' : 'Réalisée'}
                          </span>

                          {typeof seance.duree_minutes === 'number' && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              {seance.duree_minutes} min
                            </span>
                          )}

                          {seance.prestataire && (
                            <span className="inline-flex items-center gap-1">
                              <User className="w-4 h-4" />
                              <span className="truncate">
                                {seance.prestataire.prenom} {seance.prestataire.nom}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {!prog && (
                      <div className="text-right">
                        <span className="block text-xs text-gray-600">Payé</span>
                        <p className="font-semibold text-gray-900">
                          {Number(seance.montant_paye || 0).toFixed(2)} DT
                        </p>
                      </div>
                    )}
                  </div>

                  {seance.note && (
                    <div className="mt-2 sm:ml-14 p-2 bg-blue-50 rounded text-sm text-gray-700">
                      <span className="font-medium">Note&nbsp;:</span> {seance.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal édition séance RÉALISÉE */}
      {editingSeance && (
        <EditSeanceModal
          seance={editingSeance}
          onClose={() => setEditingSeance(null)}
          onSuccess={() => {
            setEditingSeance(null);
            loadSeances();
            loadDossier();
          }}
        />
      )}

      {/* Modal ajout séance RÉALISÉE */}
      {showAddSeance && dossierFromDB && (
        <AddSeanceInlineModal
          dossier={dossierFromDB}
          patient={patient}
          currentUserId={user?.id || ''}
          isAdmin={isAdmin}
          onClose={() => setShowAddSeance(false)}
          onSuccess={async () => {
            setShowAddSeance(false);
            await loadSeances();
            await loadDossier();
          }}
        />
      )}

      {/* Modal programmer (admin, multiple) */}
      {showProgram && dossierFromDB && (
        <ScheduleSeancesForDossierModal
          dossier={dossierFromDB}
          minDateISO={minDateForProgramming}
          onClose={() => setShowProgram(false)}
          onSuccess={async () => {
            setShowProgram(false);
            await loadSeances();
            await loadDossier();
          }}
        />
      )}

      {/* Modal RÉALISER une séance PROGRAMMÉE */}
      {scheduledToRealize && dossierFromDB && (
        <RealizeScheduledInlineModal
          seance={scheduledToRealize}
          dossier={dossierFromDB}
          isAdmin={isAdmin}
          currentUserId={user?.id || ''}
          onClose={() => setScheduledToRealize(null)}
          onSuccess={async () => {
            setScheduledToRealize(null);
            await loadSeances();
            await loadDossier();
          }}
        />
      )}

      {/* Modal MODIFIER/SUPPRIMER une séance PROGRAMMÉE */}
      {scheduledToEdit && (
        <EditScheduledSeanceModal
          seance={scheduledToEdit}
          dossierId={dossier.id}
          onClose={() => setScheduledToEdit(null)}
          onSuccess={async () => {
            setScheduledToEdit(null);
            await loadSeances();
            await loadDossier();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Modal Portal utilitaire ---------- */
function ModalPortal({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div className="fixed left-0 top-0 z-[1000] w-screen h-screen">
      <div className="absolute left-0 top-0 w-screen h-screen bg-black/70" style={{ height: '100dvh' }} />
      <div className="absolute inset-0 flex items-center justify-center p-4" style={{ height: '100dvh' }}>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ==========================================================
   Modal d’ajout de séance (RÉALISÉE) — inline
   Correctifs :
   - Assistants : jour = AUJOURD’HUI uniquement (min=max=today TN)
   - Prix OBLIGATOIRE (pas de défaut 0)
   - Bloque futur (TZ Tunis) comme avant
========================================================== */
function AddSeanceInlineModal({
  dossier,
  patient,
  currentUserId,
  isAdmin,
  onClose,
  onSuccess,
}: {
  dossier: DossierSoin;
  patient: Patient;
  currentUserId: string;
  isAdmin: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { todayISO: todayTunis, curH, curM } = nowInTunis();

  const [lastRealDate, setLastRealDate] = useState<string | null>(null);
  const [lastRealTime, setLastRealTime] = useState<string | null>(null);
  const [minDateISO, setMinDateISO] = useState<string>(todayTunis);
  const [sameDayMinTime, setSameDayMinTime] = useState<{ hh: string; mm: string } | null>(null);

  const [dateSeance, setDateSeance] = useState<string>(todayTunis);
  const [hour, setHour] = useState<string>('08');
  const [minute, setMinute] = useState<string>('00');
  const [duree, setDuree] = useState<string>('');

  const [prestataireId, setPrestataireId] = useState<string>(currentUserId);
  const [montantPaye, setMontantPaye] = useState<string>(''); // ← REQUIRED
  const [note, setNote] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserBase[]>([]);
  const [error, setError] = useState<string>('');

  const [scheduledCount, setScheduledCount] = useState<number>(0);
  useEffect(() => {
    (async () => {
      const { count, data } = await supabase
        .from('seances')
        .select('id', { count: 'exact', head: true })
        .eq('dossier_id', dossier.id)
        .in('etat_seance', ['programmée', 'programmee'] as any);

      if (typeof count === 'number') setScheduledCount(count);
      else setScheduledCount(data?.length ?? 0);
    })();
  }, [dossier.id]);

  const hoursOptions = useMemo(
    () => Array.from({ length: 13 }, (_, i) => (8 + i).toString().padStart(2, '0')),
    []
  );

  useEffect(() => {
    (async () => {
      if (isAdmin) {
        const { data } = await supabase.from('users_base').select('id, nom, prenom').order('nom');
        setUsers(data || []);
      }
      const { data: last } = await supabase
        .from('seances')
        .select('date_seance, heure_seance, etat_seance')
        .eq('dossier_id', dossier.id)
        .in('etat_seance', ['réalisée', 'realisee'])
        .order('date_seance', { ascending: false })
        .order('heure_seance', { ascending: false })
        .limit(1);

      if (last && last.length > 0) {
        const d = String(last[0].date_seance).slice(0,10);
        const t = last[0].heure_seance ? String(last[0].heure_seance).slice(0, 5) : '00:00';
        setLastRealDate(d);
        setLastRealTime(t);
        setMinDateISO(isAdmin ? d : todayTunis); // assistants restent sur aujourd’hui
        setSameDayMinTime({ hh: t.slice(0, 2), mm: t.slice(3, 5) });
        setDateSeance((prev) => {
          const base = isAdmin ? (prev < d ? d : prev) : todayTunis;
          return base;
        });
      } else {
        setMinDateISO(isAdmin ? todayTunis : todayTunis);
        setDateSeance(todayTunis);
      }
    })();
  }, [dossier.id, isAdmin, todayTunis]);

  useEffect(() => {
    if (!sameDayMinTime || !lastRealDate) return;
    if (dateSeance !== lastRealDate) return;
    if (Number(hour) < Number(sameDayMinTime.hh)) {
      setHour(sameDayMinTime.hh);
    }
  }, [dateSeance, hour, lastRealDate, sameDayMinTime]);

  const isTodayTN = dateSeance === todayTunis;

  const getNextSeanceNumber = async (dossierId: string) => {
    const { data, error } = await supabase
      .from('seances')
      .select('numero_seance')
      .eq('dossier_id', dossierId)
      .order('numero_seance', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0].numero_seance + 1 : 1;
  };

  const sameDay = lastRealDate && dateSeance === lastRealDate;
  const minuteNum = Number((minute || '').replace(/[^\d]/g, ''));
  const minMinuteNum = sameDayMinTime ? Number(sameDayMinTime.mm) : 0;
  const minuteInvalidVSLast =
    !!sameDay &&
    !!sameDayMinTime &&
    hour === sameDayMinTime!.hh &&
    (isNaN(minuteNum) || minuteNum < minMinuteNum);

  useEffect(() => {
    if (isTodayTN && Number(hour) === curH) {
      const mm = Number(minute || '0');
      if (mm > curM) setMinute(String(curM).padStart(2, '0'));
    }
  }, [isTodayTN, hour, minute, curH, curM]);

  const handleSubmit = async () => {
    setError('');

    // 🔒 blocage assistants : uniquement aujourd’hui
    if (!isAdmin && dateSeance !== todayTunis) {
      setError('En tant qu’assistant, vous ne pouvez ajouter une séance réalisée que pour aujourd’hui.');
      return;
    }

    // Prix obligatoire
    if (montantPaye.trim() === '') {
      setError('Le montant payé est obligatoire.');
      return;
    }
    const montant = Number(montantPaye);
    if (Number.isNaN(montant) || montant < 0) {
      setError('Montant payé invalide (≥ 0).');
      return;
    }

    {
      const { count, data } = await supabase
        .from('seances')
        .select('id', { count: 'exact', head: true })
        .eq('dossier_id', dossier.id)
        .in('etat_seance', ['programmée', 'programmee'] as any);

      const nbProg = typeof count === 'number' ? count : (data?.length ?? 0);
      if (nbProg > 0) {
        setError(
          `Impossible d’ajouter une séance réalisée : ${nbProg} séance(s) programmée(s) existent pour ce dossier. ` +
          `Veuillez d’abord les enregistrer comme réalisées ou les supprimer.`
        );
        return;
      }
    }

    const mmSane = (minute || '00').replace(/[^\d]/g, '').slice(0, 2);
    const chosenKey = toDateTimeKey(dateSeance, `${hour}:${mmSane.padStart(2, '0')}`);
    const lastKey = lastRealDate ? toDateTimeKey(lastRealDate, lastRealTime || '00:00') : null;

    if (lastKey && chosenKey && isBeforeOrEqual(chosenKey, lastKey)) {
      setError("Impossible d'ajouter avant (ou égal à) la dernière séance réalisée.");
      return;
    }

    if (dateSeance > todayTunis) {
      setError('Date future non autorisée pour une séance réalisée.');
      return;
    }

    if (dateSeance === todayTunis) {
      const { nowHHMM } = nowInTunis();
      const keyNow = `${todayTunis}T${nowHHMM}:00`;
      if (chosenKey && cmpKeys(chosenKey, keyNow) > 0) {
        setError("Heure future non autorisée pour aujourd’hui.");
        return;
      }
    }

    const mmNum = Number(mmSane);
    if (Number.isNaN(mmNum) || mmNum < 0 || mmNum > 59) {
      setError('Minutes invalides (0–59).');
      return;
    }

    if (minuteInvalidVSLast) {
      setError(
        `Minutes trop petites. Minimum requis: ${sameDayMinTime!.hh}:${sameDayMinTime!.mm} pour ce jour.`
      );
      return;
    }

    if (isTodayTN && Number(hour) === curH && mmNum > curM) {
      setError(`Minutes trop grandes pour aujourd’hui. Maximum: ${String(curM).padStart(2,'0')}.`);
      return;
    }

    const dureeNum = duree === '' ? null : Number(duree);
    if (dureeNum !== null && (Number.isNaN(dureeNum) || dureeNum < 0)) {
      setError('Durée invalide (minutes ≥ 0).');
      return;
    }

    setLoading(true);
    try {
      const numero = await getNextSeanceNumber(dossier.id);
      const heure = `${(hour || '08').slice(0, 2)}:${mmSane.padStart(2, '0')}:00`;

      const { error: insErr } = await supabase.from('seances').insert({
        dossier_id: dossier.id,
        numero_seance: numero,
        date_seance: dateSeance,
        heure_seance: heure,
        duree_minutes: dureeNum,
        prestataire_id: isAdmin ? prestataireId : currentUserId,
        etat_seance: 'réalisée',
        montant_paye: montant,
        note: note || null,
      });

      if (insErr) throw insErr;
      onSuccess();
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de la création de la séance');
    } finally {
      setLoading(false);
    }
  };

  const isSameDayAsLast = lastRealDate && dateSeance === lastRealDate;

  return (
    <ModalPortal>
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Ajouter une séance réalisée</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <p className="text-gray-700">
            <span className="font-medium">Patient :</span> {patient.prenom} {patient.nom}
          </p>
          <p className="text-gray-700">
            <span className="font-medium">Dossier :</span> {dossier.motif}
          </p>
          {lastRealDate && (
            <p className="text-gray-700 mt-1">
              <span className="font-medium">Dernière réalisée :</span>{' '}
              {new Date(lastRealDate).toLocaleDateString('fr-FR')}
              {lastRealTime ? ` à ${lastRealTime}` : ''}
            </p>
          )}
        </div>

        {scheduledCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
            Ce dossier comporte <b>{scheduledCount}</b> séance(s) programmée(s).<br />
            Traitez ces séances (réaliser ou supprimer) avant d’ajouter une nouvelle séance réalisée.
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date de séance</label>
            <input
              type="date"
              value={dateSeance}
              onChange={(e) => {
                const v = e.target.value;
                const fixed = isAdmin ? (v < minDateISO ? minDateISO : (v > todayTunis ? todayTunis : v)) : todayTunis;
                setDateSeance(fixed);
                if (fixed === todayTunis && Number(hour) > curH) {
                  setHour(String(curH).padStart(2,'0'));
                }
                if (fixed === todayTunis && Number(hour) === curH && Number(minute) > curM) {
                  setMinute(String(curM).padStart(2,'0'));
                }
              }}
              min={isAdmin ? minDateISO : todayTunis}
              max={todayTunis}
              disabled={!isAdmin} // assistants: aujourd’hui uniquement
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Heure</label>
              <select
                value={hour}
                onChange={(e) => {
                  let h = e.target.value;
                  if (isTodayTN && Number(h) > curH) h = String(curH).padStart(2,'0');
                  setHour(h);
                  if (isTodayTN && Number(h) === curH && Number(minute) > curM) {
                    setMinute(String(curM).padStart(2,'0'));
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                title="Heure (HH)"
              >
                {hoursOptions.map((h) => {
                  const disabledByLast =
                    isAdmin && isSameDayAsLast && sameDayMinTime && Number(h) < Number(sameDayMinTime.hh);
                  const disabledByNow =
                    isTodayTN && Number(h) > curH;
                  return (
                    <option key={h} value={h} disabled={!!disabledByLast || !!disabledByNow}>
                      {h}
                    </option>
                  );
                })}
              </select>
              {isTodayTN && (
                <p className="text-xs text-gray-500 mt-1">Pour aujourd’hui, l’heure doit être ≤ {String(curH).padStart(2,'0')}:{String(curM).padStart(2,'0')}.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Minutes</label>
              <input
                value={minute}
                onChange={(e) => {
                  let clean = e.target.value.replace(/[^\d]/g, '').slice(0, 2);
                  let n = Number(clean || '0');
                  if (Number.isNaN(n)) n = 0;
                  if (n > 59) n = 59;
                  if (isTodayTN && Number(hour) === curH && n > curM) n = curM;
                  setMinute(String(n).padStart(2,'0'));
                }}
                placeholder="MM"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Durée (min)</label>
              <input
                value={duree}
                onChange={(e) => setDuree(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                placeholder="ex: 45"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {isAdmin ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prestataire</label>
              <select
                value={prestataireId}
                onChange={(e) => setPrestataireId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.prenom} {u.nom}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prestataire</label>
              <input
                type="text"
                value="Vous"
                disabled
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600"
              />
            </div>
          )}

          {/* Prix OBLIGATOIRE */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Montant payé (DT) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={montantPaye}
              onChange={(e) => setMontantPaye(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ajouter une note…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Annuler
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || minuteInvalidVSLast || scheduledCount > 0}
              className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Enregistrement…' : 'Valider la réalisation'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/* ==========================================================
   Modal de réalisation d’une séance programmée
   Correctifs :
   - Assistants : mise à jour effective, prestataire = currentUserId
   - Prix OBLIGATOIRE
   - Toujours TZ Africa/Tunis + contrôles d’ordre
========================================================== */
function RealizeScheduledInlineModal({
  seance,
  dossier,
  isAdmin,
  currentUserId,
  onClose,
  onSuccess,
}: {
  seance: Seance;
  dossier: DossierSoin;
  isAdmin: boolean;
  currentUserId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [prestataireId, setPrestataireId] = useState<string>(seance.prestataire_id || currentUserId);
  const [montantPaye, setMontantPaye] = useState<string>(''); // ← REQUIRED
  const [note, setNote] = useState<string>(seance.note || '');
  const [users, setUsers] = useState<UserBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');
  const [lastErr, setLastErr] = useState<string>('');

  useEffect(() => {
    (async () => {
      if (isAdmin) {
        const { data } = await supabase.from('users_base').select('id, nom, prenom').order('nom');
        setUsers(data || []);
      }
    })();
  }, [isAdmin]);

  // Futur ? (TZ Tunis)
  const { todayISO, nowHHMM } = nowInTunis();
  const keyNow = `${todayISO}T${nowHHMM}:00`;
  const keySeance = toDateTimeKey(
    seance.date_seance as string,
    seance.heure_seance ? String(seance.heure_seance).slice(0,5) : '00:00'
  )!;
  const isFuture = cmpKeys(keySeance, keyNow) > 0;

  const isTodayTN = String(seance.date_seance).slice(0,10) === todayISO;

  const handleSubmit = async () => {
    setErr('');
    setLastErr('');
    setLoading(true);
    try {
      if (isFuture) {
        setErr("Impossible de réaliser une séance programmée dans le futur.");
        setLoading(false);
        return;
      }

      // Assistants : uniquement aujourd’hui
      if (!isAdmin && !isTodayTN) {
        setErr("En tant qu’assistant, vous ne pouvez réaliser qu’une séance programmée d’aujourd’hui.");
        setLoading(false);
        return;
      }

      // Prix obligatoire
      if (montantPaye.trim() === '') {
        setErr('Le montant est obligatoire.');
        setLoading(false);
        return;
      }
      const montant = Number(montantPaye);
      if (Number.isNaN(montant) || montant < 0) {
        setErr('Montant payé invalide (≥ 0).');
        setLoading(false);
        return;
      }

      // contrôle ordre (compare à la dernière RÉALISÉE)
      const { data: last } = await supabase
        .from('seances')
        .select('date_seance, heure_seance')
        .eq('dossier_id', dossier.id)
        .in('etat_seance', ['réalisée', 'realisee'])
        .order('date_seance', { ascending: false })
        .order('heure_seance', { ascending: false })
        .limit(1);

      if (last && last.length > 0) {
        const lastKey = toDateTimeKey(
          last[0].date_seance as string,
          last[0].heure_seance ? String(last[0].heure_seance).slice(0, 5) : '00:00'
        )!;
        const thisKey = toDateTimeKey(
          seance.date_seance as string,
          seance.heure_seance ? String(seance.heure_seance).slice(0, 5) : '00:00'
        )!;
        if (isBeforeOrEqual(thisKey, lastKey)) {
          setLastErr(
            "Cette séance programmée est antérieure (ou égale) à la dernière séance réalisée. " +
              'Veuillez d’abord ajuster l’ordre chronologique.'
          );
          setLoading(false);
          return;
        }
      }

      const { error } = await supabase
        .from('seances')
        .update({
          etat_seance: 'réalisée',
          prestataire_id: isAdmin ? prestataireId : currentUserId,
          montant_paye: Number(montantPaye),
          note: note || null,
        })
        .eq('id', seance.id);
      if (error) throw error;

      onSuccess();
    } catch (e: any) {
      setErr(e?.message || "Impossible d'enregistrer la réalisation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal>
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Réaliser la séance programmée</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <p className="text-gray-700">
            <span className="font-medium">Dossier :</span> {dossier.motif}
          </p>
          <p className="text-gray-700">
            <span className="font-medium">Séance :</span> {seance.numero_seance} — {new Date(seance.date_seance).toLocaleDateString('fr-FR')}
          </p>
        </div>

        <div className="space-y-3">
          {isAdmin ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prestataire</label>
              <select
                value={prestataireId}
                onChange={(e) => setPrestataireId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.prenom} {u.nom}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prestataire</label>
              <input
                type="text"
                value="Vous"
                disabled
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600"
              />
            </div>
          )}

          {/* Prix OBLIGATOIRE */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Montant payé (DT) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={montantPaye}
              onChange={(e) => setMontantPaye(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ajouter une note…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {err && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {err}
            </div>
          )}
          {lastErr && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg text-sm">
              {lastErr}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Annuler
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition"
            >
              Marquer comme réalisée
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
