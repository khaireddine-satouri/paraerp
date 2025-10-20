import { useEffect, useMemo, useState } from 'react';
import { supabase, UserBase, Patient, DossierSoin, Seance } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Calendar, ChevronLeft, ChevronRight, CheckCircle2, Undo2 } from 'lucide-react';
import { useNewTicketsIndicator } from '../hooks/useNewTicketsIndicator';

type Ticket = {
  id: string;
  client_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  sujet: string;
  commentaire: string | null;
  patient_id: string | null;
  dossier_id: string | null;
  seance_id: string | null;
  statut: 'non_traite' | 'traite';
  admin_comment: string | null;
  treated_at: string | null;
  treated_by: string | null;
};

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

export default function TicketsAdmin({
  onOpenPatient,
  onOpenDossier,
}: {
  onOpenPatient?: (patientId: string) => void;
  onOpenDossier?: (dossierId: string) => void;
}) {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';

  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [byUser, setByUser] = useState<Map<string, Pick<UserBase, 'id' | 'nom' | 'prenom'>>>(new Map());
  const [loading, setLoading] = useState(true);

  const [mapPatients, setMapPatients] = useState<Map<string, Patient>>(new Map());
  const [mapDossiers, setMapDossiers] = useState<Map<string, DossierSoin>>(new Map());
  const [mapSeances, setMapSeances] = useState<Map<string, Seance>>(new Map());

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const isFuture = selectedDate > today;

  // ✅ Hook badge : purge automatique à l'ouverture
  const { markAsSeen } = useNewTicketsIndicator(userBase?.client_id || null, isAdmin);

  useEffect(() => {
    if (!userBase?.client_id || !isAdmin) return;
    // on purge le badge du jour lorsqu'on arrive sur cette page
    markAsSeen();
  }, [userBase?.client_id, isAdmin, markAsSeen]);

  useEffect(() => {
    if (!userBase?.client_id || !isAdmin) return;
    loadTickets();
  }, [userBase?.client_id, isAdmin, selectedDate]);

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
        .eq('client_id', userBase!.client_id)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows = data || [];
      setTickets(rows);

      const ids = new Set<string>();
      rows.forEach(t => {
        if (t.created_by) ids.add(t.created_by);
        if (t.treated_by) ids.add(t.treated_by);
      });
      if (ids.size) {
        const { data: users } = await supabase
          .from('users_base')
          .select('id, nom, prenom')
          .in('id', Array.from(ids));
        setByUser(new Map((users || []).map(u => [u.id, u])));
      } else {
        setByUser(new Map());
      }

      const patientIds = Array.from(new Set(rows.map(t => t.patient_id).filter(Boolean))) as string[];
      const dossierIds = Array.from(new Set(rows.map(t => t.dossier_id).filter(Boolean))) as string[];
      const seanceIds  = Array.from(new Set(rows.map(t => t.seance_id ).filter(Boolean))) as string[];

      if (patientIds.length) {
        const { data: pts } = await supabase.from('patients').select('*').in('id', patientIds);
        setMapPatients(new Map((pts||[]).map(p => [p.id, p])));
      } else setMapPatients(new Map());

      if (dossierIds.length) {
        const { data: doss } = await supabase.from('dossiers_soins').select('*').in('id', dossierIds);
        setMapDossiers(new Map((doss||[]).map(d => [d.id, d])));
      } else setMapDossiers(new Map());

      if (seanceIds.length) {
        const { data: seas } = await supabase.from('seances').select('*').in('id', seanceIds);
        setMapSeances(new Map((seas||[]).map(s => [s.id, s])));
      } else setMapSeances(new Map());

    } catch (e) {
      console.error('Erreur chargement tickets admin:', e);
      setTickets([]);
      setByUser(new Map());
      setMapPatients(new Map());
      setMapDossiers(new Map());
      setMapSeances(new Map());
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (ticket: Ticket, nextStatus: 'non_traite' | 'traite', adminComment?: string) => {
    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          statut: nextStatus,
          admin_comment: adminComment ?? ticket.admin_comment ?? null,
        })
        .eq('id', ticket.id);
      if (error) throw error;
      await loadTickets();
    } catch (e) {
      console.error('Erreur maj statut ticket:', e);
    }
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

  if (!isAdmin) {
    return <div className="text-gray-600 p-6">Accès réservé aux administrateurs.</div>;
  }

  const labelUser = (id?: string | null) => {
    if (!id) return null;
    const u = byUser.get(id);
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

  return (
    <div className="space-y-6">
      {/* Header + date nav */}
      <div className="bg-white rounded-xl shadow p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Tickets collaborateurs</h2>
            <p className="text-gray-600">Vue par jour</p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button onClick={gotoPrevDay} className="p-2 rounded-lg hover:bg-gray-100 text-gray-700" title="Jour précédent">
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex flex-1 sm:flex-none items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <Calendar className="w-5 h-5 text-gray-600 shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={today}
                className="bg-transparent border-none focus:outline-none text-sm flex-1"
              />
            </div>

            <button
              onClick={gotoNextDay}
              disabled={isFuture || selectedDate >= today}
              className={`p-2 rounded-lg ${selectedDate >= today ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-700'}`}
              title="Jour suivant"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-xl shadow p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
          Tickets du {new Date(selectedDate).toLocaleDateString('fr-FR')}
        </h3>

        {loading ? (
          <div className="py-10 text-center text-gray-500">Chargement…</div>
        ) : tickets.length === 0 ? (
          <div className="py-10 text-center text-gray-500">Aucun ticket ce jour-là.</div>
        ) : (
          <div className="space-y-4">
            {tickets.map((t) => {
              const auteur = labelUser(t.created_by);
              const isTraite = t.statut === 'traite';
              return (
                <div key={t.id} className="p-3 sm:p-4 rounded-lg border border-gray-200 bg-gray-50">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-semibold text-gray-900 truncate">{t.sujet}</p>
                        <span className={`text-[11px] px-2 py-1 rounded ${isTraite ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isTraite ? 'Traité' : 'Non traité'}
                        </span>
                      </div>

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

                        {t.updated_at && (
                          <div>maj : {formatTunis(t.updated_at)}</div>
                        )}
                      </div>
                    </div>

                    <div className="w-full sm:w-auto">
                      {isTraite ? (
                        <button
                          onClick={() => updateStatus(t, 'non_traite')}
                          className="w-full sm:w-auto px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded flex items-center justify-center gap-2"
                          title="Repasser non traité"
                        >
                          <Undo2 className="w-4 h-4" />
                          Repasser non traité
                        </button>
                      ) : (
                        <MarkDoneForm ticket={t} onSubmit={(c) => updateStatus(t, 'traite', c)} />
                      )}
                    </div>
                  </div>

                  {t.commentaire && (
                    <p className="mt-3 text-sm text-gray-800 whitespace-pre-wrap">{t.commentaire}</p>
                  )}

                  <div className="mt-3 text-sm text-gray-700 space-y-2">
                    {t.patient_id && (
                      <div>
                        <span className="text-gray-600">Patient : </span>
                        <button
                          type="button"
                          onClick={() => onOpenPatient?.(t.patient_id!)}
                          className="underline underline-offset-2 hover:text-teal-700"
                        >
                          {labelPatient(t.patient_id)}
                        </button>
                      </div>
                    )}
                    {t.dossier_id && (
                      <div>
                        <span className="text-gray-600">Dossier : </span>
                        <button
                          type="button"
                          onClick={() => onOpenDossier?.(t.dossier_id!)}
                          className="underline underline-offset-2 hover:text-teal-700"
                        >
                          {labelDossier(t.dossier_id)}
                        </button>
                      </div>
                    )}
                    {t.seance_id && (
                      <div>
                        <span className="text-gray-600">Séance : </span>
                        <button
                          type="button"
                          onClick={() => (t.dossier_id ? onOpenDossier?.(t.dossier_id) : undefined)}
                          className={`underline underline-offset-2 ${t.dossier_id ? 'hover:text-teal-700' : 'cursor-default'}`}
                        >
                          {labelSeance(t)}
                        </button>
                      </div>
                    )}
                  </div>

                  {t.admin_comment && (
                    <div className="mt-3 text-sm bg-emerald-50 text-emerald-800 rounded p-2 leading-6">
                      <span className="font-medium">Note admin :</span> {t.admin_comment}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MarkDoneForm({
  ticket,
  onSubmit,
}: {
  ticket: Ticket;
  onSubmit: (adminComment?: string) => void;
}) {
  const [comment, setComment] = useState(ticket.admin_comment || '');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    try {
      setSaving(true);
      await onSubmit(comment.trim() || undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
      <textarea
        rows={2}
        placeholder="Commentaire admin (optionnel)…"
        className="w-full sm:w-64 px-3 py-2 border rounded bg-white"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button
        onClick={handle}
        disabled={saving}
        className="w-full sm:w-auto px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded flex items-center justify-center gap-2 disabled:opacity-50"
        title="Marquer traité"
      >
        <CheckCircle2 className="w-4 h-4" />
        Marquer traité
      </button>
    </div>
  );
}
