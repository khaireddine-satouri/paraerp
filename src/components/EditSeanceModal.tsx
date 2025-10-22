// src/components/EditSeanceModal.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase, Seance, UserBase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { X, Trash2, AlertTriangle } from "lucide-react";

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
function toKey(dateISO?: string | null, time?: string | null) {
  if (!dateISO) return null;
  const hhmm = time ? String(time).slice(0, 5) : "00:00";
  return `${dateISO}T${hhmm}:00`;
}
function cmpKeys(a: string, b: string) {
  return new Date(a).getTime() - new Date(b).getTime();
}

type Props = {
  seance: Seance;       // séance RÉALISÉE à éditer
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditSeanceModal({ seance, onClose, onSuccess }: Props) {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === "admin";

  // Maintenant (Africa/Tunis)
  const { dateStr: todayTN, hhmm: nowHHMM_TN, hour: curH_TN, minute: curM_TN } = useMemo(
    () => nowInTZ("Africa/Tunis"),
    []
  );
  const nowKeyTN = `${todayTN}T${nowHHMM_TN}:00`;

  // Champs
  const [date, setDate] = useState<string>(String(seance.date_seance).slice(0, 10) || todayTN);
  const [hour, setHour] = useState<string>(String(seance.heure_seance || "08:00").slice(0, 2));
  const [minute, setMinute] = useState<string>(String(seance.heure_seance || "08:00").slice(3, 5));
  const [duree, setDuree] = useState<string>(
    seance.duree_minutes != null ? String(seance.duree_minutes) : ""
  );
  const [prestataireId, setPrestataireId] = useState<string>(seance.prestataire_id || "");
  // ✅ montant obligatoire : init = '' si NULL, sinon la valeur existante
  const [montantPaye, setMontantPaye] = useState<string>(
    seance.montant_paye != null ? String(seance.montant_paye) : ""
  );
  const [note, setNote] = useState<string>(seance.note || "");

  const [prestataires, setPrestataires] = useState<UserBase[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>("");

  // Confirmation suppression
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  // Heures 08 → 20
  const hoursOptions = useMemo(
    () => Array.from({ length: 13 }, (_, i) => String(8 + i).padStart(2, "0")),
    []
  );

  // Voisins RÉALISÉS (autres que la séance courante) pour garantir l’ordre strict
  const [prevRealKey, setPrevRealKey] = useState<string | null>(null);
  const [nextRealKey, setNextRealKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("seances")
          .select("id, date_seance, heure_seance, etat_seance")
          .eq("dossier_id", seance.dossier_id)
          .in("etat_seance", ["réalisée", "realisee"]);

        const others =
          (data || []).filter((s: any) => s.id !== seance.id) as Array<{
            id: string;
            date_seance: string;
            heure_seance: string | null;
          }>;

        const currentKeyOrig =
          toKey(String(seance.date_seance).slice(0, 10), seance.heure_seance ? String(seance.heure_seance).slice(0, 5) : "00:00") ||
          "";

        // Le voisin précédent = max des keys < currentKeyOrig
        const less = others
          .map((s) => toKey(String(s.date_seance).slice(0, 10), s.heure_seance ? String(s.heure_seance).slice(0, 5) : "00:00")!)
          .filter((k) => k < currentKeyOrig)
          .sort();
        setPrevRealKey(less.length ? less[less.length - 1] : null);

        // Le voisin suivant = min des keys > currentKeyOrig
        const greater = others
          .map((s) => toKey(String(s.date_seance).slice(0, 10), s.heure_seance ? String(s.heure_seance).slice(0, 5) : "00:00")!)
          .filter((k) => k > currentKeyOrig)
          .sort();
        setNextRealKey(greater.length ? greater[0] : null);
      } catch {
        setPrevRealKey(null);
        setNextRealKey(null);
      }
    })();
  }, [seance.dossier_id, seance.id, seance.date_seance, seance.heure_seance]);

  // Prestataires (admin)
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

  // Validations calculées
  const chosenKey = `${date}T${(hour || "08").slice(0, 2)}:${(minute || "00").padStart(2, "0")}:00`;
  const isTodayTN = date === todayTN;
  const isFuture = cmpKeys(chosenKey, nowKeyTN) > 0;

  const violatesPrev = prevRealKey ? cmpKeys(chosenKey, prevRealKey) <= 0 : false;
  const violatesNext = nextRealKey ? cmpKeys(chosenKey, nextRealKey) >= 0 : false;

  const minuteValid = (() => {
    const m = Number((minute || "").replace(/[^\d]/g, ""));
    return Number.isFinite(m) && m >= 0 && m <= 59;
  })();

  // ✅ Montant obligatoire (non vide, nombre >= 0)
  const montantValid = (() => {
    const v = (montantPaye ?? "").toString().trim();
    if (v === "") return false;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
  })();

  const canSave = !isFuture && minuteValid && montantValid && !violatesPrev && !violatesNext;

  /* ----------------- Handlers (clamp vers le PASSÉ uniquement) -----------------
     On autorise le passé (aujourd’hui inclus), on bloque le futur.
  -------------------------------------------------------------------------------*/
  const onChangeDate = (v: string) => {
    // ⛔ pas de jour futur
    const next = v > todayTN ? todayTN : v;
    setDate(next);

    // si la nouvelle date est aujourd’hui et que l’horaire saisi est futur -> on rabat à maintenant
    if (next === todayTN) {
      const hNum = Number(hour || "0");
      let newHour = hNum;
      let newMinute = Number(minute || "0");

      if (hNum > curH_TN) newHour = curH_TN;
      if (newHour === curH_TN && newMinute > curM_TN) newMinute = curM_TN;

      if (newHour !== hNum) setHour(String(newHour).padStart(2, "0"));
      if (newMinute !== Number(minute || "0")) setMinute(String(newMinute).padStart(2, "0"));
    }
  };

  const onChangeHour = (v: string) => {
    const h = v.slice(0, 2);
    // Aujourd’hui : ⛔ pas d’heure > maintenant
    if (isTodayTN && Number(h) > curH_TN) {
      setHour(String(curH_TN).padStart(2, "0"));
      // minutes futures → ramenées aussi
      if (Number(minute || "0") > curM_TN) setMinute(String(curM_TN).padStart(2, "0"));
      return;
    }
    setHour(h);
    // si aujourd’hui et même heure que maintenant : minutes ≤ maintenant
    if (isTodayTN && Number(h) === curH_TN && Number(minute || "0") > curM_TN) {
      setMinute(String(curM_TN).padStart(2, "0"));
    }
  };

  const onChangeMinute = (v: string) => {
    // borne 0..59
    const raw = v.replace(/[^\d]/g, "").slice(0, 2);
    let mm = Number(raw || "0");
    if (isNaN(mm)) mm = 0;
    if (mm > 59) mm = 59;

    // Aujourd’hui & même heure que maintenant : minutes ≤ maintenant
    if (isTodayTN && Number(hour) === curH_TN && mm > curM_TN) {
      mm = curM_TN;
    }
    setMinute(String(mm).padStart(2, "0"));
  };

  // Sauvegarde
  const handleSave = async () => {
    setErr("");
    if (!canSave) return;

    // ✅ validation stricte du montant
    const v = (montantPaye ?? "").toString().trim();
    const amount = Number(v);
    if (v === "" || !Number.isFinite(amount) || amount < 0) {
      setErr("Le montant payé est obligatoire et doit être ≥ 0.");
      return;
    }

    setSaving(true);
    try {
      const dureeNum = duree === "" ? null : Number(duree);
      if (duree !== "" && (isNaN(dureeNum as number) || (dureeNum as number) < 0)) {
        setErr("Durée invalide (minutes ≥ 0).");
        setSaving(false);
        return;
      }

      const { error } = await supabase
        .from("seances")
        .update({
          date_seance: date,
          heure_seance: `${(hour || "08").slice(0, 2)}:${(minute || "00").padStart(2, "0")}:00`,
          duree_minutes: dureeNum,
          prestataire_id: prestataireId || null,
          // ⛔ plus de défaut à 0
          montant_paye: amount,
          note: note || null,
          etat_seance: "réalisée", // s'assurer qu'elle reste réalisée
        })
        .eq("id", seance.id)
        .in("etat_seance", ["réalisée", "realisee"]);
      if (error) throw error;

      onSuccess();
    } catch (e: any) {
      setErr(e?.message || "Impossible d'enregistrer les modifications.");
      setSaving(false);
    }
  };

  // Suppression + réindexation (pour séances RÉALISÉES)
  const reallyDelete = async () => {
    setErr("");
    setSaving(true);
    try {
      // 1) supprimer uniquement si réalisée
      const { error: delErr } = await supabase
        .from("seances")
        .delete()
        .eq("id", seance.id)
        .in("etat_seance", ["réalisée", "realisee"]);
      if (delErr) throw delErr;

      // 2) réindexer TOUTES les séances (programmées ET réalisées) dont numero_seance > supprimée
      const num = seance.numero_seance!;
      const { data: toShift, error: selErr } = await supabase
        .from("seances")
        .select("id, numero_seance")
        .eq("dossier_id", seance.dossier_id)
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
          <h3 className="text-lg font-semibold text-gray-900">Modifier la séance réalisée</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" title="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Date / Heure / Minutes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => onChangeDate(e.target.value)}
              max={todayTN} // ⛔ pas de date future
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Heure *</label>
            <select
              value={hour}
              onChange={(e) => onChangeHour(e.target.value)}
              className="w-full border rounded px-2 py-2 bg-white"
            >
              {hoursOptions.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Minutes *</label>
            <input
              value={minute}
              onChange={(e) => onChangeMinute(e.target.value)}
              className={`w-full border rounded px-2 py-2 ${minuteValid ? "" : "border-red-300"}`}
              placeholder="MM"
              inputMode="numeric"
            />
          </div>
        </div>

        {/* Bornes / messages */}
        <div className="text-xs space-y-1">
          <div className={isFuture ? "text-red-600" : "text-gray-600"}>
            Doit être ≤ maintenant (Tunis) : {nowHHMM_TN} le {todayTN.split("-").reverse().join("/")}.
          </div>
          {prevRealKey && (
            <div className={violatesPrev ? "text-red-600" : "text-gray-600"}>
              Doit être &gt; {prevRealKey.replace("T", " ").slice(0, 16)} (réalisée précédente).
            </div>
          )}
          {nextRealKey && (
            <div className={violatesNext ? "text-red-600" : "text-gray-600"}>
              Doit être &lt; {nextRealKey.replace("T", " ").slice(0, 16)} (réalisée suivante).
            </div>
          )}
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

        {/* Prestataire */}
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
        ) : (
          <div>
            <label className="block text-sm text-gray-700 mb-1">Prestataire</label>
            <input
              type="text"
              value="Vous"
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-gray-600"
            />
          </div>
        )}

        {/* Montant payé (OBLIGATOIRE) & note */}
        <div>
          <label className="block text-sm text-gray-700 mb-1">Montant payé (DT) *</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            required
            value={montantPaye}
            onChange={(e) => setMontantPaye(e.target.value)}
            placeholder="ex: 40.00"
            className={`w-full border rounded px-3 py-2 ${montantValid ? "" : "border-red-300"}`}
          />
          {!montantValid && (
            <p className="text-xs text-red-600 mt-1">Le montant est obligatoire (≥ 0).</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-1">Note</label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ajouter une note…"
            className="w-full border rounded px-3 py-2"
          />
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            {err}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between gap-2">
          {/* Supprimer (avec confirmation) */}
          <button
            type="button"
            onClick={() => setShowConfirmDelete(true)}
            disabled={saving}
            className="px-4 py-2 inline-flex items-center gap-2 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
            title="Supprimer cette séance réalisée"
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
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded disabled:opacity-50"
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
              Vous êtes sur le point de supprimer la <b>séance réalisée numéro {seance.numero_seance}</b>.
              Cette action <b>réindexera automatiquement</b> les numéros des séances suivantes
              (programmées et réalisées) du même dossier.
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
