// src/components/ScheduleSeanceModal.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase, Patient, DossierSoin, UserBase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { X, Search, Clock } from "lucide-react";

/* ----------------- Helpers fuseau Africa/Tunis ----------------- */
function pad2(n: number | string) {
  return String(n).padStart(2, "0");
}

/** Renvoie la date/heure “maintenant” dans le fuseau Africa/Tunis */
function getTunisNow() {
  const tz = "Africa/Tunis";
  const fmt = new Intl.DateTimeFormat("fr-TN", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (t: Intl.DateTimeFormatPartTypes) =>
    fmt.find((p) => p.type === t)?.value ?? "00";

  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const hh = get("hour");
  const mi = get("minute");

  const todayISO = `${yyyy}-${mm}-${dd}`;
  const nowKey = `${todayISO}T${hh}:${mi}:00`;
  return { todayISO, hh, mi, nowKey };
}

function keyFrom(dateISO: string, hh: string, mm: string) {
  return `${dateISO}T${pad2(hh)}:${pad2(mm)}:00`;
}
function parseKey(k: string) {
  return new Date(k);
}
function addMinutesToHHMM(hhmm: string, plus: number) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x || "0", 10));
  const d = new Date(2000, 0, 1, h, m, 0);
  d.setMinutes(d.getMinutes() + plus);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/* --------------------------------------------------------------- */

