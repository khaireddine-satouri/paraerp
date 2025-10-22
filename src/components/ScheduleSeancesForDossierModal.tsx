// src/components/ScheduleSeancesForDossierModal.tsx
import { useEffect, useMemo, useState } from 'react';
import { supabase, DossierSoin, UserBase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { X, Clock, Calendar, Copy, Plus, Trash2 } from 'lucide-react';

type Row = {
  date: string;
  hour: string;   // "HH"
  minute: string; // "MM"
  duree?: string; // minutes (string pour input)
};

/* ---------- Helpers TZ Africa/Tunis ---------- */
function pad2(n: number | string) {
  return String(n).padStart(2, '0');
}
function keyFrom(d: string, hh: string, mm: string) {
  return `${d}T${pad2(hh)}:${pad2(mm)}:00`;
}
function parseKey(k: string) {
  return new Date(k);
}
function addMinutesToHHMM(hhmm: string, plus: number) {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x || '0', 10));
  const d = new Date(2000, 0, 1, h, m, 0);
  d.setMinutes(d.getMinutes() + plus);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtKey(d: string, hh: string, mm: string) {
  return `${d} ${pad2(hh)}:${pad2(mm)}`;
}
function labelFromKey(key: string) {
  return key.replace('T', ' ').slice(0, 16);
}
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
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  const yyyy = get('year'), mm = get('month'), dd = get('day');
  const hh = get('hour'), mi = get('minute');
  return {
    todayISO: `${yyyy}-${mm}-${dd}`,
    nowHH: hh,
    nowMM: mi,
    nowKey: `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`,
  };
}

