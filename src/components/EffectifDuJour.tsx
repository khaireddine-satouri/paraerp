import { useState, useEffect, useMemo } from 'react';
import {
  Eye,
  CheckCircle2,
  SquarePen,
  User as UserIcon,
  Calendar,
  Search,
  Plus,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { supabase, Patient, DossierSoin, Seance, UserBase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { exportEffectifToExcel } from '../utils/excelExport';
import EditSeanceModal from './EditSeanceModal';
import ScheduleSeanceModal from './ScheduleSeanceModal';
import EditScheduledSeanceModal from './EditScheduledSeanceModal';

type EtatSeance = 'programmée' | 'réalisée';
type FilterEtat = 'toutes' | 'programmée' | 'réalisée';

interface EffectifDuJourProps {
  onOpenDossier?: (dossier: DossierSoin, patient: Patient) => void;
}

export default function EffectifDuJour({ onOpenDossier }: EffectifDuJourProps) {
  const { user, userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';

  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const isPast = selectedDate < today;
  const isToday = selectedDate === today;
  const isFuture = selectedDate > today;

  const [filterEtat, setFilterEtat] = useState<FilterEtat>('toutes');
  const [selectedPrestataire, setSelectedPrestataire] = useState<string>('all');

  const [seances, setSeances] = useState<
    (Seance & { dossier?: DossierSoin; patient?: Patient; prestataire?: UserBase })[]
  >([]);
  const [users, setUsers] = useState<UserBase[]>([]);
  const [hasAssistantsSameClient, setHasAssistantsSameClient] = useState(false);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [showAddRealModal, setShowAddRealModal] = useState(false);
  const [scheduledToRealize, setScheduledToRealize] =
    useState<(Seance & { dossier?: DossierSoin; patient?: Patient }) | null>(null);
  const [scheduledToEdit, setScheduledToEdit] =
    useState<(Seance & { dossier?: DossierSoin; patient?: Patient }) | null>(null);

  // Règles d’activation boutons
  const canProgram = isAdmin && (isToday || isFuture);
  const canAddRealized = isAdmin ? (isToday || isPast) : isToday;
  const headerCanProgram = canProgram && filterEtat !== 'réalisée';
  const headerCanAddReal = canAddRealized && filterEtat !== 'programmée';

  const handleExportExcel = () => {
    const effectifData = seances.map((seance) => ({
      seance,
      patient: seance.patient,
      dossier: seance.dossier,
      prestataire: seance.prestataire,
    }));
    exportEffectifToExcel(effectifData, selectedDate);
  };

  // Harmoniser filtre avec la date
  useEffect(() => {
    if (isFuture) {
      if (filterEtat === 'réalisée') setFilterEtat('programmée');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (!userBase?.client_id) return;
    if (isAdmin) loadUsers();
    loadSeances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedPrestataire, filterEtat, user?.id, userBase?.client_id]);

  const loadUsers = async () => {
    const clientId = userBase?.client_id;
    if (!clientId) return;

    const { data } = await supabase
      .from('users_base')
      .select('id, nom, prenom, type_utilisateur, client_id')
      .eq('client_id', clientId)
      .order('nom');

    setUsers(data || []);
    setHasAssistantsSameClient((data || []).some((u) => u.type_utilisateur === 'assistant'));
  };

  const loadSeances = async () => {
    if (!user || !userBase?.client_id) return;

    setLoading(true);
    try {
      const clientId = userBase.client_id;

      let q = supabase
        .from('seances')
        .select('*')
        .eq('date_seance', selectedDate)
        .order('heure_seance', { ascending: true })
        .order('created_at', { ascending: false });

      // Filtre état
      if (filterEtat === 'programmée') q = q.eq('etat_seance', 'programmée' as EtatSeance);
      else if (filterEtat === 'réalisée') q = q.eq('etat_seance', 'réalisée' as EtatSeance);

      // Filtre prestataire
      if (!isAdmin) q = q.eq('prestataire_id', user.id);
      else if (selectedPrestataire !== 'all') q = q.eq('prestataire_id', selectedPrestataire);

      const { data: seancesRaw, error: seancesErr } = await q;
      if (seancesErr) throw seancesErr;

      if (!seancesRaw || seancesRaw.length === 0) {
        setSeances([]);
        setLoading(false);
        return;
      }

      // Dossiers (même client)
      const dossierIds = Array.from(new Set(seancesRaw.map((s: any) => s.dossier_id))).filter(Boolean);
      const { data: dossiers, error: dsErr } = await supabase
        .from('dossiers_soins')
        .select('*')
        .in('id', dossierIds)
        .eq('client_id', clientId);
      if (dsErr) throw dsErr;
      const dossierById = new Map((dossiers || []).map((d: any) => [d.id, d]));

      // Patients
      const patientIds = Array.from(new Set((dossiers || []).map((d: any) => d.patient_id).filter(Boolean)));
      let patientsById = new Map<string, any>();
      if (patientIds.length > 0) {
        const { data: patients, error: pErr } = await supabase.from('patients').select('*').in('id', patientIds);
        if (pErr) throw pErr;
        patientsById = new Map((patients || []).map((p: any) => [p.id, p]));
      }

      // Prestataires
      const prestataireIds = Array.from(new Set(seancesRaw.map((s: any) => s.prestataire_id).filter(Boolean)));
      let prestatairesById = new Map<string, any>();
      if (prestataireIds.length > 0) {
        const { data: prestas, error: prErr } = await supabase
          .from('users_base')
          .select('id, nom, prenom')
          .in('id', prestataireIds)
          .eq('client_id', clientId);
        if (prErr) throw prErr;
        prestatairesById = new Map((prestas || []).map((u: any) => [u.id, u]));
      }

      const rows = (seancesRaw || [])
        .map((s: any) => {
          const dossier = dossierById.get(s.dossier_id);
          if (!dossier) return null;
          const patient = patientsById.get(dossier.patient_id);
          const prestataire = prestatairesById.get(s.prestataire_id);
          return { ...s, dossier, patient, prestataire };
        })
        .filter(Boolean) as any[];

      setSeances(rows);
    } catch (error) {
      console.error('Erreur chargement séances:', error);
      setSeances([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex flex-col gap-4">
          {/* Ligne 1 : Titre + Nav de date à gauche / Actions à droite */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">Séances du jour</h2>
              <DatePickerNav
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                today={today}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* État */}
              <select
                value={filterEtat}
                onChange={(e) => setFilterEtat(e.target.value as FilterEtat)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
              >
                <option value="toutes" disabled={isFuture}>
                  Tous les états de séance
                </option>
                <option value="programmée">Programmées</option>
                <option value="réalisée" disabled={isFuture}>
                  Réalisées
                </option>
              </select>

              {/* Prestataire (admin) */}
              {isAdmin && hasAssistantsSameClient && (
                <select
                  value={selectedPrestataire}
                  onChange={(e) => setSelectedPrestataire(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  <option value="all">Tous les prestataires</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.prenom} {u.nom}
                    </option>
                  ))}
                </select>
              )}

              {/* Export (admin) */}
              {isAdmin && seances.length > 0 && (
                <button
                  onClick={handleExportExcel}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition"
                >
                  <Download className="w-5 h-5" />
                  <span className="hidden sm:inline">Exporter Excel</span>
                </button>
              )}

              {/* Programmer (admin seulement) */}
              <button
                onClick={() => setShowProgramModal(true)}
                disabled={!headerCanProgram}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                  headerCanProgram
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
                title={
                  !isAdmin
                    ? "Réservé à l'administrateur"
                    : isPast
                    ? 'Programmation désactivée sur une date passée'
                    : 'Programmer des séances'
                }
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Programmer</span>
              </button>

              {/* Ajouter réalisée */}
              <button
                onClick={() => setShowAddRealModal(true)}
                disabled={!headerCanAddReal}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                  headerCanAddReal
                    ? 'bg-teal-600 hover:bg-teal-700 text-white'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
                title={isFuture ? 'Ajout désactivé sur une date future' : 'Ajouter une séance'}
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Ajouter séance</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
        </div>
      ) : seances.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-12 text-center">
          <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">Aucune séance pour cette date</p>
        </div>
      ) : (
        <div className="space-y-3">
          {seances.map((seance) => (
            <SeanceCard
              key={seance.id}
              seance={seance}
              onUpdate={loadSeances}
              onOpenDossier={onOpenDossier}
              onRealizeScheduled={(s) => setScheduledToRealize(s)}
              onEditScheduled={(s) => setScheduledToEdit(s)}
              isPast={isPast}
              isToday={isToday}
              isFuture={isFuture}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showProgramModal && (
        <ScheduleSeanceModal
          defaultDate={selectedDate}
          onClose={() => setShowProgramModal(false)}
          onSuccess={() => {
            setShowProgramModal(false);
            loadSeances();
          }}
        />
      )}

      {showAddRealModal && (
        <AddSeanceModal
          date={selectedDate}
          onClose={() => setShowAddRealModal(false)}
          onSuccess={() => {
            setShowAddRealModal(false);
            loadSeances();
          }}
        />
      )}

      {/* Conversion d’une séance programmée → réalisée */}
      {scheduledToRealize && (
        <AddSeanceModal
          date={scheduledToRealize.date_seance}
          scheduledSeance={scheduledToRealize}
          onClose={() => setScheduledToRealize(null)}
          onSuccess={() => {
            setScheduledToRealize(null);
            loadSeances();
          }}
        />
      )}

      {/* Édition d’une séance programmée */}
      {scheduledToEdit && (
        <EditScheduledSeanceModal
          seance={scheduledToEdit}
          dossierId={String(scheduledToEdit.dossier?.id ?? scheduledToEdit.dossier_id)}
          onClose={() => setScheduledToEdit(null)}
          onSuccess={() => {
            setScheduledToEdit(null);
            loadSeances();
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------
   Date picker + nav (avec bouton Aujourd'hui)
------------------------------------------------------- */
function DatePickerNav({
  selectedDate,
  setSelectedDate,
  today,
}: {
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  today: string;
}) {
  const isToday = selectedDate === today;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
      <Calendar className="w-5 h-5 text-gray-600" />
      <input
        type="date"
        value={selectedDate}
        onChange={(e) => setSelectedDate(e.target.value)}
        className="bg-transparent border-none focus:outline-none text-gray-900"
        aria-label="Choisir une date"
      />
      <button
        onClick={() => {
          const prev = new Date(selectedDate);
          prev.setDate(prev.getDate() - 1);
          setSelectedDate(prev.toISOString().split('T')[0]);
        }}
        className="p-1 text-gray-600 hover:bg-gray-100 rounded"
        title="Jour précédent"
        aria-label="Jour précédent"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={() => {
          const next = new Date(selectedDate);
          next.setDate(next.getDate() + 1);
          setSelectedDate(next.toISOString().split('T')[0]);
        }}
        className="p-1 text-gray-600 hover:bg-gray-100 rounded"
        title="Jour suivant"
        aria-label="Jour suivant"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Nouveau : bouton Aujourd'hui */}
      <button
        onClick={() => setSelectedDate(today)}
        disabled={isToday}
        className={`ml-1 px-2 py-1 text-sm rounded border transition ${
          isToday
            ? 'text-gray-400 border-gray-200 cursor-not-allowed'
            : 'text-teal-700 border-teal-200 hover:bg-teal-50'
        }`}
        title="Revenir à aujourd'hui"
        aria-label="Revenir à aujourd'hui"
      >
        Aujourd’hui
      </button>
    </div>
  );
}

/* -------------------------------------------------------
   Carte Séance
------------------------------------------------------- */
function SeanceCard({
  seance,
  onUpdate,
  onOpenDossier,
  onRealizeScheduled,
  onEditScheduled,
  isPast,
  isToday,
}: {
  seance: Seance & { dossier?: DossierSoin; patient?: Patient; prestataire?: UserBase };
  onUpdate: () => void;
  onOpenDossier?: (dossier: DossierSoin, patient: Patient) => void;
  onRealizeScheduled: (s: any) => void;
  onEditScheduled: (s: any) => void;
  isPast: boolean;
  isToday: boolean;
  isFuture: boolean;
}) {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';
  const [showEditModal, setShowEditModal] = useState(false);

  const canOpen = Boolean(seance.dossier && seance.patient);

  const isProgrammee = seance.etat_seance === ('programmée' as EtatSeance);

  // ✅ Assistants : conversion autorisée uniquement le jour même
  // ✅ Admins : conversion autorisée le jour même + jours passés
  const canConvertToReal = isProgrammee && (isAdmin ? (isToday || isPast) : isToday);

  const timeLabel = seance.heure_seance ? String(seance.heure_seance).slice(0, 5) : null;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <PatientThumb patient={seance.patient || null} size={40} />
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 truncate">
                {seance.patient ? `${seance.patient.prenom} ${seance.patient.nom}` : 'Patient inconnu'}
              </h3>
              <p className="text-sm text-gray-600">{seance.dossier?.motif}</p>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                <span className="inline-flex items-center gap-1">
                  Séance {seance.numero_seance}
                  {seance.dossier?.nombre_seances ? ` / ${seance.dossier.nombre_seances}` : ''}
                </span>
                {timeLabel && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {timeLabel}
                  </span>
                )}
                {isProgrammee ? (
                  <span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-700">Programmée</span>
                ) : (
                  <span className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700">Réalisée</span>
                )}
                {isAdmin && seance.prestataire && (
                  <span>
                    Par {seance.prestataire.prenom} {seance.prestataire.nom}
                  </span>
                )}
              </div>

              {seance.note && (
                <div className="mt-2 p-2 bg-blue-50 rounded text-sm text-gray-700">
                  <span className="font-medium">Note:</span> {seance.note}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Voir dossier */}
          <button
            disabled={!canOpen}
            onClick={() => canOpen && onOpenDossier && onOpenDossier(seance.dossier!, seance.patient!)}
            className={`p-2 rounded-lg transition ${
              canOpen ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-300 cursor-not-allowed'
            }`}
            title={canOpen ? 'Voir le dossier' : 'Dossier indisponible'}
          >
            <Eye className="w-5 h-5" />
          </button>

          {/* Actions selon état */}
          {isProgrammee ? (
            <>
              {/* Enregistrer la réalisation */}
              <button
                disabled={!canConvertToReal}
                onClick={() => onRealizeScheduled(seance)}
                className={`p-2 rounded-lg transition ${
                  canConvertToReal ? 'text-emerald-700 hover:bg-emerald-50' : 'text-gray-300 cursor-not-allowed'
                }`}
                title="Enregistrer la réalisation"
              >
                <CheckCircle2 className="w-5 h-5" />
              </button>

              {/* Modifier la séance programmée */}
              {isAdmin && (
                <button
                  onClick={() => onEditScheduled(seance)}
                  className="p-2 text-blue-700 hover:bg-blue-50 rounded-lg transition"
                  title="Modifier la séance programmée"
                >
                  <Clock className="w-5 h-5" />
                </button>
              )}
            </>
          ) : (
            // Éditer une séance RÉALISÉE (admin)
            isAdmin && (
              <button
                onClick={() => setShowEditModal(true)}
                className="p-2 text-teal-600 hover:bg-teal-50 rounded-lg transition"
                title="Modifier la séance"
              >
                <SquarePen className="w-5 h-5" />
              </button>
            )
          )}
        </div>
      </div>

      {isAdmin && showEditModal && (
        <EditSeanceModal
          seance={seance}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            onUpdate();
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------
   Vignette patient
------------------------------------------------------- */
function PatientThumb({ patient, size = 48 }: { patient: Patient | null; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!patient || !(patient as any).photo_path) {
        if (alive) setUrl(null);
        return;
      }
      const path = (patient as any).photo_path as string;
      const { data, error } = await supabase.storage.from('patient_photos').createSignedUrl(path, 120);
      if (!error && data?.signedUrl && alive) setUrl(data.signedUrl);
      if (error && alive) setUrl(null);
    })();
    return () => {
      alive = false;
    };
  }, [patient]);

  if (!patient || !url) {
    return (
      <div
        className="rounded-full bg-teal-100 flex items-center justify-center overflow-hidden"
        style={{ width: size, height: size }}
        title="Patient"
      >
        {patient ? (
          <span className="text-teal-700 font-semibold">
            {patient.prenom?.[0]}
            {patient.nom?.[0]}
          </span>
        ) : (
          <UserIcon className="text-teal-600" style={{ width: size * 0.6, height: size * 0.6 }} />
        )}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={`${patient.prenom} ${patient.nom}`}
      className="rounded-full object-cover"
      style={{ width: size, height: size }}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

/* -------------------------------------------------------
   Modal d’AJOUT de séance (réalisée) — bornes vs dernière réalisée
   + RÈGLE ajoutée : blocage si des séances programmées existent pour le dossier choisi
   (conversion programmée → réalisée NON bloquée pour admin, et pour assistants seulement le jour même)
   + Montant payé OBLIGATOIRE
------------------------------------------------------- */
function AddSeanceModal({
  date,
  scheduledSeance, // si fourni : conversion programmée → réalisée
  onClose,
  onSuccess,
}: {
  date: string;
  scheduledSeance?: (Seance & { dossier?: DossierSoin; patient?: Patient }) | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === "admin";

  // ---- Recherche patient (même méthode que ScheduleSeanceModal) ----
  const [patients, setPatients] = useState<Patient[]>([]);
  const [q, setQ] = useState("");
  const filteredPatients = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return patients.slice(0, 50);
    const parts = term.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return patients.filter(
        (p) =>
          p.prenom.toLowerCase().includes(parts[0]) ||
          p.nom.toLowerCase().includes(parts[0])
      );
    }
    return patients.filter((p) => {
      const full = `${p.prenom} ${p.nom}`.toLowerCase();
      return (
        full.includes(parts.join(" ")) ||
        (p.prenom.toLowerCase().includes(parts[0]) &&
          p.nom.toLowerCase().includes(parts[1])) ||
        (p.prenom.toLowerCase().includes(parts[1]) &&
          p.nom.toLowerCase().includes(parts[0]))
      );
    });
  }, [q, patients]);

  // ---- Sélection patient/dossier ----
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(
    scheduledSeance?.patient || null
  );
  const [dossiers, setDossiers] = useState<DossierSoin[]>([]);
  const [selectedDossier, setSelectedDossier] = useState<DossierSoin | null>(
    scheduledSeance?.dossier || null
  );

  // --- Compte des séances programmées pour le dossier sélectionné ---
  const [scheduledCount, setScheduledCount] = useState<number>(0);
  const [scheduledCountLoading, setScheduledCountLoading] = useState(false);

  // ---- Prestataire / paiement / note ----
  const [users, setUsers] = useState<UserBase[]>([]);
  const [selectedPrestataire, setSelectedPrestataire] = useState(user?.id || "");

  // Montant OBLIGATOIRE : '' par défaut (sauf si la séance programmée a déjà une valeur)
  const [montantPaye, setMontantPaye] = useState(
    scheduledSeance && (scheduledSeance as any).montant_paye != null
      ? String((scheduledSeance as any).montant_paye)
      : ""
  );
  const [note, setNote] = useState(scheduledSeance?.note || "");

  // Validation du montant
  const montantValid = useMemo(() => {
    const v = (montantPaye ?? "").toString().trim();
    if (v === "") return false;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
  }, [montantPaye]);

  // ---- Heure / Minute / Durée ----
  const hoursOptions = useMemo(
    () => Array.from({ length: 13 }, (_, i) => (8 + i).toString().padStart(2, "0")),
    []
  );
  const [hour, setHour] = useState<string>("08");     // select
  const [minute, setMinute] = useState<string>("00"); // input libre
  const [duree, setDuree] = useState<string>("");

  // ---- BORNES (dernière réalisée de ce dossier) ----
  const [lastRealDate, setLastRealDate] = useState<string | null>(null); // "YYYY-MM-DD"
  const [lastRealTime, setLastRealTime] = useState<string | null>(null); // "HH:MM"

  const [loading, setLoading] = useState(false);
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Charger patients + prestataires
  useEffect(() => {
    (async () => {
      const { data: pts } = await supabase
        .from("patients")
        .select("*")
        .eq("client_id", userBase?.client_id)
        .order("nom");
      setPatients((pts || []) as Patient[]);

      if (isAdmin) {
        const { data: us } = await supabase
          .from("users_base")
          .select("id, nom, prenom, client_id")
          .eq("client_id", userBase?.client_id)
          .order("nom");
        setUsers((us || []) as UserBase[]);
      }
    })();
  }, [isAdmin, userBase?.client_id]);

  // Charger dossiers (en cours / à venir) du patient choisi (sauf en conversion)
  useEffect(() => {
    (async () => {
      if (!selectedPatient || scheduledSeance) {
        if (!selectedPatient) {
          setDossiers([]);
          setSelectedDossier(null);
        }
        return;
      }
      const { data } = await supabase
        .from("dossiers_soins")
        .select("*")
        .eq("patient_id", selectedPatient.id)
        .eq("client_id", userBase?.client_id)
        .in("etat", ["a_venir", "en_cours"])
        .order("created_at", { ascending: false });
      setDossiers((data || []) as DossierSoin[]);
    })();
  }, [selectedPatient, scheduledSeance, userBase?.client_id]);

  // Charger la DERNIÈRE séance RÉALISÉE du dossier sélectionné
  useEffect(() => {
    (async () => {
      if (!selectedDossier || scheduledSeance) {
        setLastRealDate(null);
        setLastRealTime(null);
        return;
      }
      const { data } = await supabase
        .from("seances")
        .select("date_seance, heure_seance, etat_seance")
        .eq("dossier_id", selectedDossier.id)
        .in("etat_seance", ["réalisée", "realisee"])
        .order("date_seance", { ascending: false })
        .order("heure_seance", { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setLastRealDate(data[0].date_seance as string);
        setLastRealTime(data[0].heure_seance ? String(data[0].heure_seance).slice(0, 5) : "00:00");
      } else {
        setLastRealDate(null);
        setLastRealTime(null);
      }
    })();
  }, [selectedDossier, scheduledSeance]);

  // ⚙️ Charger le nombre de séances programmées du dossier sélectionné (sauf en conversion)
  useEffect(() => {
    (async () => {
      if (!selectedDossier || scheduledSeance) {
        setScheduledCount(0);
        return;
      }
      setScheduledCountLoading(true);
      const { count, data, error } = await supabase
        .from('seances')
        .select('id', { count: 'exact', head: true })
        .eq('dossier_id', selectedDossier.id)
        .in('etat_seance', ['programmée', 'programmee'] as any);

      if (!error) {
        setScheduledCount(typeof count === 'number' ? count : (data?.length ?? 0));
      } else {
        setScheduledCount(0);
      }
      setScheduledCountLoading(false);
    })();
  }, [selectedDossier, scheduledSeance]);

  const getNextSeanceNumber = async (dossierId: string) => {
    const { data } = await supabase
      .from("seances")
      .select("numero_seance")
      .eq("dossier_id", dossierId)
      .order("numero_seance", { ascending: false })
      .limit(1);
    return data && data.length > 0 ? data[0].numero_seance + 1 : 1;
  };

  // Helpers comparaisons
  const sameDayAsLast = !!lastRealDate && date === lastRealDate;
  const lastHH = lastRealTime ? lastRealTime.slice(0, 2) : null;
  const lastMM = lastRealTime ? lastRealTime.slice(3, 5) : null;

  const hourDisabled = (h: string) => {
    if (!sameDayAsLast || !lastHH) return false;
    return Number(h) < Number(lastHH);
  };

  const minuteNum = Number((minute || "").replace(/[^\d]/g, ""));
  const minuteTooSmallOrEqual =
    sameDayAsLast && lastHH && lastMM && hour === lastHH &&
    (!Number.isFinite(minuteNum) || minuteNum <= Number(lastMM));

  // Message si la date sélectionnée est < dernière réalisée
  const dateBeforeLast = !!lastRealDate && date < lastRealDate;

  const handleSubmit = async () => {
    // ⚠️ Conversion d’une "programmée" en "réalisée"
    if (scheduledSeance) {
      // ✅ Règle demandée : assistant interdit sur un jour passé
      if (!isAdmin && date < today) {
        alert("Action non autorisée : un assistant ne peut pas enregistrer la réalisation d’une séance programmée d’un jour passé.");
        return;
      }

      // ⛔ Montant obligatoire
      if (!montantValid) {
        alert("Le montant payé est obligatoire et doit être ≥ 0.");
        return;
      }
      const amount = Number((montantPaye ?? "").toString().trim());

      setLoading(true);
      try {
        const { error: updErr } = await supabase
          .from("seances")
          .update({
            etat_seance: "réalisée" as EtatSeance,
            prestataire_id: selectedPrestataire,
            montant_paye: amount,
            note: note || null,
          })
          .eq("id", scheduledSeance.id);
        if (updErr) throw updErr;
        onSuccess();
      } catch (e: any) {
        alert(e?.message || "Erreur lors de l’enregistrement.");
      } finally {
        setLoading(false);
      }
      return;
    }

    // ➜ Ajout direct d’une nouvelle réalisée
    if (!selectedDossier) {
      alert("Sélectionnez un dossier.");
      return;
    }

    // 🔒 Re-vérification à la volée : des séances programmées pour ce dossier ?
    {
      const { count, data, error } = await supabase
        .from('seances')
        .select('id', { count: 'exact', head: true })
        .eq('dossier_id', selectedDossier.id)
        .in('etat_seance', ['programmée', 'programmee'] as any);

      const nbProg = !error ? (typeof count === 'number' ? count : (data?.length ?? 0)) : 0;
      if (nbProg > 0) {
        alert(
          `Impossible d’ajouter une séance réalisée : ${nbProg} séance(s) programmée(s) existent pour ce dossier. ` +
          `Veuillez d’abord les enregistrer comme réalisées ou les supprimer.`
        );
        return;
      }
    }

    // Validation HH/MM/Durée
    const HH = (hour || "").replace(/[^\d]/g, "").slice(0, 2).padStart(2, "0");
    const MM = (minute || "").replace(/[^\d]/g, "").slice(0, 2).padStart(2, "0");
    const hNum = Number(HH);
    const mNum = Number(MM);
    if (!Number.isFinite(hNum) || hNum < 0 || hNum > 23) {
      alert("Heure invalide (0–23).");
      return;
    }
    if (!Number.isFinite(mNum) || mNum < 0 || mNum > 59) {
      alert("Minutes invalides (0–59).");
      return;
    }
    const dureeNum = (duree ?? "").trim() === "" ? null : Number((duree || "").replace(/[^\d]/g, ""));
    if (dureeNum !== null && (!Number.isFinite(dureeNum) || dureeNum < 0)) {
      alert("Durée invalide (minutes ≥ 0).");
      return;
    }

    // ⛔ Montant obligatoire
    if (!montantValid) {
      alert("Le montant payé est obligatoire et doit être ≥ 0.");
      return;
    }
    const amount = Number((montantPaye ?? "").toString().trim());

    // RÈGLE des bornes vs DERNIÈRE RÉALISÉE
    if (lastRealDate && lastRealTime) {
      if (date < lastRealDate) {
        alert(`Date invalide : doit être ≥ ${new Date(lastRealDate).toLocaleDateString("fr-FR")}.`);
        return;
      }
      if (date === lastRealDate) {
        const hh = Number(HH);
        const mm = Number(MM);
        if (hh < Number(lastHH)) {
          alert(`Heure invalide : doit être ≥ ${lastRealTime}.`);
          return;
        }
        if (hh === Number(lastHH) && mm <= Number(lastMM)) {
          alert(`Minutes invalides : doit être > ${lastRealTime}.`);
          return;
        }
      }
    }

    // Pas de futur (déjà garanti par le header, mais on garde la garde-fou)
    if (date > today) {
      alert("La date ne peut pas être dans le futur.");
      return;
    }

    setLoading(true);
    try {
      const numero = await getNextSeanceNumber(selectedDossier.id);
      const heureStr = `${HH}:${MM}:00`;

      const { error: insErr } = await supabase.from("seances").insert({
        dossier_id: selectedDossier.id,
        numero_seance: numero,
        date_seance: date,
        heure_seance: heureStr,
        etat_seance: "réalisée" as EtatSeance,
        prestataire_id: selectedPrestataire,
        montant_paye: amount,
        duree_minutes: dureeNum,
        note: note || null,
      });
      if (insErr) throw insErr;

      onSuccess();
    } catch (e: any) {
      alert(e?.message || "Erreur lors de l’enregistrement.");
    } finally {
      setLoading(false);
    }
  };

  const assistantPastBlocked = !isAdmin && !!scheduledSeance && date < today;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h[90vh] max-h-[90vh] overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">
            {scheduledSeance ? "Enregistrer la réalisation" : "Nouvelle séance réalisée"}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg" title="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Date de travail (vient de l'écran) */}
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <span className="text-gray-600">Date sélectionnée&nbsp;:</span>{" "}
          <span className="font-semibold">{new Date(date).toLocaleDateString("fr-FR")}</span>
          {lastRealDate && (
            <span className={`ml-2 ${!!lastRealDate && date < lastRealDate ? 'text-red-600' : 'text-gray-600'}`}>
              • dernière séance réalisée le {new Date(lastRealDate).toLocaleDateString("fr-FR")} à {lastRealTime || ''}
            </span>
          )}
        </div>

        {/* 🔒 Message de blocage assistant sur jour passé en conversion */}
        {assistantPastBlocked && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
            Les assistants ne peuvent pas enregistrer la réalisation d’une séance programmée pour un jour passé.
          </div>
        )}

        {/* Alerte: séances programmées à traiter (affichée seulement en AJOUT, pas en conversion) */}
        {!scheduledSeance && selectedDossier && scheduledCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
            Ce dossier comporte <b>{scheduledCount}</b> séance(s) programmée(s).
            <br />
            Traitez ces séances (réaliser ou supprimer) avant d’ajouter une nouvelle séance réalisée.
          </div>
        )}

        {/* Étape patient/dossier — pas affichée en conversion */}
        {!scheduledSeance && (
          <>
            {/* Patient */}
            <div>
              <label className="block text-sm text-gray-700 mb-1">Patient</label>
              <div className="relative">
                <div className="flex items-center gap-2 border rounded px-2 py-1">
                  <Search className="w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="prénom, nom, ou 'prénom nom'…"
                    className="flex-1 outline-none py-1"
                  />
                  {selectedPatient && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPatient(null);
                        setSelectedDossier(null);
                        setQ("");
                      }}
                      className="text-gray-500 hover:text-gray-700"
                      title="Effacer la sélection"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {!!q.trim() && !selectedPatient && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-56 overflow-auto">
                    {filteredPatients.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">Aucun résultat</div>
                    ) : (
                      filteredPatients.slice(0, 30).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPatient(p)}
                          className="w-full px-3 py-2 text-left hover:bg-gray-50 text-sm"
                        >
                          {p.prenom} {p.nom}{" "}
                          {(p as any).telephone ? (
                            <span className="text-gray-400">— {(p as any).telephone}</span>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Dossier en cours / à venir */}
            <div>
              <label className="block text-sm text-gray-700 mb-1">Dossier</label>
              {!selectedPatient ? (
                <div className="text-sm text-gray-500">Choisissez d’abord un patient.</div>
              ) : dossiers.length === 0 ? (
                <div className="text-sm text-gray-500">Aucun dossier en cours/à venir pour ce patient.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {dossiers.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDossier(d)}
                      className={`p-3 rounded border text-left hover:bg-gray-50 ${
                        selectedDossier?.id === d.id ? "border-teal-500 ring-1 ring-teal-200" : ""
                      }`}
                    >
                      <div className="font-medium">{d.motif}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {d.nombre_seances ? `${d.nombre_seances} séances prévues` : "—"} • état {d.etat}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Prestataire / Horaire / Durée / Paiement / Note */}
        <div className="space-y-3">
          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Prestataire</label>
              <select
                value={selectedPrestataire}
                onChange={(e) => setSelectedPrestataire(e.target.value)}
                className="w-full border rounded px-3 py-2 bg-white"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.prenom} {u.nom}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* HH / MM / Durée — seulement pour nouvelle RÉALISÉE */}
          {!scheduledSeance && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heure (HH)</label>
                  <select
                    value={hour}
                    onChange={(e) => setHour(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                    title="Heure (HH)"
                  >
                    {hoursOptions.map((h) => (
                      <option key={h} value={h} disabled={sameDayAsLast && hourDisabled(h)}>
                        {h}
                      </option>
                    ))}
                  </select>
                  {sameDayAsLast && lastRealTime && (
                    <p className="text-xs text-gray-500 mt-1">Heure ≥ {lastRealTime}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Minutes (MM)</label>
                  <input
                    value={minute}
                    onChange={(e) => setMinute(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                    placeholder="ex: 30"
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${
                      sameDayAsLast && minuteTooSmallOrEqual
                        ? "border-red-300 focus:ring-red-200"
                        : "border-gray-300 focus:ring-teal-500"
                    }`}
                  />
                  {sameDayAsLast && lastRealTime && hour === lastHH && (
                    <p className={`text-xs mt-1 ${minuteTooSmallOrEqual ? "text-red-600" : "text-gray-500"}`}>
                      Minutes &gt; {lastRealTime}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (min)</label>
                  <input
                    value={duree}
                    onChange={(e) => setDuree(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                    placeholder="ex: 45"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>

              {dateBeforeLast && (
                <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">
                  La date choisie est antérieure à la dernière séance réalisée du dossier.
                </div>
              )}
            </>
          )}

          {/* Montant obligatoire */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Montant payé (DT) *</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              required
              value={montantPaye}
              onChange={(e) => setMontantPaye(e.target.value)}
              placeholder="ex: 40.00"
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 ${
                montantValid ? "border-gray-300 focus:ring-teal-500" : "border-red-300 focus:ring-red-200"
              }`}
            />
            {!montantValid && (
              <p className="text-xs text-red-600 mt-1">Le montant est obligatoire</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Note (optionnelle)</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ajouter une note…"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={
              loading ||
              !montantValid || // ⛔ montant obligatoire
              (!!lastRealDate && date < lastRealDate) ||
              (sameDayAsLast && minuteTooSmallOrEqual) ||
              (!scheduledSeance && selectedDossier && scheduledCount > 0) || // ⛔ blocage si programmées en attente
              (!!scheduledSeance && !isAdmin && date < today) // ⛔ assistants bloqués en conversion sur jour passé
            }
            className="w-full px-4 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition disabled:opacity-50"
          >
            {loading
              ? "Enregistrement…"
              : scheduledSeance
              ? "Marquer comme réalisée"
              : "Enregistrer la séance"}
          </button>
        </div>
      </div>
    </div>
  );
}