type Props = {
  defaultDate?: string;   // "YYYY-MM-DD"
  defaultHour?: string;   // "HH"
  onClose: () => void;
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

  // Recherche patient
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dossiers, setDossiers] = useState<DossierSoin[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDossier, setSelectedDossier] = useState<DossierSoin | null>(null);

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

  // ---- Référence “aujourd’hui / maintenant” en Africa/Tunis
  const tunisNow = useMemo(() => getTunisNow(), []);
  const [dateSeance, setDateSeance] = useState<string>(defaultDate || tunisNow.todayISO);
  const [minDateISO, setMinDateISO] = useState<string>(tunisNow.todayISO); // max(aujourd'hui-Tunis, lastReal, lastProgDate)
  const [lastScheduledKey, setLastScheduledKey] = useState<string | null>(null); // YYYY-MM-DDTHH:MM:00 (pour borne si même jour)

  // Form champs
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

  const hoursOptions = Array.from({ length: 13 }, (_, i) => pad2(8 + i)); // 08..20

  // Charger patients & prestataires
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

  // Charger dossiers en cours du patient sélectionné
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

  // minDate = max(aujourd’hui-Tunis, dernière RÉALISÉE, dernière PROGRAMMÉE (partie date))
  useEffect(() => {
    (async () => {
      setSubmitError("");
      setLastScheduledKey(null);

      const baseMin = tunisNow.todayISO;
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
      const lastRealDate = lastReal && lastReal.length ? String(lastReal[0].date_seance) : null;

      // dernière PROGRAMMÉE (date + heure pour contrôle horaire)
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
  }, [selectedDossier, tunisNow.todayISO]);

  // -------- Auto-clamp HH:MM si la date = aujourd’hui (Tunis) et/ou même jour que dernière programmée --------
  /** Renvoie la borne HH:MM minimale à respecter pour la date courante */
  const getMinHHMMForCurrentDate = (): string | null => {
    let minHHMM: string | null = null;

    // 1) Si aujourd’hui (Tunis) : ≥ maintenant (Tunis)
    if (dateSeance === tunisNow.todayISO) {
      minHHMM = `${tunisNow.hh}:${tunisNow.mi}`;
    }

    // 2) Si même jour que la DERNIÈRE PROGRAMMÉE : strictement après (donc +1 minute)
    if (lastScheduledKey && dateSeance === lastScheduledKey.slice(0, 10)) {
      const lastHHMM = lastScheduledKey.slice(11, 16);
      const plus1 = addMinutesToHHMM(lastHHMM, 1);
      minHHMM = minHHMM ? (plus1 > minHHMM ? plus1 : minHHMM) : plus1;
    }

    return minHHMM;
  };

  // Clamp quand la date change / quand une borne change
  useEffect(() => {
    const minHHMM = getMinHHMMForCurrentDate();
    if (!minHHMM) return;

    const curKey = keyFrom(dateSeance, hour, minute === "" ? "00" : minute.padStart(2, "0"));
    const minKey = keyFrom(dateSeance, minHHMM.slice(0, 2), minHHMM.slice(3, 5));
    if (parseKey(curKey) < parseKey(minKey)) {
      setHour(minHHMM.slice(0, 2));
      setMinute(minHHMM.slice(3, 5));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateSeance, lastScheduledKey, tunisNow.todayISO, tunisNow.hh, tunisNow.mi]);

  // Inputs sanitation + clamp dynamique
  const onMinuteChange = (v: string) => {
    const clean = v.replace(/[^\d]/g, "").slice(0, 2);
    const minHHMM = getMinHHMMForCurrentDate();
    if (minHHMM && hour === minHHMM.slice(0, 2)) {
      const minM = parseInt(minHHMM.slice(3, 5), 10);
      const typed = parseInt(clean || "0", 10);
      const clamped = Math.max(isNaN(typed) ? 0 : typed, minM);
      setMinute(pad2(clamped));
      return;
    }
    setMinute(clean);
  };

  const onHourChange = (v: string) => {
    const minHHMM = getMinHHMMForCurrentDate();
    if (!minHHMM) {
      setHour(v);
      return;
    }
    const minH = parseInt(minHHMM.slice(0, 2), 10);
    const nextH = parseInt(v, 10);
    if (nextH < minH) {
      // impossible via select (option disable), sécurité
      setHour(minHHMM.slice(0, 2));
      setMinute(minHHMM.slice(3, 5));
      return;
    }
    // si égal, clamp MM
    if (nextH === minH) {
      const minM = parseInt(minHHMM.slice(3, 5), 10);
      const curM = parseInt((minute || "0").padStart(2, "0"), 10);
      setHour(v);
      if (curM < minM) setMinute(pad2(minM));
      return;
    }
    setHour(v);
  };

  // “Désactivation” des options heures < min quand borne existe
  const minHHMMForSelect = getMinHHMMForCurrentDate();
  const minHourForSelect = minHHMMForSelect ? parseInt(minHHMMForSelect.slice(0, 2), 10) : null;

  // Inputs sanitation
  const onDureeChange = (v: string) => setDuree(v.replace(/[^\d]/g, "").slice(0, 4));

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

    // Aujourd’hui (Tunis) : horaire ≥ maintenant
    if (dateSeance === tunisNow.todayISO) {
      const chosenKey = keyFrom(dateSeance, hour, mm);
      if (!(chosenKey >= tunisNow.nowKey)) {
        setSubmitError(`Pour aujourd’hui, l’horaire doit être ≥ ${tunisNow.hh}:${tunisNow.mi}.`);
        return;
      }
    }

    // Même jour que la DERNIÈRE PROGRAMMÉE : strictement après
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
      const heure = `${pad2(hour)}:${pad2(mm)}:00`;

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
                      {(p as any).telephone ? <span className="text-gray-400">— {(p as any).telephone}</span> : null}
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
                onChange={(e) => onHourChange(e.target.value)}
                className="w-20 border rounded px-2 py-2 bg-white"
                title="Heure"
              >
                {hoursOptions.map((h) => {
                  const disabled =
                    minHourForSelect !== null && parseInt(h, 10) < minHourForSelect;
                  return (
                    <option key={h} value={h} disabled={disabled}>
                      {h}
                    </option>
                  );
                })}
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

            {/* Indices borne “maintenant” et “dernière programmée” */}
            <div className="text-xs text-gray-500 mt-1 space-y-0.5">
              {dateSeance === tunisNow.todayISO && (
                <div>Pour aujourd’hui, l’horaire doit être ≥ {tunisNow.hh}:{tunisNow.mi}.</div>
              )}
              {lastScheduledKey && dateSeance === lastScheduledKey.slice(0, 10) && (
                <div>
                  Doit être &gt; {lastScheduledKey.replace("T", " ").slice(0, 16)} (dernière programmée).
                </div>
              )}
            </div>
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

/* =================================================================
   ÉDITION d’une séance programmée — borne “≥ maintenant” en Africa/Tunis
================================================================= */
export function EditScheduledSeanceModal({
  seance,
  onClose,
  onSuccess,
}: {
  seance: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === "admin";

  const [dateSeance, setDateSeance] = useState<string>(seance?.date_seance || "");
  const [minDateISO, setMinDateISO] = useState<string>(getTunisNow().todayISO);
  const [hour, setHour] = useState<string>(
    seance?.heure_seance ? String(seance.heure_seance).slice(0, 2) : "08"
  );
  const [minute, setMinute] = useState<string>(
    seance?.heure_seance ? String(seance.heure_seance).slice(3, 5) : "00"
  );
  const [duree, setDuree] = useState<string>(
    seance?.duree_minutes != null ? String(seance.duree_minutes) : ""
  );
  const [note, setNote] = useState<string>(seance?.note || "");
  const [prestataireId, setPrestataireId] = useState<string>(seance?.prestataire_id || "");

  const [prestataires, setPrestataires] = useState<UserBase[]>([]);
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const hoursOptions = Array.from({ length: 13 }, (_, i) => pad2(8 + i)); // 08..20

  // Prestataires (admin)
  useEffect(() => {
    (async () => {
      if (isAdmin) {
        const { data } = await supabase
          .from("users_base")
          .select("id, nom, prenom")
          .eq("client_id", userBase?.client_id)
          .order("nom");
        setPrestataires((data || []) as UserBase[]);
      }
    })();
  }, [isAdmin, userBase?.client_id]);

  // minDate = max(aujourd’hui-Tunis, dernière séance réalisée)
  useEffect(() => {
    (async () => {
      const baseToday = getTunisNow().todayISO;
      if (!seance?.dossier_id) {
        setMinDateISO(baseToday);
        setDateSeance((p) => (p < baseToday ? baseToday : p));
        return;
      }
      const { data } = await supabase
        .from("seances")
        .select("date_seance")
        .eq("dossier_id", seance.dossier_id)
        .in("etat_seance", ["réalisée", "realisee"])
        .order("date_seance", { ascending: false })
        .limit(1);

      if (!data || data.length === 0) {
        setMinDateISO(baseToday);
        setDateSeance((p) => (p < baseToday ? baseToday : p));
        return;
      }
      const lastReal = String(data[0].date_seance);
      const min = lastReal > baseToday ? lastReal : baseToday;
      setMinDateISO(min);
      setDateSeance((p) => (p < min ? min : p));
    })();
  }, [seance?.dossier_id]);

  // voisines programmées
  useEffect(() => {
    (async () => {
      if (!seance?.dossier_id || !seance?.numero_seance) {
        setPrevKey(null);
        setNextKey(null);
        return;
      }
      const num = Number(seance.numero_seance);
      const { data } = await supabase
        .from("seances")
        .select("numero_seance, date_seance, heure_seance, etat_seance")
        .eq("dossier_id", seance.dossier_id)
        .in("etat_seance", ["programmée", "programmee"])
        .order("numero_seance", { ascending: true });

      const all = (data || []) as any[];
      const prev = all.find((s) => s.numero_seance === num - 1);
      const next = all.find((s) => s.numero_seance === num + 1);

      const prevKeyLocal = prev
        ? keyFrom(
            String(prev.date_seance).slice(0, 10),
            String(prev.heure_seance ?? "00:00").slice(0, 2),
            String(prev.heure_seance ?? "00:00").slice(3, 5)
          )
        : null;
      const nextKeyLocal = next
        ? keyFrom(
            String(next.date_seance).slice(0, 10),
            String(next.heure_seance ?? "00:00").slice(0, 2),
            String(next.heure_seance ?? "00:00").slice(3, 5)
          )
        : null;

      setPrevKey(prevKeyLocal);
      setNextKey(nextKeyLocal);
    })();
  }, [seance?.dossier_id, seance?.numero_seance]);

  const onMinuteChange = (v: string) => setMinute(v.replace(/[^\d]/g, "").slice(0, 2));
  const onDureeChange = (v: string) => setDuree(v.replace(/[^\d]/g, "").slice(0, 4));

  const handleUpdate = async () => {
    setSubmitError("");
    if (!seance?.id) return;

    if (dateSeance < minDateISO) {
      setSubmitError("Date invalide (antérieure aux autorisations).");
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
    const dureeNum = duree === "" ? null : Number(duree);
    if (dureeNum !== null && (isNaN(dureeNum) || dureeNum < 0)) {
      setSubmitError("Durée invalide (minutes ≥ 0).");
      return;
    }

    // Aujourd’hui (Tunis) : ≥ maintenant
    const tn = getTunisNow();
    const chosenKey = keyFrom(dateSeance, hour, mm);
    if (dateSeance === tn.todayISO && parseKey(chosenKey) < parseKey(tn.nowKey)) {
      setSubmitError("Pour aujourd’hui, l’horaire doit être ≥ maintenant.");
      return;
    }

    // Bornes voisines
    if (prevKey && !(parseKey(chosenKey) > parseKey(prevKey))) {
      setSubmitError(
        `Doit être strictement après la séance précédente (${prevKey.replace("T", " ").slice(0, 16)}).`
      );
      return;
    }
    if (nextKey && !(parseKey(chosenKey) < parseKey(nextKey))) {
      setSubmitError(
        `Doit être strictement avant la séance suivante (${nextKey.replace("T", " ").slice(0, 16)}).`
      );
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        date_seance: dateSeance,
        heure_seance: `${pad2(hour)}:${pad2(mm)}:00`,
        duree_minutes: dureeNum,
        note: note || null,
        prestataire_id: prestataireId || null,
      };
      const { error } = await supabase.from("seances").update(payload).eq("id", seance.id);
      if (error) throw error;
      onSuccess();
    } catch (e: any) {
      console.error("Erreur mise à jour de la séance programmée:", e);
      setSubmitError(e?.message || "Impossible d'enregistrer les modifications.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Modifier la séance programmée</h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100" title="Fermer">
            <X className="w-5 h-5" />
          </button>
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

            {/* Aides voisines */}
            <div className="text-xs space-y-0.5 mt-1">
              {prevKey && (
                <div className="text-gray-600">
                  &gt; {prevKey.replace("T", " ").slice(0, 16)} (programmée précédente)
                </div>
              )}
              {nextKey && (
                <div className="text-gray-600">
                  &lt; {nextKey.replace("T", " ").slice(0, 16)} (programmée suivante)
                </div>
              )}
            </div>
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
        )}

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

        {submitError && (
          <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">
            {submitError}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row justify-between gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">
            Annuler
          </button>
          <button
            onClick={handleUpdate}
            disabled={saving}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
