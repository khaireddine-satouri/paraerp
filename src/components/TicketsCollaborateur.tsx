import { useEffect, useMemo, useState } from 'react';
import { supabase, UserBase, Patient, DossierSoin, Seance } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Calendar, ChevronLeft, ChevronRight, Plus, X, Search } from 'lucide-react';

/* ---------------- Types ---------------- */
type TicketStatus = 'non_traite' | 'traite';

type Ticket = {
  id: string;
  client_id: string;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  sujet: string;
  commentaire: string | null;
  patient_id: string | null;
  dossier_id: string | null;
  seance_id: string | null;
  statut: TicketStatus;
  admin_comment: string | null;
  treated_at: string | null;
  treated_by: string | null;
};

type TicketsCollaborateurProps = {
  onOpenPatient?: (patientId: string) => void;
  onOpenDossier?: (dossierId: string) => void;
};

/* ---------- Helpers formats ---------- */
const formatTunis = (d?: string | null) => {
  if (!d) return null;
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Tunis',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(d));
};

/* ====================== Liste Tickets (assistant) ====================== */
export default function TicketsCollaborateur({
  onOpenPatient,
  onOpenDossier,
}: TicketsCollaborateurProps) {
  const { userBase } = useAuth();
  const isAssistant = userBase?.type_utilisateur === 'assistant';
  const clientId = userBase?.client_id || null;
  const myId = userBase?.id || null;

  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const isFuture = selectedDate > today;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  // libellés
  const [mapUsers, setMapUsers] = useState<
    Map<string, Pick<UserBase, 'id' | 'nom' | 'prenom'>>
  >(new Map());
  const [mapPatients, setMapPatients] = useState<Map<string, Patient>>(new Map());
  const [mapDossiers, setMapDossiers] = useState<Map<string, DossierSoin>>(new Map());
  const [mapSeances, setMapSeances] = useState<Map<string, Seance>>(new Map());

  // modal création (avec recherche)
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!clientId || !myId || !isAssistant) return;
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, myId, isAssistant, selectedDate]);

  const dayBoundsUTC = (d: string) => {
    const start = `${d}T00:00:00.000Z`;
    const end = new Date(`${d}T00:00:00.000Z`);
    end.setDate(end.getDate() + 1);
    return { start, end: end.toISOString() };
  };

  const loadTickets = async () => {
    setLoading(true);
    try {
      const { start, end } = dayBoundsUTC(selectedDate);

      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('client_id', clientId)
        .eq('created_by', myId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const rows = data || [];
      setTickets(rows);

      // users (créateur + traité par)
      const userIds = Array.from(
        new Set(rows.flatMap((t) => [t.created_by, t.treated_by].filter(Boolean) as string[]))
      );
      if (userIds.length) {
        const { data: ub } = await supabase
          .from('users_base')
          .select('id, nom, prenom')
          .in('id', userIds);
        setMapUsers(new Map((ub || []).map((u) => [u.id, u])));
      } else setMapUsers(new Map());

      // labels patients/dossiers/séances
      const patientIds = Array.from(
        new Set(rows.map((t) => t.patient_id).filter(Boolean))
      ) as string[];
      const dossierIds = Array.from(
        new Set(rows.map((t) => t.dossier_id).filter(Boolean))
      ) as string[];
      const seanceIds = Array.from(
        new Set(rows.map((t) => t.seance_id).filter(Boolean))
      ) as string[];

      if (patientIds.length) {
        const { data: pts } = await supabase.from('patients').select('*').in('id', patientIds);
        setMapPatients(new Map((pts || []).map((p) => [p.id, p])));
      } else setMapPatients(new Map());

      if (dossierIds.length) {
        const { data: ds } = await supabase
          .from('dossiers_soins')
          .select('*')
          .in('id', dossierIds);
        setMapDossiers(new Map((ds || []).map((d) => [d.id, d])));
      } else setMapDossiers(new Map());

      if (seanceIds.length) {
        const { data: ss } = await supabase.from('seances').select('*').in('id', seanceIds);
        setMapSeances(new Map((ss || []).map((s) => [s.id, s])));
      } else setMapSeances(new Map());
    } catch (e) {
      console.error('Erreur chargement tickets collaborateur:', e);
      setTickets([]);
      setMapUsers(new Map());
      setMapPatients(new Map());
      setMapDossiers(new Map());
      setMapSeances(new Map());
    } finally {
      setLoading(false);
    }
  };

  const labelUser = (id?: string | null) => {
    if (!id) return null;
    const u = mapUsers.get(id);
    return u ? `${u.prenom} ${u.nom}` : id;
  };
  const labelPatient = (id?: string | null) => {
    if (!id) return null;
    const p = mapPatients.get(id);
    return p ? `${p.prenom} ${p.nom}` : id;
  };
  const labelDossier = (id?: string | null) => {
    if (!id) return null;
    const d = mapDossiers.get(id);
    return d ? d.motif : id;
  };
  const labelSeance = (t: Ticket) => {
    if (!t.seance_id) return null;
    const s = mapSeances.get(t.seance_id);
    const d = t.dossier_id ? mapDossiers.get(t.dossier_id) : undefined;
    if (s && d) return `Séance ${s.numero_seance} / ${d.nombre_seances}`;
    if (s) return `Séance ${s.numero_seance}`;
    return t.seance_id;
  };

  const gotoPrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };
  const gotoNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    const next = d.toISOString().split('T')[0];
    if (next <= today) setSelectedDate(next);
  };

  if (!isAssistant) {
    return <div className="p-6 text-gray-600">Accès réservé aux assistants.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header + nav + bouton créer */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Mes tickets</h2>
            <p className="text-gray-600">Envoyer un ticket à mon administrateur</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <Calendar className="w-5 h-5 text-gray-600" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={today}
                className="bg-transparent border-none focus:outline-none"
              />
              <button
                onClick={gotoPrevDay}
                className="p-1 rounded hover:bg-gray-100"
                title="Jour précédent"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={gotoNextDay}
                disabled={isFuture || selectedDate >= today}
                className={`p-1 rounded ${
                  selectedDate >= today ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100'
                }`}
                title="Jour suivant"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <button
              onClick={() => setShowCreate(true)}
              className="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg flex items-center gap-2"
              title="Nouveau ticket"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden sm:inline">Nouveau ticket</span>
            </button>
          </div>
        </div>
      </div>

      {/* Liste du jour */}
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Tickets du {new Date(selectedDate).toLocaleDateString('fr-FR')}
        </h3>

        {loading ? (
          <div className="py-10 text-center text-gray-500">Chargement…</div>
        ) : tickets.length === 0 ? (
          <div className="py-10 text-center text-gray-500">Aucun ticket ce jour-là.</div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => {
              const auteur = labelUser(t.created_by);
              const isTraite = t.statut === 'traite';
              return (
                <div key={t.id} className="p-4 rounded-lg border bg-gray-50">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    {/* Bloc principal */}
                    <div className="flex-1 min-w-0">
                      {/* Titre + badge statut */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 break-words">{t.sujet}</p>
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            isTraite ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {isTraite ? 'Traité' : 'Non traité'}
                        </span>
                      </div>

                      {/* Méta (heure Tunis) avec sauts de ligne */}
                      <div className="mt-1 text-xs text-gray-500 leading-5">
                        par {auteur || t.created_by}
                        <span className="mx-1">—</span>
                        {formatTunis(t.created_at)}
                        {isTraite && (
                          <div>
                            traité par {labelUser(t.treated_by) || t.treated_by}
                            {t.treated_at && (
                              <>
                                <span className="mx-1">le</span>
                                {formatTunis(t.treated_at)}
                              </>
                            )}
                          </div>
                        )}
                        {t.updated_at && <div>maj : {formatTunis(t.updated_at)}</div>}
                      </div>

                      {/* Commentaire collaborateur */}
                      {t.commentaire && (
                        <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap break-words">
                          {t.commentaire}
                        </p>
                      )}

                      {/* Détails attachés (liens sur noms) */}
                      <div className="mt-3 text-sm text-gray-700 space-y-1">
                        {t.patient_id && (
                          <div>
                            <span className="text-gray-500">Patient :</span>{' '}
                            {onOpenPatient ? (
                              <button
                                type="button"
                                onClick={() => onOpenPatient(t.patient_id!)}
                                className="font-medium text-teal-700 hover:underline"
                                title="Ouvrir le patient"
                              >
                                {labelPatient(t.patient_id)}
                              </button>
                            ) : (
                              <span className="font-medium">{labelPatient(t.patient_id)}</span>
                            )}
                          </div>
                        )}
                        {t.dossier_id && (
                          <div>
                            <span className="text-gray-500">Dossier :</span>{' '}
                            {onOpenDossier ? (
                              <button
                                type="button"
                                onClick={() => onOpenDossier(t.dossier_id!)}
                                className="font-medium text-teal-700 hover:underline"
                                title="Ouvrir le dossier"
                              >
                                {labelDossier(t.dossier_id)}
                              </button>
                            ) : (
                              <span className="font-medium">{labelDossier(t.dossier_id)}</span>
                            )}
                          </div>
                        )}
                        {t.seance_id && (
                          <div>
                            <span className="text-gray-500">Séance :</span>{' '}
                            {t.dossier_id && onOpenDossier ? (
                              <button
                                type="button"
                                onClick={() => onOpenDossier(t.dossier_id!)}
                                className="font-medium text-teal-700 hover:underline"
                                title="Ouvrir le dossier de la séance"
                              >
                                {labelSeance(t)}
                              </button>
                            ) : (
                              <span className="font-medium">{labelSeance(t)}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Note admin éventuelle */}
                      {t.admin_comment && (
                        <div className="mt-3 text-sm bg-emerald-50 text-emerald-800 rounded p-2">
                          <span className="font-medium">Note admin :</span> {t.admin_comment}
                        </div>
                      )}
                    </div>

                    {/* Bloc droit supprimé (pas d’actions côté assistant) */}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal création AVEC recherche patient/dossier/séance (tous optionnels) */}
      {showCreate && (
        <CreateTicketModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadTickets();
          }}
        />
      )}
    </div>
  );
}

/* ============== Modal de création avec recherche ============== */
function CreateTicketModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { userBase } = useAuth();

  // champs
  const [sujet, setSujet] = useState('');
  const [commentaire, setCommentaire] = useState('');

  // sélection liés
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDossier, setSelectedDossier] = useState<DossierSoin | null>(null);
  const [selectedSeance, setSelectedSeance] = useState<Seance | null>(null);

  // recherches
  const [qPatient, setQPatient] = useState('');
  const [qDossier, setQDossier] = useState('');

  const [resultsPatients, setResultsPatients] = useState<Patient[]>([]);
  const [resultsDossiers, setResultsDossiers] = useState<DossierSoin[]>([]);
  const [resultsSeances, setResultsSeances] = useState<Seance[]>([]);

  const [loadingSearchP, setLoadingSearchP] = useState(false);
  const [loadingSearchD, setLoadingSearchD] = useState(false);
  const [loadingSeances, setLoadingSeances] = useState(false);
  const [saving, setSaving] = useState(false);

  const canSave = sujet.trim().length > 0;

  // --- Recherche patients (prénom/nom/combinaison, ilike) ---
  useEffect(() => {
    const run = async () => {
      if (!userBase?.client_id) return;
      const term = qPatient.trim();
      if (term.length < 2) {
        setResultsPatients([]);
        return;
      }
      setLoadingSearchP(true);
      try {
        // On split le terme pour permettre "prenom nom" (2 mots)
        const words = term.split(/\s+/).filter(Boolean);
        let query = supabase.from('patients').select('*').eq('client_id', userBase.client_id);
        if (words.length === 1) {
          const like = `%${words[0]}%`;
          // filtre OR sur prénom/nom (via RPC impossible ici, on chaînera client-side)
          const { data, error } = await query.ilike('prenom', like);
          if (error) throw error;
          const { data: data2, error: e2 } = await supabase
            .from('patients')
            .select('*')
            .eq('client_id', userBase.client_id)
            .ilike('nom', like);
          if (e2) throw e2;
          // fusion simple et dédoublonnage
          const map = new Map<string, Patient>();
          (data || []).forEach((p) => map.set(p.id, p as Patient));
          (data2 || []).forEach((p) => map.set(p.id, p as Patient));
          setResultsPatients(Array.from(map.values()).slice(0, 20));
        } else {
          // 2 mots : on cherche prénom ~ mot1 ET nom ~ mot2 (approx simple côté client)
          const like1 = `%${words[0]}%`;
          const like2 = `%${words[1]}%`;
          const { data, error } = await query.ilike('prenom', like1);
          if (error) throw error;
          const filtered =
            (data || []).filter(
              (p) =>
                p.nom?.toLowerCase().includes(words[1].toLowerCase()) ||
                p.prenom?.toLowerCase().includes(words[1].toLowerCase())
            ) || [];
          setResultsPatients(filtered.slice(0, 20) as Patient[]);
        }
      } catch (e) {
        console.error('Recherche patient:', e);
        setResultsPatients([]);
      } finally {
        setLoadingSearchP(false);
      }
    };
    run();
  }, [qPatient, userBase?.client_id]);

  // --- Recherche dossiers (par motif). Si patient sélectionné => restreindre à ce patient ---
  useEffect(() => {
    const run = async () => {
      if (!userBase?.client_id) return;
      const term = qDossier.trim();
      if (term.length < 2 && !selectedPatient) {
        setResultsDossiers([]);
        return;
      }
      setLoadingSearchD(true);
      try {
        let q = supabase
          .from('dossiers_soins')
          .select('*')
          .eq('client_id', userBase.client_id);
        if (selectedPatient) q = q.eq('patient_id', selectedPatient.id);
        if (term.length >= 2) q = q.ilike('motif', `%${term}%`);
        const { data, error } = await q.order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        setResultsDossiers((data || []) as DossierSoin[]);
      } catch (e) {
        console.error('Recherche dossier:', e);
        setResultsDossiers([]);
      } finally {
        setLoadingSearchD(false);
      }
    };
    run();
  }, [qDossier, selectedPatient, userBase?.client_id]);

  // --- Charger séances quand un dossier est choisi ---
  useEffect(() => {
    const fetchSeances = async () => {
      setResultsSeances([]);
      setSelectedSeance(null);
      if (!selectedDossier) return;
      setLoadingSeances(true);
      try {
        const { data, error } = await supabase
          .from('seances')
          .select('*')
          .eq('dossier_id', selectedDossier.id)
          .order('numero_seance', { ascending: true });
        if (error) throw error;
        setResultsSeances((data || []) as Seance[]);
      } catch (e) {
        console.error('Chargement séances:', e);
        setResultsSeances([]);
      } finally {
        setLoadingSeances(false);
      }
    };
    fetchSeances();
  }, [selectedDossier]);

  // --- Sélection patient/dossier/séance ---
  const selectPatient = (p: Patient) => {
    setSelectedPatient(p);
    setQPatient(`${p.prenom} ${p.nom}`);
    // si on change de patient, on réinitialise dossier/séance
    setSelectedDossier(null);
    setQDossier('');
    setSelectedSeance(null);
    setResultsSeances([]);
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setQPatient('');
    // on ne vide pas le dossier s’il a été choisi indépendamment
  };

  const selectDossier = (d: DossierSoin, autoAttachPatient = true) => {
    setSelectedDossier(d);
    setQDossier(d.motif || '');
    // auto-rattache le patient si non sélectionné
    if (autoAttachPatient && !selectedPatient) {
      // on va chercher le patient minimal si non déjà présent
      // (on pourrait aussi faire confiance à la présence de d.patient_id)
      setSelectedPatient({ id: d.patient_id } as any);
    }
    // reset séance
    setSelectedSeance(null);
  };

  const clearDossier = () => {
    setSelectedDossier(null);
    setQDossier('');
    setSelectedSeance(null);
    setResultsSeances([]);
  };

  const selectSeance = (s: Seance) => {
    setSelectedSeance(s);
  };

  const clearSeance = () => {
    setSelectedSeance(null);
  };

  const handleSave = async () => {
    if (!userBase?.client_id || !userBase?.id || !canSave) return;
    try {
      setSaving(true);
      const payload: any = {
        client_id: userBase.client_id,
        created_by: userBase.id,
        sujet: sujet.trim(),
        commentaire: commentaire.trim() || null,
        statut: 'non_traite',
      };
      if (selectedPatient?.id) payload.patient_id = selectedPatient.id;
      if (selectedDossier?.id) payload.dossier_id = selectedDossier.id;
      if (selectedSeance?.id) payload.seance_id = selectedSeance.id;

      // Si dossier choisi mais patient pas explicitement choisi, on auto-complète le patient
      if (!payload.patient_id && selectedDossier?.patient_id) {
        payload.patient_id = selectedDossier.patient_id;
      }

      const { error } = await supabase.from('tickets').insert(payload);
      if (error) throw error;
      onCreated();
    } catch (e) {
      console.error('Erreur création ticket:', e);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-2xl rounded-xl shadow p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Nouveau ticket</h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100" title="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sujet (obligatoire) + Commentaire */}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="text-sm text-gray-700">Sujet *</label>
            <input
              type="text"
              value={sujet}
              onChange={(e) => setSujet(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2"
              placeholder="Objet de la demande…"
            />
          </div>

          <div>
            <label className="text-sm text-gray-700">Commentaire</label>
            <textarea
              rows={3}
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2"
              placeholder="Décrivez votre demande…"
            />
          </div>
        </div>

        {/* Recherches (tous optionnels) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Patient */}
          <div>
            <label className="text-sm text-gray-700">Patient</label>
            <div className="relative mt-1">
              <div className="flex items-center gap-2 border rounded px-2 py-1">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={qPatient}
                  onChange={(e) => setQPatient(e.target.value)}
                  placeholder="Rechercher prénom/nom…"
                  className="flex-1 outline-none py-1"
                />
                {selectedPatient && (
                  <button
                    type="button"
                    onClick={clearPatient}
                    className="text-gray-500 hover:text-gray-700"
                    title="Effacer patient"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Liste résultats */}
              {!!qPatient.trim() && !selectedPatient && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-56 overflow-auto">
                  {loadingSearchP ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Recherche…</div>
                  ) : resultsPatients.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Aucun résultat</div>
                  ) : (
                    resultsPatients.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectPatient(p)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 text-sm"
                      >
                        {p.prenom} {p.nom} {p.telephone ? <span className="text-gray-400">— {p.telephone}</span> : null}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Dossier */}
          <div>
            <label className="text-sm text-gray-700">
              Dossier {selectedPatient ? <span className="text-xs text-gray-500">(filtré par patient)</span> : null}
            </label>
            <div className="relative mt-1">
              <div className="flex items-center gap-2 border rounded px-2 py-1">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={qDossier}
                  onChange={(e) => setQDossier(e.target.value)}
                  placeholder="Rechercher un motif…"
                  className="flex-1 outline-none py-1"
                />
                {selectedDossier && (
                  <button
                    type="button"
                    onClick={clearDossier}
                    className="text-gray-500 hover:text-gray-700"
                    title="Effacer dossier"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Liste résultats */}
              {(!!qDossier.trim() || selectedPatient) && !selectedDossier && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-56 overflow-auto">
                  {loadingSearchD ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Recherche…</div>
                  ) : resultsDossiers.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Aucun résultat</div>
                  ) : (
                    resultsDossiers.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => selectDossier(d, true)}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 text-sm"
                        title={d.motif || ''}
                      >
                        <div className="font-medium">{d.motif || '—'}</div>
                        <div className="text-xs text-gray-500">
                          {d.nombre_seances ? `${d.nombre_seances} séances prévues` : '—'}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Séance (dépend du dossier) */}
        <div>
          <label className="text-sm text-gray-700">Séance</label>
          <div className="mt-1">
            {!selectedDossier ? (
              <div className="text-sm text-gray-500">
                Sélectionnez d’abord un dossier pour choisir une séance.
              </div>
            ) : loadingSeances ? (
              <div className="text-sm text-gray-500">Chargement des séances…</div>
            ) : resultsSeances.length === 0 ? (
              <div className="text-sm text-gray-500">Aucune séance trouvée pour ce dossier.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {resultsSeances.map((s) => {
                  const isActive = selectedSeance?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => (isActive ? clearSeance() : selectSeance(s))}
                      className={`px-3 py-1 rounded border text-sm ${
                        isActive ? 'bg-teal-600 text-white border-teal-600' : 'hover:bg-gray-50'
                      }`}
                      title={`Séance ${s.numero_seance}`}
                    >
                      Séance {s.numero_seance}
                      {selectedDossier?.nombre_seances ? ` / ${selectedDossier.nombre_seances}` : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded border">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-4 py-2 rounded bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
          >
            {saving ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>

       {/* Aide rappel 
        <p className="text-xs text-gray-500">
          * Seul le <span className="font-medium">sujet</span> est obligatoire. Patient, dossier et séance sont
          optionnels. Si vous choisissez un dossier sans sélectionner de patient, le patient sera
          rattaché automatiquement.
        </p>*/}
      </div>
    </div>
  );
}
