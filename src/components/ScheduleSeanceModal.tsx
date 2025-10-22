// src/components/ScheduleSeanceModal.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase, Patient, DossierSoin, UserBase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { X, Search, Clock } from "lucide-react";

type Props = {
  /** date pré-sélectionnée "YYYY-MM-DD" (optionnelle) */
  defaultDate?: string;
  /** heure pré-sélectionnée (HH) optionnelle (ex: "14") */
  defaultHour?: string;
  /** callback fermeture */
  onClose: () => void;
  /** callback succès */
  onSuccess: () => void;
};

export default function ScheduleSeanceModal({
  defaultDate,
  defaultHour,
  onClose,
  onSuccess,
}: Props) {
  const { user, userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === "admin";

  // Sélection patient/dossier
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dossiers, setDossiers] = useState<DossierSoin[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDossier, setSelectedDossier] = useState<DossierSoin | null>(null);

  // Recherche patient
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

  // Helpers temps
  const pad2 = (n: number | string) => String(n).padStart(2, "0");
  const keyFrom = (d: string, hh: string, mm: string) => `${d}T${pad2(hh)}:${pad2(mm)}:00`;

  const now = new Date();
  const todayISO = now.toISOString().split("T")[0];
  const nowHH = pad2(now.getHours());
  const nowMM = pad2(now.getMinutes());
  const nowKey = keyFrom(todayISO, nowHH, nowMM);

  // Form champs
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [dateSeance, setDateSeance] = useState<string>(defaultDate || today);
  const [minDateISO, setMinDateISO] = useState<string>(today); // ⬅️ max(today, lastRealized, lastScheduledDate)
  const [lastScheduledKey, setLastScheduledKey] = useState<string | null>(null); // "YYYY-MM-DDTHH:MM:00" pour contrôle horaire égal-jour
  const [hour, setHour] = useState<string>(defaultHour || "08");
  const [minute, setMinute] = useState<string>("00");
  const [duree, setDuree] = useState<string>("");
  const [note, setNote] = useState<string>("");

  // Prestataire
  const [prestataires, setPrestataires] = useState<UserBase[]>([]);
  const [selectedPrestataire, setSelectedPrestataire] = useState<string>(user?.id || "");

  // État UI
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string>("");

  const hoursOptions = Array.from({ length: 13 }, (_, i) => 8 + i).map((h) =>
    h.toString().padStart(2, "0")
  ); // 08..20

  // ---- Charger patients & prestataires
  useEffect(() => {
    (async () => {
      const { data: pts } = await supabase
        .from("patients")
        .select("*")
        .eq("client_id", userBase?.client_id)
        .order("nom");
      setPatients((pts || []) as Patient[]);

      if (isAdmin) {
        const { data: users } = await supabase
          .from("users_base")
          .select("id, nom, prenom, client_id")
          .eq("client_id", userBase?.client_id)
          .order("nom");
        setPrestataires((users || []) as UserBase[]);
      }
    })();
  }, [isAdmin, userBase?.client_id]);

  // ---- Charger dossiers en cours du patient sélectionné
  useEffect(() => {
    (async () => {
      if (!selectedPatient) {
        setDossiers([]);
        setSelectedDossier(null);
        return;
      }
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("dossiers_soins")
          .select("*")
          .eq("patient_id", selectedPatient.id)
          .eq("client_id", userBase?.client_id)
          .eq("etat", "en_cours")
          .order("created_at", { ascending: false });
        if (error) throw error;
        setDossiers((data || []) as DossierSoin[]);
      } catch (e) {
        console.error("Erreur chargement dossiers:", e);
        setDossiers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedPatient, userBase?.client_id]);

  // ---- minDate = max(today, dernière RÉALISÉE, dernière PROGRAMMÉE (partie date)) + renseigner lastScheduledKey
  useEffect(() => {
    (async () => {
      setSubmitError("");
      setLastScheduledKey(null);

      const baseMin = today;
      if (!selectedDossier) {
        setMinDateISO(baseMin);
        setDateSeance((prev) => (prev < baseMin ? baseMin : prev));
        return;
      }

      // dernière RÉALISÉE (date seule)
      const { data: lastReal } = await supabase
        .from("seances")
        .select("date_seance")
        .eq("dossier_id", selectedDossier.id)
        .in("etat_seance", ["réalisée", "realisee"])
        .order("date_seance", { ascending: false })
        .limit(1);

      const lastRealDate = lastReal && lastReal.length ? (lastReal[0].date_seance as string) : null;

      // dernière PROGRAMMÉE (date + heure → key complète)
      const { data: lastProg } = await supabase
        .from("seances")
        .select("date_seance, heure_seance")
        .eq("dossier_id", selectedDossier.id)
        .in("etat_seance", ["programmée", "programmee"])
        .order("date_seance", { ascending: false })
        .order("heure_seance", { ascending: false })
        .limit(1);

      let lastProgDate: string | null = null;
      if (lastProg && lastProg.length) {
        const d = String(lastProg[0].date_seance);
        const t = lastProg[0].heure_seance ? String(lastProg[0].heure_seance).slice(0, 5) : "00:00";
        setLastScheduledKey(`${d}T${t}:00`);
        lastProgDate = d;
      }

      const candidates = [baseMin, lastRealDate, lastProgDate].filter(Boolean) as string[];
      const min = candidates.length ? candidates.sort().at(-1)! : baseMin;

      setMinDateISO(min);
      setDateSeance((prev) => (prev < min ? min : prev));
    })();
  }, [selectedDossier, today]);

  // ---- Sanitize inputs
  const onMinuteChange = (v: string) => setMinute(v.replace(/[^\d]/g, "").slice(0, 2));
  const onDureeChange = (v: string) => setDuree(v.replace(/[^\d]/g, "").slice(0, 4));

  // ---- Helper: borne horaire minimale pour une date donnée
  // renvoie "HH:MM" ou null si aucune contrainte (autre que minDate côté date)
  const minHHMMForDate = (d: string): string | null => {
    let base: string | null = null;

    // Si aujourd'hui: >= maintenant
    if (d === todayISO) base = `${nowHH}:${nowMM}`;

    // Si même jour que la dernière PROGRAMMÉE: strictement après
    if (lastScheduledKey && d === lastScheduledKey.slice(0, 10)) {
      const [lh, lm] = lastScheduledKey.slice(11, 16).split(":");
      // +1 minute strict
      const dateRef = new Date(2000, 0, 1, Number(lh), Number(lm), 0);
      dateRef.setMinutes(dateRef.getMinutes() + 1);
      const plusH = pad2(dateRef.getHours());
      const plusM = pad2(dateRef.getMinutes());
      const plus = `${plusH}:${plusM}`;
      base = base ? (plus > base ? plus : base) : plus;
    }

    return base;
  };

  // ---- AUTO-CLAMP heure/minute quand la date change ou quand les bornes changent
  useEffect(() => {
    // clamp date (sécurité minDateISO)
    setDateSeance((prev) => (prev < minDateISO ? minDateISO : prev));
  }, [minDateISO]);

  useEffect(() => {
    const minHHMM = minHHMMForDate(dateSeance);
    if (!minHHMM) return;

    const [minH, minM] = minHHMM.split(":");
    const curKey = keyFrom(dateSeance, hour, minute === "" ? "00" : minute.padStart(2, "0"));
    const minKey = keyFrom(dateSeance, minH, minM);

    if (curKey < minKey) {
      // auto-élève à la borne
      if (hour !== minH) setHour(minH);
      if (minute.padStart(2, "0") !== minM) setMinute(minM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateSeance, lastScheduledKey, todayISO, nowHH, nowMM]);

  // ---- Rappel UX: si on tape des minutes < min quand HH = minH, re-clamp au fil de l'eau
  useEffect(() => {
    const minHHMM = minHHMMForDate(dateSeance);
    if (!minHHMM) return;
    const [minH, minM] = minHHMM.split(":");

    if (hour < minH) {
      setHour(minH);
      setMinute(minM);
      return;
    }
    if (hour === minH) {
      const mm = (minute || "00").padStart(2, "0");
      if (mm < minM) setMinute(minM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hour, minute, dateSeance, lastScheduledKey]);

  const getNextSeanceNumber = async (dossierId: string) => {
    const { data, error } = await supabase
      .from("seances")
      .select("numero_seance")
      .eq("dossier_id", dossierId)
      .order("numero_seance", { ascending: false })
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0].numero_seance + 1 : 1;
  };

  const handleSave = async () => {
    setSubmitError("");

    if (!selectedDossier) {
      setSubmitError("Veuillez sélectionner un dossier non clôturé avec des séances restantes à programmer.");
      return;
    }
    if (!/^\d{2}$/.test(hour)) {
      setSubmitError("Heure invalide.");
      return;
    }
    const mm = minute === "" ? "00" : minute.padStart(2, "0");
    const mmNum = Number(mm);
    if (isNaN(mmNum) || mmNum < 0 || mmNum > 59) {
      setSubmitError("Minutes invalides (0–59).");
      return;
    }
    // Date >= minDateISO
    if (dateSeance < minDateISO) {
      setSubmitError("Date invalide (antérieure aux autorisations).");
      return;
    }

    // Aujourd’hui: horaire ≥ maintenant (déjà auto-clampé, mais on garde la garde-fou)
    if (dateSeance === todayISO) {
      const chosenKey = keyFrom(dateSeance, hour, mm);
      if (!(chosenKey >= nowKey)) {
        setSubmitError(`Pour aujourd’hui, l’horaire doit être ≥ ${nowHH}:${nowMM}.`);
        return;
      }
    }

    // Même jour que la DERNIÈRE PROGRAMMÉE: strictement après (déjà auto-clampé)
    if (lastScheduledKey && dateSeance === lastScheduledKey.slice(0, 10)) {
      const chosenKey = keyFrom(dateSeance, hour, mm);
      if (!(chosenKey > lastScheduledKey)) {
        setSubmitError(
          `L’horaire doit être strictement après la dernière séance programmée (${lastScheduledKey
            .replace("T", " ")
            .slice(0, 16)}).`
        );
        return;
      }
    }

    const dureeNum = duree === "" ? null : Number(duree);
    if (dureeNum !== null && (isNaN(dureeNum) || dureeNum < 0)) {
      setSubmitError("Durée invalide (minutes ≥ 0).");
      return;
    }

    setSaving(true);
    try {
      const numero = await getNextSeanceNumber(selectedDossier.id);
      const heure = `${hour}:${mm}:00`;

      const payload: any = {
        dossier_id: selectedDossier.id,
        numero_seance: numero,
        date_seance: dateSeance,
        heure_seance: heure,
        etat_seance: "programmée",
        prestataire_id: isAdmin ? selectedPrestataire : user?.id,
        montant_paye: 0,
        duree_minutes: dureeNum,
        note: note || null,
      };

      const { error } = await supabase.from("seances").insert(payload);
      if (error) throw error;

      onSuccess();
    } catch (e: any) {
      console.error("Erreur programmation séance:", e);
      setSubmitError(e?.message || "Impossible d'enregistrer la programmation.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Programmer une séance</h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100" title="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Recherche patient */}
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
                      {p.telephone ? <span className="text-gray-400">— {p.telephone}</span> : null}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Dossier en cours */}
        <div>
          <label className="block text-sm text-gray-700 mb-1">Dossier (à venir / en cours)</label>
          {loading ? (
            <div className="text-sm text-gray-500">Chargement…</div>
          ) : !selectedPatient ? (
            <div className="text-sm text-gray-500">Choisissez d’abord un patient.</div>
          ) : dossiers.length === 0 ? (
            <div className="text-sm text-gray-500">Aucun dossier en cours pour ce patient.</div>
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

        {/* Date + Heure + Durée */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Date *</label>
            <input
              type="date"
              value={dateSeance}
              onChange={(e) => setDateSeance(e.target.value)}
              min={minDateISO}
              className="w-full border rounded px-3 py-2"
            />
            <p className="text-xs text-gray-500 mt-1">
              Jour autorisé ≥ {new Date(minDateISO).toLocaleDateString("fr-FR")}
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Heure *</label>
            <div className="flex items-center gap-2">
              <select
                value={hour}
                onChange={(e) => setHour(e.target.value)}
                className="w-20 border rounded px-2 py-2 bg-white"
                title="Heure"
              >
                {hoursOptions.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-gray-500">:</span>
              <input
                type="text"
                inputMode="numeric"
                value={minute}
                onChange={(e) => onMinuteChange(e.target.value)}
                placeholder="MM"
                className="w-20 border rounded px-2 py-2"
                title="Minutes (0–59)"
              />
              <Clock className="w-4 h-4 text-gray-400" />
            </div>
            {/* Indices bornes */}
            {dateSeance === todayISO && (
              <p className="text-xs text-gray-500 mt-1">
                Pour aujourd’hui, l’horaire doit être ≥ {nowHH}:{nowMM}.
              </p>
            )}
            {lastScheduledKey && dateSeance === lastScheduledKey.slice(0, 10) && (
              <p className="text-xs text-gray-500 mt-1">
                Le créneau doit être <b>strictement</b> après{" "}
                {lastScheduledKey.replace("T", " ").slice(0, 16)}.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Durée (min)</label>
            <input
              type="text"
              inputMode="numeric"
              value={duree}
              onChange={(e) => onDureeChange(e.target.value)}
              placeholder="ex: 45"
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        {/* Prestataire (admin) */}
        {isAdmin && (
          <div>
            <label className="block text-sm text-gray-700 mb-1">Prestataire *</label>
            <select
              value={selectedPrestataire}
              onChange={(e) => setSelectedPrestataire(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white"
            >
              {prestataires.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.prenom} {u.nom}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Note (optionnelle) */}
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

        {submitError && (
          <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Programmer"}
          </button>
        </div>
      </div>
    </div>
  );
}