export default function ScheduleSeancesForDossierModal({
  dossier,
  onClose,
  onSuccess,
}: {
  dossier: DossierSoin;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';

  const [prestataires, setPrestataires] = useState<UserBase[]>([]);
  const [selectedPrestataire, setSelectedPrestataire] = useState<string>(user?.id || '');

  // Stats
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [maxNumero, setMaxNumero] = useState<number>(0);
  const totalPrevues = dossier.nombre_seances ?? 0;
  const remaining = Math.max(0, totalPrevues - currentCount);

  // Bornes (réalisée/programmée)
  const [lastRealDate, setLastRealDate] = useState<string | null>(null);     // YYYY-MM-DD
  const [lastScheduledKey, setLastScheduledKey] = useState<string | null>(null); // YYYY-MM-DDTHH:MM:00

  // Maintenant (TZ Tunis)
  const { todayISO, nowHH, nowMM, nowKey } = useMemo(() => nowInTunis(), []);
  const hoursOptions = useMemo(
    () => Array.from({ length: 13 }, (_, i) => pad2(8 + i)), // 08..20
    []
  );

  // minDate = max(todayTN, lastRealDate, date(lastScheduled))
  const minDate = useMemo(() => {
    const lastScheduledDate = lastScheduledKey ? lastScheduledKey.slice(0, 10) : null;
    const lr = lastRealDate ? String(lastRealDate).slice(0, 10) : null;
    const candidates = [todayISO, lr, lastScheduledDate].filter(Boolean) as string[];
    return candidates.length ? candidates.sort().at(-1)! : todayISO;
  }, [todayISO, lastRealDate, lastScheduledKey]);

  // Lignes (1ère obligatoire)
  const [rows, setRows] = useState<Row[]>([{ date: todayISO, hour: '08', minute: '00', duree: '' }]);

  // Copie
  const [copyEnabled, setCopyEnabled] = useState(false);
  const [countToSchedule, setCountToSchedule] = useState<number>(1);
  const [stepDays, setStepDays] = useState<number>(7);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');

  // ---- Chargement prestataires + agrégats dossier ----
  useEffect(() => {
    (async () => {
      if (isAdmin) {
        const { data } = await supabase
          .from('users_base')
          .select('id, nom, prenom, client_id')
          .eq('client_id', userBase?.client_id)
          .order('nom');
        setPrestataires((data || []) as UserBase[]);
      }

      const { data: agg } = await supabase
        .from('seances')
        .select('numero_seance, etat_seance, date_seance, heure_seance')
        .eq('dossier_id', dossier.id);

      const nums = (agg || [])
        .map((s: any) => s.numero_seance as number)
        .filter((n) => Number.isFinite(n));
      setCurrentCount(nums.length);
      setMaxNumero(nums.length > 0 ? Math.max(...nums) : 0);

      // dernière RÉALISÉE (date seule)
      const realDates = (agg || [])
        .filter((s: any) => s.etat_seance === 'réalisée' || s.etat_seance === 'realisee')
        .map((s: any) => String(s.date_seance).slice(0, 10))
        .filter(Boolean)
        .sort(); // asc
      setLastRealDate(realDates.length ? realDates.at(-1)! : null);

      // dernière PROGRAMMÉE (clé complète)
      const lastProg = (agg || [])
        .filter((s: any) => s.etat_seance === 'programmée' || s.etat_seance === 'programmee')
        .sort((a: any, b: any) => {
          const ka = `${a.date_seance}T${(a.heure_seance ? String(a.heure_seance).slice(0, 5) : '00:00')}:00`;
          const kb = `${b.date_seance}T${(b.heure_seance ? String(b.heure_seance).slice(0, 5) : '00:00')}:00`;
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        })
        .pop();
      setLastScheduledKey(
        lastProg
          ? `${lastProg.date_seance}T${
              lastProg.heure_seance ? String(lastProg.heure_seance).slice(0, 5) : '00:00'
            }:00`
          : null
      );
    })();
  }, [dossier.id, isAdmin, userBase?.client_id]);

  // Quand on active la copie, initialiser “Nombre de séances” au restant
  useEffect(() => {
    if (copyEnabled) {
      setCountToSchedule(Math.max(1, remaining));
    }
  }, [copyEnabled, remaining]);

  /* ---------- Bornes par ligne ---------- */
  // min date par ligne = max(minDate, date de la ligne précédente)
  const getRowMinDate = (i: number) => {
    if (i === 0) return minDate;
    const prevDate = rows[i - 1]?.date || minDate;
    return prevDate > minDate ? prevDate : minDate;
  };

  // min HH:MM pour la ligne i selon la date saisie (TZ Tunis)
  const getRowMinHHMM = (i: number, date: string): string | null => {
    let base: string | null = null;

    // 1) borne "aujourd'hui (Tunis)" (≥ heure actuelle)
    if (date === todayISO) {
      base = `${nowHH}:${nowMM}`;
    }

    // 2) si i === 0 -> borne "strictement après la dernière programmée (si même jour)"
    if (i === 0 && lastScheduledKey && date === lastScheduledKey.slice(0, 10)) {
      const lastHHMM = lastScheduledKey.slice(11, 16);
      const plus1 = addMinutesToHHMM(lastHHMM, 1); // strictement après
      base = base ? (plus1 > base ? plus1 : base) : plus1;
    }

    // 3) si i > 0 -> borne "strictement après la ligne précédente (si même jour)"
    if (i > 0) {
      const prev = rows[i - 1];
      if (prev && date === prev.date) {
        const prevHHMM = `${pad2(prev.hour)}:${pad2(prev.minute)}`;
        const plus1 = addMinutesToHHMM(prevHHMM, 1);
        base = base ? (plus1 > base ? plus1 : base) : plus1;
      }
    }

    return base; // peut être null => pas de contrainte horaire (autre que validation générale)
  };

  // Auto-clamp si les contraintes changent
  useEffect(() => {
    setRows((prev) =>
      prev.map((r, i) => {
        const minD = getRowMinDate(i);
        let newDate = r.date < minD ? minD : r.date;
        const minHHMM = getRowMinHHMM(i, newDate);
        if (minHHMM) {
          const [minH, minM] = minHHMM.split(':');
          const curKey = keyFrom(newDate, r.hour, r.minute);
          const minKey = keyFrom(newDate, minH, minM);
          if (parseKey(curKey) < parseKey(minKey)) {
            return { ...r, date: newDate, hour: minH, minute: minM };
          }
        }
        return { ...r, date: newDate };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDate, lastScheduledKey, todayISO, nowHH, nowMM]);

  // Génération des lignes en mode "copie"
  useEffect(() => {
    if (!copyEnabled) return;
    if (remaining <= 0) return;

    const base = rows[0];
    if (!base?.date) return;

    const maxCopies = Math.max(0, remaining - 1);
    const copies = Math.max(0, Math.min(countToSchedule - 1, maxCopies));

    // 1ère ligne: clamp date & hh:mm à leurs bornes
    const firstMinD = getRowMinDate(0);
    const firstDate = base.date < firstMinD ? firstMinD : base.date;
    const minHHMM0 = getRowMinHHMM(0, firstDate);
    let firstHour = base.hour || '08';
    let firstMinute = (base.minute || '00').padStart(2, '0').slice(0, 2);
    if (minHHMM0) {
      const [mh, mm] = minHHMM0.split(':');
      const curKey = keyFrom(firstDate, firstHour, firstMinute);
      const minKey = keyFrom(firstDate, mh, mm);
      if (parseKey(curKey) < parseKey(minKey)) {
        firstHour = mh;
        firstMinute = mm;
      }
    }

    const gen: Row[] = [{ date: firstDate, hour: firstHour, minute: firstMinute, duree: base.duree ?? '' }];

    // Copies: strictement après la précédente (même HH:MM, dates espacées de stepDays)
    let last = gen[0];
    let lastDateObj = new Date(gen[0].date);
    for (let i = 0; i < copies; i++) {
      const d = new Date(lastDateObj);
      d.setDate(d.getDate() + stepDays);
      const dStr = d.toISOString().split('T')[0];
      const idx = i + 1;
      const minD = getRowMinDate(idx);
      const useDate = dStr < minD ? minD : dStr;

      const minHHMM = getRowMinHHMM(idx, useDate);
      let hh = last.hour;
      let mm = last.minute;
      if (minHHMM) {
        const [mh, mmn] = minHHMM.split(':');
        const curKey = keyFrom(useDate, hh, mm);
        const minKey = keyFrom(useDate, mh, mmn);
        if (parseKey(curKey) < parseKey(minKey)) {
          hh = mh;
          mm = mmn;
        }
      }
      const row: Row = { date: useDate, hour: hh, minute: mm, duree: base.duree ?? '' };
      gen.push(row);
      last = row;
      lastDateObj = new Date(useDate);
    }

    setRows(gen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyEnabled, countToSchedule, stepDays, minDate, lastScheduledKey, todayISO, nowHH, nowMM]);

  /* ---------- Utils édition lignes ---------- */
  const canSchedule =
    (dossier.etat === 'en_cours' || dossier.etat === 'a_venir') &&
    totalPrevues > 0 &&
    remaining > 0;

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => {
      const next = prev.map((r, i) => (i === idx ? { ...r, ...patch } : r));

      // Après modification, re-clamp la ligne concernée
      const r = next[idx];
      const minD = getRowMinDate(idx);
      const dateClamped = r.date < minD ? minD : r.date;
      const minHHMM = getRowMinHHMM(idx, dateClamped);
      if (minHHMM) {
        const [mh, mm] = minHHMM.split(':');
        const curKey = keyFrom(dateClamped, r.hour, r.minute);
        const minKey = keyFrom(dateClamped, mh, mm);
        if (parseKey(curKey) < parseKey(minKey)) {
          next[idx] = { ...r, date: dateClamped, hour: mh, minute: mm };
        } else {
          next[idx] = { ...r, date: dateClamped };
        }
      } else {
        next[idx] = { ...r, date: dateClamped };
      }
      return next;
    });
  };

  const addRow = () => {
    if (rows.length >= remaining) return;
    const idx = rows.length;
    const d = getRowMinDate(idx);
    const minHHMM = getRowMinHHMM(idx, d);
    const [defH, defM] = (minHHMM ?? '08:00').split(':');
    setRows((prev) => [...prev, { date: d, hour: defH, minute: defM, duree: prev[0]?.duree ?? '' }]);
  };

  const removeRow = (idx: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  /* ---------- Validation ---------- */
  const validate = (): string | null => {
    if (!canSchedule) return "Le dossier doit être 'en_cours' et avoir des séances restantes.";

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const seanceNum = maxNumero + 1 + i;
      const prevNum = seanceNum - 1;

      if (!r.date) return `La date de la séance ${seanceNum} est obligatoire.`;
      if (!/^\d{2}$/.test(r.hour || '')) return `L’heure (HH) de la séance ${seanceNum} est invalide.`;
      const mm = (r.minute || '').padStart(2, '0').slice(0, 2);
      const mmNum = Number(mm);
      if (isNaN(mmNum) || mmNum < 0 || mmNum > 59)
        return `Les minutes (0–59) de la séance ${seanceNum} sont invalides.`;
      if (r.duree && Number(r.duree) < 0)
        return `La durée de la séance ${seanceNum} doit être ≥ 0.`;

      const hh = (r.hour || '08').slice(0, 2);
      const curKey = keyFrom(r.date, hh, mm);
      const labelCur = fmtKey(r.date, hh, mm);

      // min date (affiche 00:00)
      const minD = getRowMinDate(i);
      if (r.date < minD) {
        return `La date/heure de la séance ${seanceNum} (${labelCur}) est antérieure au minimum autorisé (${minD} 00:00).`;
      }

      // Aujourd’hui (TZ Tunis) >= heure actuelle
      if (r.date === todayISO && parseKey(curKey) < parseKey(nowKey)) {
        return `L’horaire de la séance ${seanceNum} (${labelCur}) doit être ≥ l’heure actuelle (${nowHH}:${nowMM}).`;
      }

      // Strictement après la précédente (dans le lot en saisie)
      if (i > 0) {
        const p = rows[i - 1];
        const pKey = keyFrom(p.date, p.hour, p.minute);
        const pLabel = fmtKey(p.date, p.hour, p.minute);
        if (!(parseKey(curKey) > parseKey(pKey))) {
          return `L’horaire de la séance ${seanceNum} (${labelCur}) doit être strictement après la séance ${prevNum} (${pLabel}).`;
        }
      }

      // Première > dernière programmée existante
      if (i === 0 && lastScheduledKey && !(parseKey(curKey) > parseKey(lastScheduledKey))) {
        return `L’horaire de la séance ${seanceNum} (${labelCur}) doit être strictement après la dernière séance programmée (${labelFromKey(lastScheduledKey)}).`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    setError('');
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    const toUse = rows.slice(0, remaining);
    const payload = toUse.map((r, i) => ({
      dossier_id: dossier.id,
      numero_seance: maxNumero + 1 + i,
      date_seance: r.date,
      heure_seance: `${pad2(r.hour)}:${pad2(r.minute)}:00`,
      etat_seance: 'programmée' as const,
      prestataire_id: isAdmin ? selectedPrestataire : user?.id,
      montant_paye: 0,
      duree_minutes: r.duree ? Number(r.duree) : null,
      note: null,
    }));

    setSaving(true);
    try {
      const { error } = await supabase.from('seances').insert(payload);
      if (error) throw error;
      onSuccess();
    } catch (e: any) {
      setError(e?.message || "Impossible d'enregistrer la programmation.");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- UI ---------- */
  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel : plein écran sur mobile, boîte centrée sur desktop */}
      <div className="absolute inset-0 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-3xl md:w-[90vw]">
        <div className="relative h-full md:h-auto bg-white rounded-none md:rounded-xl shadow-xl flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between p-4 md:p-6 border-b">
            <div className="pr-6">
              <h3 className="text-base md:text-lg font-semibold">Programmer des séances</h3>
              <p className="mt-1 text-xs md:text-sm text-gray-600">
                Dossier : <span className="font-medium">{dossier.motif}</span> — état : <span className="font-medium">{dossier.etat}</span>
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded hover:bg-gray-100" title="Fermer">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Contenu scrollable */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-5">
            {/* Bandeau infos */}
            <div className="bg-gray-50 rounded-lg p-3 text-xs md:text-sm grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <span>Séance suivante : <span className="font-medium">{maxNumero + 1}</span></span>
              <span>Prévues : <span className="font-medium">{totalPrevues}</span></span>
              <span>Créées : <span className="font-medium">{currentCount}</span></span>
              <span>Restantes : <span className="font-medium">{remaining}</span></span>
              <span>Date min : <span className="font-medium">{minDate}</span></span>
            </div>

            {!canSchedule && (
              <div className="text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded px-3 py-2">
                Le dossier doit être <b>en_cours</b> avec des séances restantes pour pouvoir programmer.
              </div>
            )}

            {/* Prestataire (admin) */}
            {isAdmin && (
              <div>
                <label className="block text-sm text-gray-700 mb-1">Prestataire</label>
                <select
                  value={selectedPrestataire}
                  onChange={(e) => setSelectedPrestataire(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                >
                  {prestataires.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.prenom} {u.nom}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Première séance (obligatoire) */}
            <div className="border rounded-lg p-3">
              <p className="font-medium mb-3 flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4" /> Première séance (obligatoire)
              </p>
              <RowEditor
                index={0}
                numero={maxNumero + 1}
                row={rows[0]}
                onChange={(patch) => updateRow(0, patch)}
                hoursOptions={hoursOptions}
                minDate={getRowMinDate(0)}
                minHHMM={getRowMinHHMM(0, rows[0].date)}
                canRemove={false}
              />
            </div>

            {/* Copie / Saisie manuelle — réorganisé pour éviter tout chevauchement */}
            <div className="border rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={copyEnabled}
                    onChange={(e) => setCopyEnabled(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium">Copier le même horaire pour les prochaines séances</span>
                </label>

                {copyEnabled && (
                  <span className="hidden sm:inline-flex items-center gap-2 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                    <Copy className="w-3 h-3" /> Aperçu généré ci-dessous
                  </span>
                )}
              </div>

              {copyEnabled ? (
                <>
                  {/* Ligne d’options : grille responsive sans chevauchement */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Nombre de séances (inclut la première)</label>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, remaining)}
                        value={countToSchedule}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(Number(e.target.value || 1), Math.max(1, remaining)));
                          setCountToSchedule(v);
                        }}
                        className="w-full border rounded-lg px-3 py-2"
                      />
                      <p className="text-xs text-gray-500 mt-1">Max {remaining} au total.</p>
                    </div>

                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Fréquence</label>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center rounded-lg bg-gray-100 px-2 py-2 text-xs text-gray-600 whitespace-nowrap">tous les</span>
                        <input
                          type="number"
                          min={1}
                          value={stepDays}
                          onChange={(e) => setStepDays(Math.max(1, Number(e.target.value || 1)))}
                          className="w-20 border rounded-lg px-3 py-2"
                          aria-label="Nombre de jours"
                        />
                        <span className="text-sm text-gray-700">jour(s)</span>
                      </div>
                    </div>

                    <div className="hidden lg:flex items-end">
                      <div className="text-xs text-gray-600 inline-flex items-center gap-2 px-2 py-2 bg-gray-50 rounded w-full">
                        <Clock className="w-3 h-3" />
                        Les heures/minutes sont automatiquement bornées (heure de Tunis &gt;= maintenant, et séquences strictement croissantes).
                      </div>
                    </div>
                  </div>

                  {/* APERÇU : tableau compact, lisible en mobile */}
                  <div className="mt-2">
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr className="text-gray-700">
                            <th className="px-3 py-2 text-left font-medium border-b">N°</th>
                            <th className="px-3 py-2 text-left font-medium border-b">Date</th>
                            <th className="px-3 py-2 text-left font-medium border-b">Heure</th>
                            <th className="px-3 py-2 text-left font-medium border-b">Durée</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, remaining).map((r, i) => (
                            <tr key={i} className="odd:bg-white even:bg-gray-50">
                              <td className="px-3 py-2 border-b">{maxNumero + 1 + i}</td>
                              <td className="px-3 py-2 border-b">{r.date}</td>
                              <td className="px-3 py-2 border-b">{pad2(r.hour)}:{pad2(r.minute)}</td>
                              <td className="px-3 py-2 border-b">{r.duree ? `${r.duree} min` : '—'}</td>
                            </tr>
                          ))}
                          {rows.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-3 py-3 text-center text-gray-500">Aucun créneau à afficher.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      Les créneaux sont ajustés automatiquement pour éviter tout chevauchement et respecter les bornes (heure de Tunis).
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-700">Saisissez manuellement les prochaines séances :</p>
                  {rows.slice(1).map((r, i) => {
                    const idx = i + 1;
                    return (
                      <RowEditor
                        key={idx}
                        index={idx}
                        numero={maxNumero + 1 + idx}
                        row={r}
                        onChange={(patch) => updateRow(idx, patch)}
                        hoursOptions={hoursOptions}
                        minDate={getRowMinDate(idx)}
                        minHHMM={getRowMinHHMM(idx, r.date)}
                        onRemove={() => removeRow(idx)}
                      />
                    );
                  })}
                  <button
                    type="button"
                    onClick={addRow}
                    disabled={rows.length >= remaining}
                    className={`mt-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg w-full sm:w-auto ${
                      rows.length >= remaining
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter une séance
                  </button>
                  <p className="text-xs text-gray-500">Vous pouvez ajouter jusqu’à {remaining} séance(s) au total.</p>
                </div>
              )}
            </div>

            {error && (
              <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Barre d’actions collante (mobile friendly) */}
          <div className="sticky bottom-0 left-0 right-0 p-3 md:p-4 border-t bg-white [padding-bottom:env(safe-area-inset-bottom)]">
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 border rounded-lg w-full sm:w-auto"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !canSchedule}
                className={`px-4 py-2 rounded-lg text-white w-full sm:w-auto ${
                  saving || !canSchedule ? 'bg-gray-300' : 'bg-teal-600 hover:bg-teal-700'
                }`}
              >
                {saving ? 'Enregistrement…' : 'Programmer'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- RowEditor : optimisé mobile (grille compacte, champs larges) ---------- */
function RowEditor({
  index,
  numero,
  row,
  onChange,
  hoursOptions,
  minDate,
  minHHMM,
  onRemove,
  canRemove = true,
}: {
  index: number;
  numero: number;
  row: Row;
  onChange: (patch: Partial<Row>) => void;
  hoursOptions: string[];
  minDate: string;
  minHHMM: string | null; // "HH:MM" si borne horaire ce jour
  onRemove?: () => void;
  canRemove?: boolean;
}) {
  // auto-clamp minutes si heure = minHH
  useEffect(() => {
    if (!minHHMM) return;
    const [minH, minM] = minHHMM.split(':');
    if (row.hour === minH && parseInt(row.minute || '0', 10) < parseInt(minM, 10)) {
      onChange({ minute: minM });
    }
    if (parseInt(row.hour || '0', 10) < parseInt(minH, 10)) {
      onChange({ hour: minH, minute: minM });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minHHMM, row.date]);

  const onMinuteChange = (v: string) => {
    const clean2 = v.replace(/[^\d]/g, '').slice(0, 2);
    let n = Number(clean2 || '0');
    if (isNaN(n)) n = 0;
    if (n > 59) n = 59;
    if (minHHMM) {
      const [minH, minM] = minHHMM.split(':');
      if (row.hour === minH) {
        n = Math.max(parseInt(minM, 10), n);
      }
    }
    onChange({ minute: pad2(n) });
  };

  const onHourChange = (v: string) => {
    if (minHHMM) {
      const [minH, minM] = minHHMM.split(':');
      if (parseInt(v, 10) < parseInt(minH, 10)) {
        onChange({ hour: minH, minute: minM });
        return;
      }
      if (v === minH && parseInt(row.minute || '0', 10) < parseInt(minM, 10)) {
        onChange({ hour: v, minute: minM });
        return;
      }
    }
    onChange({ hour: v });
  };

  return (
    <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-8 gap-3 items-end">
      {/* Date */}
      <div className="sm:col-span-3">
        <label className="block text-sm text-gray-700 mb-1">Date</label>
        <input
          type="date"
          value={row.date}
          min={minDate}
          onChange={(e) => onChange({ date: e.target.value })}
          className="w-full border rounded-lg px-3 py-2"
        />
        {minHHMM && (
          <p className="text-xs text-gray-600 mt-1">
            Pour ce jour, l’horaire doit être &ge; {minHHMM}.
          </p>
        )}
      </div>

      {/* Heure */}
      <div className="sm:col-span-1">
        <label className="block text-sm text-gray-700 mb-1">Heure</label>
        <select
          value={row.hour}
          onChange={(e) => onHourChange(e.target.value)}
          className="w-full border rounded-lg px-2 py-2 bg-white"
          title="Heure (HH)"
        >
          {hoursOptions.map((h) => {
            const disabled = !!minHHMM && parseInt(h, 10) < parseInt(minHHMM.split(':')[0], 10);
            return (
              <option key={h} value={h} disabled={disabled}>
                {h}
              </option>
            );
          })}
        </select>
      </div>

      {/* Minutes */}
      <div className="sm:col-span-1">
        <label className="block text-sm text-gray-700 mb-1">Minutes</label>
        <input
          type="text"
          inputMode="numeric"
          value={row.minute}
          onChange={(e) => onMinuteChange(e.target.value)}
          placeholder="MM"
          className="w-full border rounded-lg px-2 py-2"
          title="Minutes (0–59)"
        />
      </div>

      {/* Icône */}
      <div className="hidden sm:flex sm:col-span-1 items-end gap-2">
        <Clock className="w-4 h-4 text-gray-400 mb-2" />
      </div>

      {/* Durée */}
      <div className="sm:col-span-1">
        <label className="block text-sm text-gray-700 mb-1">Durée (min)</label>
        <input
          type="text"
          inputMode="numeric"
          value={row.duree ?? ''}
          onChange={(e) => onChange({ duree: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })}
          placeholder="ex: 45"
          className="w-full border rounded-lg px-3 py-2"
        />
      </div>

      {/* Supprimer */}
      <div className="sm:col-span-1 flex items-end">
        {canRemove && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border hover:bg-gray-50 w-full sm:w-auto"
            title={`Supprimer la séance ${numero}`}
          >
            <Trash2 className="w-4 h-4" />
            <span className="whitespace-nowrap">Supprimer</span>
          </button>
        )}
      </div>
    </div>
  );
}
