// src/components/EditScheduledSeanceModal.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase, Seance, UserBase } from "../lib/supabase";
import { X, Trash2, AlertTriangle } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

/* ----------------- Helpers ----------------- */
function nowInTZ(tz: string) {
  const parts = new Intl.DateTimeFormat("fr-TN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const hh = get("hour");
  const mi = get("minute");

  const dateStr = `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD
  const hhmm = `${hh}:${mi}`;            // HH:MM
  return { dateStr, hhmm, hour: Number(hh), minute: Number(mi) };
}

function cmpKeys(a: string, b: string) {
  return new Date(a).getTime() - new Date(b).getTime();
}

type Props = {
  seance: Seance;      // programmée à éditer
  dossierId: string;   // dossier de la séance
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditScheduledSeanceModal({
  seance,
  dossierId,
  onClose,
  onSuccess,
}: Props) {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === "admin";

  // === Maintenant en heure de Tunis
  const {
    dateStr: todayTunis,
    hhmm: nowHHMM_Tunis,
    hour: curH_Tunis,
    minute: curM_Tunis,
  } = useMemo(() => nowInTZ("Africa/Tunis"), []);

  const nowKeyTunis = `${todayTunis}T${nowHHMM_Tunis}:00`;

  // === Champs (init à la séance)
  const initHour = String(seance.heure_seance || "08:00").slice(0, 2);
  const initMinute = String(seance.heure_seance || "08:00").slice(3, 5);

  const [date, setDate] = useState<string>(
    String(seance.date_seance).slice(0, 10) || todayTunis
  );
  const [hour, setHour] = useState<string>(initHour);
  const [minute, setMinute] = useState<string>(initMinute);
  const [duree, setDuree] = useState<string>(
    seance.duree_minutes != null ? String(seance.duree_minutes) : ""
  );
  const [prestataireId, setPrestataireId] = useState<string>(
    seance.prestataire_id || ""
  );
  const [note, setNote] = useState<string>(seance.note || "");

  const [prestataires, setPrestataires] = useState<UserBase[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>("");

  // Confirmation de suppression (UI)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  // Heures 08 → 20
  const hoursOptions = useMemo(
    () => Array.from({ length: 13 }, (_, i) => String(8 + i).padStart(2, "0")),
    []
  );

  // === Borne min de DATE : max(aujourd’hui_Tunis, dernière RÉALISÉE du dossier)
  const [minDate, setMinDate] = useState<string>(todayTunis);
  useEffect(() => {
    (async () => {
      try {
        const { data: last } = await supabase
          .from("seances")
          .select("date_seance")
          .eq("dossier_id", dossierId)
          .in("etat_seance", ["réalisée", "realisee"])
          .order("date_seance", { ascending: false })
          .limit(1);

        const lastReal =
          last && last.length > 0 ? String(last[0].date_seance).slice(0, 10) : "";
        const min = lastReal && lastReal > todayTunis ? lastReal : todayTunis;
        setMinDate(min);
        setDate((prev) => (prev < min ? min : prev));
      } catch {
        setMinDate(todayTunis);
        setDate((prev) => (prev < todayTunis ? todayTunis : prev));
      }
    })();
  }, [dossierId, todayTunis]);

  // === Bornes chrono avec autres PROGRAMMÉES (précédente / suivante)
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const num = seance.numero_seance!;
      const { data } = await supabase
        .from("seances")
        .select("numero_seance, date_seance, heure_seance, etat_seance")
        .eq("dossier_id", dossierId)
        .in("etat_seance", ["programmée", "programmee"])
        .order("numero_seance", { ascending: true });

      const prog = (data || []) as Seance[];
      const prev = prog.find((s) => s.numero_seance === num - 1);
      const next = prog.find((s) => s.numero_seance === num + 1);

      const toKey = (d?: string | null, t?: string | null) =>
        `${String(d || "").slice(0, 10)}T${
          t ? String(t).slice(0, 5) : "00:00"
        }:00`;

      setPrevKey(prev ? toKey(prev.date_seance, prev.heure_seance) : null);
      setNextKey(next ? toKey(next.date_seance, next.heure_seance) : null);
    })();
  }, [dossierId, seance.numero_seance]);

  // === max date si prochaine existe
  const maxDate = useMemo(() => {
    if (!nextKey) return undefined;
    // On interdit >= nextKey, donc date max = jour avant la prochaine, ou même jour si heure/ minute < next
    // Le contrôle fin se fera sur HH/MM, ici on borne juste l’input date à <= date(nextKey)
    return nextKey.slice(0, 10);
  }, [nextKey]);

  // === Validations calculées
  const chosenKey = `${date}T${(hour || "08").slice(0, 2)}:${(minute || "00")
    .padStart(2, "0")
    .slice(0, 2)}:00`;
  const isTodayTN = date === todayTunis;
  const isTodayPast = isTodayTN && cmpKeys(chosenKey, nowKeyTunis) < 0;

  const violatesPrev = prevKey ? cmpKeys(chosenKey, prevKey) <= 0 : false;
  const violatesNext = nextKey ? cmpKeys(chosenKey, nextKey) >= 0 : false;

  // minutes valides
  const minuteValid = (() => {
    const m = Number((minute || "").replace(/[^\d]/g, ""));
    return Number.isFinite(m) && m >= 0 && m <= 59;
  })();

  // === Désactivation heures/minutes vs prochaine
  const nextDay = nextKey ? nextKey.slice(0, 10) : null;
  const nextHH = nextKey ? nextKey.slice(11, 13) : null;
  const nextMM = nextKey ? nextKey.slice(14, 16) : null;

  const hourDisabled = (h: string) => {
    // ⛔ heures passées si aujourd’hui
    if (isTodayTN && Number(h) < curH_Tunis) return true;

    // ⛔ si même jour que next -> désactiver heures >= nextHH
    if (nextKey && date === nextDay && nextHH) {
      if (Number(h) >= Number(nextHH)) return true;
    }
    return false;
  };

  const clampMinuteOnSameHourAsNow = (hh: string, mm: string) => {
    if (isTodayTN && Number(hh) === curH_Tunis) {
      const mmNum = Math.max(curM_Tunis, Number(mm || "0"));
      return String(mmNum).padStart(2, "0");
    }
    return (mm || "00").padStart(2, "0").slice(0, 2);
  };

  const clampMinuteVsNextIfNeeded = (hh: string, mm: string) => {
    if (nextKey && date === nextDay && nextHH && Number(hh) === Number(nextHH)) {
      // même heure que la prochaine → minutes < nextMM
      const safe = Math.min(Number(mm || "0"), Math.max(0, Number(nextMM) - 1));
      return String(safe).padStart(2, "0");
    }
    return mm;
  };

  const canSave =
    date >= minDate &&
    (!maxDate || date <= maxDate) &&
    !isTodayPast &&
    !violatesPrev &&
    !violatesNext &&
    minuteValid;

  // === Charger prestataires si admin
  useEffect(() => {
    (async () => {
      if (isAdmin) {
        const { data } = await supabase
          .from("users_base")
          .select("id, nom, prenom")
          .order("nom");
        setPrestataires((data || []) as UserBase[]);
      }
    })();
  }, [isAdmin]);

  // === Handlers avec clamps
  const onChangeDate = (v: string) => {
    const minFixed = v < minDate ? minDate : v;
    const withMax = maxDate && minFixed > maxDate ? maxDate : minFixed;
    setDate(withMax);

    // Si aujourd’hui, remonter HH/MM mini courants
    if (withMax === todayTunis) {
      const hNum = Number(hour || "0");
      if (hNum < curH_Tunis) setHour(String(curH_Tunis).padStart(2, "0"));
      if (hNum === curH_Tunis) {
        const mFix = clampMinuteOnSameHourAsNow(String(hNum).padStart(2, "0"), minute);
        setMinute(mFix);
      }
    }

    // Si même jour que la prochaine, désactiver heures >= next et ajuster minute si même heure
    if (nextKey && withMax === nextDay) {
      const hh = String(hour || "08").slice(0, 2);
      if (nextHH && Number(hh) >= Number(nextHH)) {
        // force à heure avant next
        const back = Math.max(8, Number(nextHH) - 1);
        setHour(String(back).padStart(2, "0"));
        setMinute("00");
      } else if (nextHH && Number(hh) === Number(nextHH)) {
        const mm = clampMinuteVsNextIfNeeded(hh, minute);
        setMinute(mm);
      }
    }
  };

  const onChangeHour = (v: string) => {
    const h = v.slice(0, 2);

    // ⛔ heures passées aujourd’hui
    if (isTodayTN && Number(h) < curH_Tunis) {
      const hh = String(curH_Tunis).padStart(2, "0");
      setHour(hh);
      setMinute(clampMinuteOnSameHourAsNow(hh, minute));
      return;
    }

    // ⛔ si même jour que prochaine : interdit >= nextHH
    if (nextKey && date === nextDay && nextHH && Number(h) >= Number(nextHH)) {
      const hh = String(Math.max(8, Number(nextHH) - 1)).padStart(2, "0");
      setHour(hh);
      setMinute("00");
      return;
    }

    setHour(h);

    // clamps minutes vs now / vs next
    let mm = clampMinuteOnSameHourAsNow(h, minute);
    mm = clampMinuteVsNextIfNeeded(h, mm);
    setMinute(mm);
  };

  const onChangeMinute = (v: string) => {
    const clean = v.replace(/[^\d]/g, "").slice(0, 2);
    let mm = clean;

    // clamp vs now
    if (isTodayTN && Number(hour) === curH_Tunis) {
      const mmNow = Math.max(curM_Tunis, Number(clean || "0"));
      mm = String(mmNow).padStart(2, "0");
    }

    // clamp vs next si même heure
    if (nextKey && date === nextDay && nextHH && Number(hour) === Number(nextHH)) {
      const cap = Math.max(0, Number(nextMM) - 1);
      mm = String(Math.min(Number(mm || "0"), cap)).padStart(2, "0");
    }

    setMinute(mm);
  };

  // === Actions
  const handleSave = async () => {
    setErr("");
    if (!canSave) return;
    setSaving(true);
    try {
      const dureeNum = duree === "" ? null : Number(duree);
      const { error } = await supabase
        .from("seances")
        .update({
          date_seance: date,
          heure_seance: `${(hour || "08").slice(0, 2)}:${(minute || "00")
            .padStart(2, "0")
            .slice(0, 2)}:00`,
          duree_minutes: dureeNum,
          prestataire_id: prestataireId || null,
          note: note || null,
        })
        .eq("id", seance.id)
        .eq("etat_seance", "programmée"); // sécurité : ne modifier que si encore programmée
      if (error) throw error;
      onSuccess();
    } catch (e: any) {
      setErr(e?.message || "Impossible de modifier la séance.");
      setSaving(false);
    }
  };

  // Suppression + réindexation (appelée après confirmation)
  const reallyDelete = async () => {
    setErr("");
    setSaving(true);
    try {
      // 1) supprimer uniquement si programmée
      const { error: delErr } = await supabase
        .from("seances")
        .delete()
        .eq("id", seance.id)
        .eq("etat_seance", "programmée");
      if (delErr) throw delErr;

      // 2) réindexer les autres PROGRAMMÉES > numero supprimé
      const num = seance.numero_seance!;
      const { data: toShift, error: selErr } = await supabase
        .from("seances")
        .select("id, numero_seance")
        .eq("dossier_id", dossierId)
        .in("etat_seance", ["programmée", "programmee"])
        .gt("numero_seance", num)
        .order("numero_seance", { ascending: true });
      if (selErr) throw selErr;

      for (const s of (toShift || []) as any[]) {
        const { error: upErr } = await supabase
          .from("seances")
          .update({ numero_seance: (s.numero_seance as number) - 1 })
          .eq("id", s.id);
        if (upErr) throw upErr;
      }

      onSuccess();
    } catch (e: any) {
      setErr(e?.message || "Suppression / réindexation impossible.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            Modifier la séance programmée numéro {seance.numero_seance}
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" title="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bloc info bornes */}
        <div className="text-xs space-y-1 bg-gray-50 rounded-lg p-3">
          <div className={date === todayTunis ? "text-gray-700" : "text-gray-600"}>
            Aujourd’hui (Tunis), l’horaire doit être ≥ {nowHHMM_Tunis}.
          </div>
          {prevKey && (
            <div className={violatesPrev ? "text-red-600" : "text-gray-600"}>
              Doit être &gt; {prevKey.replace("T", " ").slice(0, 16)} (programmée précédente).
            </div>
          )}
          {nextKey && (
            <div className={violatesNext ? "text-red-600" : "text-gray-600"}>
              Doit être &lt; {nextKey.replace("T", " ").slice(0, 16)} (programmée suivante).
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Date */}
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Date *</label>
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}   // ⛔ pas au-delà de la prochaine (même jour autorisé, les heures/minutes gèrent le strict <)
              onChange={(e) => onChangeDate(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
            <p className="text-xs text-gray-500 mt-1">
              Jour autorisé ≥ {minDate.split("-").reverse().join("/")}
              {maxDate ? ` et ≤ ${maxDate.split("-").reverse().join("/")}` : ""}
            </p>
          </div>

          {/* Heure */}
          <div>
            <label className="block text-sm text-gray-700 mb-1">Heure *</label>
            <select
              value={hour}
              onChange={(e) => onChangeHour(e.target.value)}
              className="w-full border rounded px-2 py-2 bg-white"
              title="Heure (HH)"
            >
              {hoursOptions.map((h) => (
                <option key={h} value={h} disabled={hourDisabled(h)}>
                  {h}
                </option>
              ))}
            </select>
          </div>

          {/* Minutes */}
          <div className="sm:col-span-1">
            <label className="block text-sm text-gray-700 mb-1">Minutes *</label>
            <input
              value={minute}
              onChange={(e) => onChangeMinute(e.target.value)}
              className={`w-full border rounded px-2 py-2 ${
                minuteValid ? "" : "border-red-300"
              }`}
              placeholder="MM"
              inputMode="numeric"
              title={
                isTodayTN && Number(hour) === curH_Tunis
                  ? `≥ ${String(curM_Tunis).padStart(2, "0")}`
                  : nextKey && date === nextDay && Number(hour) === Number(nextHH)
                  ? `< ${String(nextMM).padStart(2, "0")}`
                  : "0–59"
              }
            />
          </div>
        </div>

        {/* Durée */}
        <div>
          <label className="block text-sm text-gray-700 mb-1">Durée (min)</label>
          <input
            value={duree}
            onChange={(e) => setDuree(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
            placeholder="ex: 45"
            className="w-full border rounded px-3 py-2"
            inputMode="numeric"
          />
        </div>

        {/* Prestataire (admin) */}
        {isAdmin ? (
          <div>
            <label className="block text-sm text-gray-700 mb-1">Prestataire</label>
            <select
              value={prestataireId || ""}
              onChange={(e) => setPrestataireId(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white"
            >
              {prestataires.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.prenom} {u.nom}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Note */}
        <div>
          <label className="block text-sm text-gray-700 mb-1">Note</label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ajouter une note (optionnel)…"
            className="w-full border rounded px-3 py-2"
          />
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            {err}
          </div>
        )}

        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowConfirmDelete(true)}
            disabled={saving}
            className="px-4 py-2 inline-flex items-center gap-2 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
            title="Supprimer cette séance programmée"
          >
            <Trash2 className="w-4 h-4" /> Supprimer
          </button>

          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border rounded">
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>

      {/* --- MODAL CONFIRMATION SUPPRESSION --- */}
      {showConfirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowConfirmDelete(false)} />
          <div className="relative bg-white w-full max-w-md rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 text-red-700">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-gray-900">
                Confirmer la suppression
              </h4>
            </div>
            <p className="text-sm text-gray-700">
              Vous êtes sur le point de supprimer la <b>séance programmée numéro {seance.numero_seance}</b>.
              Cette action <b>réindexera automatiquement</b> les numéros des séances programmées
              suivantes du même dossier.
            </p>
            <p className="text-sm text-gray-700">
              Voulez-vous continuer ?
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="px-4 py-2 border rounded"
              >
                Annuler
              </button>
              <button
                onClick={reallyDelete}
                disabled={saving}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
              >
                {saving ? "Suppression…" : "Oui, supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
