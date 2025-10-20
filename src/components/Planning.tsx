// src/components/Planning.tsx
import { useEffect, useMemo, useState } from "react";
import {
  supabase,
  Seance,
  DossierSoin,
  Patient,
  UserBase,
} from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  User as UserIcon,
  X,
  Search,
  Eye,
  CheckCircle2,
  SquarePen,
} from "lucide-react";

import EditSeanceModal from "./EditSeanceModal";
import EditScheduledSeanceModal from "./EditScheduledSeanceModal";

/* ------------------ Utils quota ------------------ */
async function countSeancesForDossier(dossierId: string): Promise<number> {
  const { data, count, error } = await supabase
    .from("seances")
    .select("id", { count: "exact" })
    .eq("dossier_id", dossierId);
  if (error) throw error;
  return (typeof count === "number" ? count : (data?.length ?? 0)) as number;
}
async function getDossierWithMax(
  dossierId: string
): Promise<Pick<DossierSoin, "id" | "motif" | "nombre_seances">> {
  const { data, error } = await supabase
    .from("dossiers_soins")
    .select("id, motif, nombre_seances")
    .eq("id", dossierId)
    .single();
  if (error) throw error;
  return data as any;
}
async function remainingSlotsForDossier(dossierId: string): Promise<{
  remaining: number;
  max: number | null;
}> {
  const dossier = await getDossierWithMax(dossierId);
  const max = dossier?.nombre_seances ?? null;
  if (!max || max <= 0) return { remaining: Infinity, max: null };
  const current = await countSeancesForDossier(dossierId);
  const remaining = Math.max(0, max - current);
  return { remaining, max };
}

/** Types d'état (DB avec/ sans accents tolérés) */
type EtatSeance = "programmée" | "programmee" | "réalisée" | "realisee";

/** Aides temps */
function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}
function toDateStrReadable(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function extractHour(heure: any): number {
  if (!heure) return 0;
  const hh = String(heure).slice(0, 2);
  const h = parseInt(hh, 10);
  return Number.isFinite(h) ? h : 0;
}
function extractMinute(heure: any): number {
  const mm = Number(String(heure || "00:00").slice(3, 5) || "0");
  return Number.isFinite(mm) ? mm : 0;
}
function isProgrammeeState(etat?: string | null) {
  return etat === "programmée" || etat === "programmee";
}
function isFutureDateTime(dateISO: string, hh: number, mm: number) {
  const now = new Date();
  const today = toDateStr(now);
  const nowH = now.getHours();
  const nowM = now.getMinutes();
  if (dateISO > today) return true;
  if (dateISO < today) return false;
  if (hh > nowH) return true;
  if (hh < nowH) return false;
  return mm > nowM;
}

/** Props pour ouvrir un dossier depuis la planif */
export default function Planning({
  onOpenDossier,
}: {
  onOpenDossier: (dossier: DossierSoin, patient: Patient) => void;
}) {
  const { user, userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === "admin";

  // Vue & filtres
  type ViewMode = "day" | "week" | "month";
  const [mode, setMode] = useState<ViewMode>("week");
  const [etatFilter, setEtatFilter] = useState<"programmée" | "réalisée">(
    "programmée"
  );

  const todayStr = useMemo(() => toDateStr(new Date()), []);
  const [anchorDate, setAnchorDate] = useState<string>(todayStr); // centre de la vue (jour/sem/mois)

  // Sélecteurs Mois/Année (vue mois)
  const anchor = useMemo(() => new Date(anchorDate), [anchorDate]);
  const [monthSelect, setMonthSelect] = useState<number>(anchor.getMonth()); // 0..11
  const [yearSelect, setYearSelect] = useState<number>(anchor.getFullYear());

  useEffect(() => {
    // Garder sélecteurs en phase quand anchorDate change autrement
    const d = new Date(anchorDate);
    setMonthSelect(d.getMonth());
    setYearSelect(d.getFullYear());
  }, [anchorDate]);

  const yearsRange = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 9 }, (_, i) => y - 4 + i);
  }, []);

  // Période affichée
  const startEnd = useMemo(() => {
    const d = new Date(anchorDate);
    if (mode === "day") {
      const start = toDateStr(d);
      const end = toDateStr(addDays(d, 1));
      return { start, end };
    }
    if (mode === "week") {
      const wd = d.getDay(); // 0 dimanche … 6 samedi
      const monday = addDays(d, -((wd + 6) % 7));
      const start = toDateStr(monday);
      const end = toDateStr(addDays(monday, 7));
      return { start, end };
    }
    // month
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { start: toDateStr(first), end: toDateStr(nextMonth) };
  }, [anchorDate, mode]);

  // Heures 08..20
  const hours = useMemo(() => Array.from({ length: 13 }, (_, i) => 8 + i), []);

  // Données
  const [rows, setRows] = useState<
    (Seance & {
      dossier?: DossierSoin;
      patient?: Patient;
      prestataire?: UserBase;
    })[]
  >([]);
  const [loading, setLoading] = useState(true);

  // Slot sélectionné (pour la liste & actions)
  const [slot, setSlot] = useState<{ date: string; hour: number } | null>(
    null
  );

  // Modales internes (programmer ici / ajouter réalisée ici)
  const [showProgramHere, setShowProgramHere] = useState(false);
  const [showAddRealHere, setShowAddRealHere] = useState(false);

  // Modales d’édition
  const [editScheduled, setEditScheduled] =
    useState<Seance & { dossier?: DossierSoin; patient?: Patient } | null>(
      null
    );
  const [editRealized, setEditRealized] =
    useState<Seance & { dossier?: DossierSoin; patient?: Patient } | null>(
      null
    );
  const [realizeFromScheduled, setRealizeFromScheduled] =
    useState<Seance & { dossier?: DossierSoin; patient?: Patient } | null>(
      null
    );

  // Refresh centralisé + RealTime
  const [reloadNonce, setReloadNonce] = useState(0);
  const refresh = () => setReloadNonce((n) => n + 1);

  useEffect(() => {
    (async () => {
      if (!userBase?.client_id) return;
      setLoading(true);
      try {
        const clientId = userBase.client_id;

        // Filtre etat
        const etatColValues: EtatSeance[] =
          etatFilter === "programmée"
            ? ["programmée", "programmee"]
            : ["réalisée", "realisee"];

        // portée user
        let q = supabase
          .from("seances")
          .select("*")
          .gte("date_seance", startEnd.start)
          .lt("date_seance", startEnd.end)
          .in("etat_seance", etatColValues as any)
          .order("date_seance", { ascending: true })
          .order("heure_seance", { ascending: true });

        if (!isAdmin) q = q.eq("prestataire_id", user?.id);

        const { data: seancesRaw, error: seErr } = await q;
        if (seErr) throw seErr;

        if (!seancesRaw || seancesRaw.length === 0) {
          setRows([]);
          setLoading(false);
          return;
        }

        // Dossiers concernés (client)
        const dossierIds = Array.from(
          new Set(seancesRaw.map((s: any) => s.dossier_id))
        ).filter(Boolean);
        const { data: dossiers, error: dErr } = await supabase
          .from("dossiers_soins")
          .select("*")
          .in("id", dossierIds)
          .eq("client_id", clientId);
        if (dErr) throw dErr;
        const dossierById = new Map((dossiers || []).map((d: any) => [d.id, d]));

        // Patients
        const patientIds = Array.from(
          new Set((dossiers || []).map((d: any) => d.patient_id).filter(Boolean))
        );
        let patientsById = new Map<string, any>();
        if (patientIds.length > 0) {
          const { data: patients, error: pErr } = await supabase
            .from("patients")
            .select("*")
            .in("id", patientIds);
          if (pErr) throw pErr;
          patientsById = new Map((patients || []).map((p: any) => [p.id, p]));
        }

        // Prestataires
        const prestataireIds = Array.from(
          new Set(seancesRaw.map((s: any) => s.prestataire_id).filter(Boolean))
        );
        let prestasById = new Map<string, any>();
        if (prestataireIds.length > 0) {
          const { data: prestas, error: prErr } = await supabase
            .from("users_base")
            .select("id, nom, prenom, client_id")
            .in("id", prestataireIds)
            .eq("client_id", clientId);
          if (prErr) throw prErr;
          prestasById = new Map((prestas || []).map((u: any) => [u.id, u]));
        }

        const full = (seancesRaw || [])
          .map((s: any) => {
            const d = dossierById.get(s.dossier_id);
            if (!d) return null;
            const p = patientsById.get(d.patient_id);
            const u = prestasById.get(s.prestataire_id);
            return { ...s, dossier: d, patient: p, prestataire: u };
          })
          .filter(Boolean) as any[];

        setRows(full);
      } catch (e) {
        console.error("Erreur chargement planning:", e);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [
    user?.id,
    userBase?.client_id,
    isAdmin,
    startEnd.start,
    startEnd.end,
    etatFilter,
    reloadNonce,
  ]);

  // Realtime : recharge quand des séances changent dans la fenêtre affichée
  useEffect(() => {
    const channel = supabase
      .channel("planning-seances-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seances" },
        (payload) => {
          const changed: any = payload.new || payload.old || {};
          const d: string | undefined = changed.date_seance;
          if (!d || (d >= startEnd.start && d < startEnd.end)) {
            refresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [startEnd.start, startEnd.end]);

  // Agrégations par date+heure (nombre)
  const countByDateHour = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of rows) {
      const date = s.date_seance;
      const hh = s.heure_seance ? String(s.heure_seance).slice(0, 2) : "00";
      const h = parseInt(hh, 10);
      const k = `${date}|${h}`;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }, [rows]);

  // Navigation temporelle
  const goPrev = () => {
    const d = new Date(anchorDate);
    if (mode === "day") setAnchorDate(toDateStr(addDays(d, -1)));
    else if (mode === "week") setAnchorDate(toDateStr(addDays(d, -7)));
    else setAnchorDate(toDateStr(new Date(d.getFullYear(), d.getMonth() - 1, 1)));
  };
  const goNext = () => {
    const d = new Date(anchorDate);
    if (mode === "day") setAnchorDate(toDateStr(addDays(d, +1)));
    else if (mode === "week") setAnchorDate(toDateStr(addDays(d, +7)));
    else setAnchorDate(toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1)));
  };
  const goToday = () => {
    setMode("day");
    setAnchorDate(todayStr);
  };

  // Grilles de dates selon vue
  const daysInView = useMemo(() => {
    if (mode === "day") return [anchorDate];
    if (mode === "week") {
      const d = new Date(anchorDate);
      const wd = d.getDay();
      const monday = addDays(d, -((wd + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(monday, i)));
    }
    // month => grille (6 semaines max)
    const d = new Date(anchorDate);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const startMonday = addDays(first, -((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) =>
      toDateStr(addDays(startMonday, i))
    );
  }, [anchorDate, mode]);

  const titleLabel = useMemo(() => {
    const d = new Date(anchorDate);
    const prefix =
      etatFilter === "programmée"
        ? "Planning des séances programmées"
        : "Planning des séances réalisées";
    if (mode === "day") {
      const dateTxt = new Date(anchorDate).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
      return `${prefix} — ${dateTxt}`;
    }
    if (mode === "week") {
      const rangeTxt = `Semaine du ${toDateStrReadable(
        daysInView[0]
      )} au ${toDateStrReadable(daysInView[6])}`;
      return `${prefix} — ${rangeTxt}`;
    }
    // month
    const monthTxt = d.toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "long",
    });
    return `${prefix} — ${monthTxt}`;
  }, [anchorDate, mode, daysInView, etatFilter]);

  // Liste des séances d’un créneau
  const sessionsOfSlot = (date: string, hour: number) =>
    rows.filter(
      (s) => s.date_seance === date && extractHour(s.heure_seance) === hour
    );

  // Règles clics
  const canProgramHere = (date: string, _hour: number) => {
    // ➜ Pour les programmées : tous les horaires du JOUR sont activés (pas d'heuristique heure courante)
    //    On n'autorise pas de programmation sur des dates passées.
    return etatFilter === "programmée" && date >= todayStr;
  };
  const canAddRealHere = (date: string, hour: number) => {
    // Réalisées : admin = passé ou aujourd'hui ≤ heure courante ; non-admin = uniquement aujourd’hui ≤ heure courante
    const now = new Date();
    const t = toDateStr(now);
    const nowH = now.getHours();
    if (date > t) return false;
    if (date < t) return true; // passé OK
    // = aujourd’hui
    return hour <= nowH;
  };

  // Actions ouvertes depuis la liste du slot
  const openEditScheduled = (s: Seance & { dossier?: DossierSoin; patient?: Patient }) =>
    setEditScheduled(s);
  const openEditRealized = (s: Seance & { dossier?: DossierSoin; patient?: Patient }) =>
    setEditRealized(s);
  const openRealizeFromScheduled = (
    s: Seance & { dossier?: DossierSoin; patient?: Patient }
  ) => setRealizeFromScheduled(s);

  return (
    <div className="space-y-4">
      {/* Header / filtres */}
      <div className="bg-white rounded-xl shadow p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          {/* 1) Titre */}
          <div>
            <h2 className="text-xl font-bold text-gray-900">{titleLabel}</h2>
          </div>

          {/* 2) Navigation temps */}
          <div className="flex flex-col gap-2">
            {/* ligne nav principale */}
            <div className="flex items-center gap-2">
              <button
                onClick={goPrev}
                className="p-2 rounded hover:bg-gray-100 shrink-0"
                title="Précédent"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              {/* centre : date picker OU mois/année */}
              {mode === "month" ? (
                <div className="flex w-full gap-2">
                  <select
                    value={monthSelect}
                    onChange={(e) => {
                      const m = Number(e.target.value);
                      setMonthSelect(m);
                      onChangeMonthYear(m, yearSelect);
                    }}
                    className="w-full sm:w-auto flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg bg-white"
                    aria-label="Mois"
                  >
                    {Array.from({ length: 12 }, (_, i) => i).map((m) => (
                      <option key={m} value={m}>
                        {new Date(2000, m, 1).toLocaleDateString("fr-FR", {
                          month: "long",
                        })}
                      </option>
                    ))}
                  </select>

                  <select
                    value={yearSelect}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      setYearSelect(y);
                      onChangeMonthYear(monthSelect, y);
                    }}
                    className="w-full sm:w-auto flex-[0.8] min-w-0 px-3 py-2 border border-gray-300 rounded-lg bg-white"
                    aria-label="Année"
                  >
                    {yearsRange.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  type="date"
                  value={anchorDate}
                  onChange={(e) => setAnchorDate(e.target.value)}
                  className="w-full sm:w-auto flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg"
                />
              )}

              <button
                onClick={goNext}
                className="p-2 rounded hover:bg-gray-100 shrink-0"
                title="Suivant"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* ligne “Aujourd’hui” séparée */}
            <div>
              <button
                onClick={goToday}
                className="w-full sm:w-auto px-3 py-2 rounded-lg border text-sm hover:bg-gray-50"
                title="Aller à aujourd’hui"
              >
                Aujourd’hui
              </button>
            </div>
          </div>

          {/* 3) Filtres (vue / état) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            <div className="flex flex-col">
              <label className="text-sm text-gray-600 mb-1">Vue</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
              >
                <option value="day">Jour</option>
                <option value="week">Semaine</option>
                <option value="month">Mois</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-sm text-gray-600 mb-1">État</label>
              <select
                value={etatFilter}
                onChange={(e) => setEtatFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
              >
                <option value="programmée">Programmées</option>
                <option value="réalisée">Réalisées</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        {mode === "month" ? (
          <MonthGrid
            days={daysInView}
            rows={rows}
            onOpenDay={(date) => {
              setMode("day");
              setAnchorDate(date);
            }}
            today={todayStr}
          />
        ) : (
          <TimeGrid
            days={mode === "day" ? [anchorDate] : daysInView}
            hours={hours}
            countByDateHour={countByDateHour}
            loading={loading}
            onClickCell={(date, hour) => setSlot({ date, hour })}
            today={todayStr}
            etatFilter={etatFilter}
          />
        )}
      </div>

      {/* Paneau de créneau (liste + actions) */}
      {slot && (
        <SlotDrawer
          date={slot.date}
          hour={slot.hour}
          items={sessionsOfSlot(slot.date, slot.hour)}
          onClose={() => setSlot(null)}
          onOpenDossier={onOpenDossier}
          etatFilter={etatFilter}
          canProgramHere={canProgramHere(slot.date, slot.hour)}
          canAddRealHere={canAddRealHere(slot.date, slot.hour)}
          onProgram={() => setShowProgramHere(true)}
          onAddReal={() => setShowAddRealHere(true)}
          onEditScheduled={openEditScheduled}
          onEditRealized={openEditRealized}
          onRealizeScheduled={openRealizeFromScheduled}
          isAdmin={isAdmin}
          today={todayStr}
        />
      )}

      {/* Modale Programmer ici (heure fixée) */}
      {showProgramHere && slot && (
        <ProgramHereModal
          date={slot.date}
          fixedHour={slot.hour}
          onClose={() => setShowProgramHere(false)}
          onSuccess={() => {
            setShowProgramHere(false);
            refresh();
          }}
        />
      )}

      {/* Modale Ajouter RÉALISÉE ici (ou convertir une programmée) */}
      {showAddRealHere && slot && (
        <AddRealHereModal
          date={slot.date}
          fixedHour={slot.hour}
          isAdmin={isAdmin}
          currentUserId={user?.id || ""}
          onClose={() => setShowAddRealHere(false)}
          onSuccess={() => {
            setShowAddRealHere(false);
            refresh();
          }}
        />
      )}

      {/* Éditer une PROGRAMMÉE */}
      {editScheduled && (
        <EditScheduledSeanceModal
          seance={editScheduled}
          dossierId={String(editScheduled.dossier?.id ?? editScheduled.dossier_id)}
          onClose={() => setEditScheduled(null)}
          onSuccess={() => {
            setEditScheduled(null);
            refresh();
          }}
        />
      )}

      {/* Éditer une RÉALISÉE */}
      {editRealized && (
        <EditSeanceModal
          seance={editRealized}
          onClose={() => setEditRealized(null)}
          onSuccess={() => {
            setEditRealized(null);
            refresh();
          }}
        />
      )}

      {/* Conversion programmée → réalisée (en conservant la date/heure) */}
      {realizeFromScheduled && (
        <AddRealHereModal
          date={realizeFromScheduled.date_seance}
          fixedHour={extractHour(realizeFromScheduled.heure_seance)}
          scheduledSeance={realizeFromScheduled}
          isAdmin={isAdmin}
          currentUserId={user?.id || ""}
          onClose={() => setRealizeFromScheduled(null)}
          onSuccess={() => {
            setRealizeFromScheduled(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/* ================== Time grid (Jour/Semaine) ================== */
function TimeGrid({
  days,
  hours,
  countByDateHour,
  onClickCell,
  loading,
  today,
  etatFilter,
}: {
  days: string[];
  hours: number[];
  countByDateHour: Map<string, number>;
  onClickCell: (date: string, hour: number) => void;
  loading: boolean;
  today: string;
  etatFilter: "programmée" | "réalisée";
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full table-fixed border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white z-10 text-left p-3 border-b border-gray-200 text-gray-600 w-24">
              Heure
            </th>
            {days.map((d) => (
              <th
                key={d}
                className={`text-left p-3 border-b border-gray-200 text-gray-600 min-w-[160px] ${
                  d === today ? "bg-teal-50" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4" />
                  {toDateStrReadable(d)}
                </div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {hours.map((h, rowIdx) => {
            const isLast = rowIdx === hours.length - 1;
            const rowBottom = isLast ? "border-b border-gray-200" : "";

            return (
              <tr key={h}>
                {/* Colonne Heure */}
                <td
                  className={`sticky left-0 bg-white z-10 p-3 text-gray-700 font-medium border-r border-gray-200 border-t ${rowBottom}`}
                >
                  {`${String(h).padStart(2, "0")}:00`}
                </td>

                {/* Colonnes jours */}
                {days.map((d) => {
                  const k = `${d}|${h}`;
                  const c = countByDateHour.get(k) || 0;

                  // ➜ Désactivation selon filtre
                  // Programmées : activer TOUTE la journée courante (pas de grisé par heure),
                  //                griser seulement les dates strictement passées.
                  // Réalisées : griser futur (date future, ou plus tard aujourd'hui).
                  const now = new Date();
                  const pastDate = d < today;
                  const future =
                    d > today || (d === today && h > now.getHours());

                  const disabled =
                    etatFilter === "programmée"
                      ? pastDate
                      : future;

                  return (
                    <td
                      key={k}
                      className={`p-2 align-top border-l border-gray-200 border-t ${rowBottom} ${
                        d === today ? "bg-teal-50/50" : ""
                      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50"}`}
                      onClick={() => {
                        if (!disabled) onClickCell(d, h);
                      }}
                      title="Voir le détail du créneau"
                    >
                      {loading ? (
                        <div className="h-6 w-10 bg-gray-100 rounded animate-pulse" />
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="w-4 h-4 text-gray-500" />
                          <span>
                            {c} séance{c > 1 ? "s" : ""}
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ================== Month grid ================== */
function MonthGrid({
  days,
  rows,
  onOpenDay,
  today,
}: {
  days: string[];
  rows: (Seance & { dossier?: DossierSoin; patient?: Patient })[];
  onOpenDay: (date: string) => void;
  today: string;
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows) {
      m.set(s.date_seance, (m.get(s.date_seance) || 0) + 1);
    }
    return m;
  }, [rows]);

  return (
    <div className="grid grid-cols-7 gap-[1px] bg-gray-200">
      {days.map((d) => {
        const c = byDate.get(d) || 0;
        return (
          <button
            key={d}
            onClick={() => onOpenDay(d)}
            className={`bg-white p-3 text-left hover:bg-gray-50 ${
              d === today ? "bg-teal-50" : ""
            }`}
            title="Voir la journée"
          >
            <div className="text-xs text-gray-500">{toDateStrReadable(d)}</div>
            <div className="mt-2 text-sm">
              {c} séance{c > 1 ? "s" : ""}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ================== Slot drawer (liste + action unique) ================== */
function SlotDrawer({
  date,
  hour,
  items,
  onClose,
  onOpenDossier,
  etatFilter,
  canProgramHere,
  canAddRealHere,
  onProgram,
  onAddReal,
  onEditScheduled,
  onEditRealized,
  onRealizeScheduled,
  isAdmin,
  today,
}: {
  date: string;
  hour: number;
  items: (Seance & {
    dossier?: DossierSoin;
    patient?: Patient;
    prestataire?: UserBase;
  })[];
  onClose: () => void;
  onOpenDossier: (d: DossierSoin, p: Patient) => void;
  etatFilter: "programmée" | "réalisée";
  canProgramHere: boolean;
  canAddRealHere: boolean;
  onProgram: () => void;
  onAddReal: () => void;
  onEditScheduled: (
    s: Seance & { dossier?: DossierSoin; patient?: Patient }
  ) => void;
  onEditRealized: (
    s: Seance & { dossier?: DossierSoin; patient?: Patient }
  ) => void;
  onRealizeScheduled: (
    s: Seance & { dossier?: DossierSoin; patient?: Patient }
  ) => void;
  isAdmin: boolean;
  today: string;
}) {
  const isProg = etatFilter === "programmée";
  const enabled = isProg ? canProgramHere : canAddRealHere;

  const canOpen = (s: Seance) => Boolean(s.dossier && s.patient);
  const isProgrammee = (s: Seance) =>
    s.etat_seance === ("programmée" as EtatSeance) ||
    s.etat_seance === ("programmee" as EtatSeance);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl p-4 sm:p-6 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {toDateStrReadable(date)} — {String(hour).padStart(2, "0")}:00
          </h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-3">
          <button
            disabled={!enabled}
            onClick={isProg ? onProgram : onAddReal}
            className={`px-3 py-2 rounded text-sm ${
              enabled
                ? isProg
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-teal-600 text-white hover:bg-teal-700"
                : "bg-gray-200 text-gray-500"
            }`}
          >
            {isProg ? "Programmer ici" : "Ajouter séance ici"}
          </button>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2 text-gray-700 mb-2">
            <List className="w-4 h-4" />
            <span>Liste des séances</span>
          </div>

          {items.length === 0 ? (
            <div className="text-gray-500 text-sm">Aucune séance.</div>
          ) : (
            <div className="space-y-2">
              {items.map((s) => {
                const openable = canOpen(s);
                const scheduled = isProgrammee(s);
                const timeLabel = s.heure_seance
                  ? String(s.heure_seance).slice(0, 5)
                  : "—";

                // ➜ blocage conversion programmée → réalisée si FUTUR (date/heure/minute)
                const sHH = extractHour(s.heure_seance);
                const sMM = extractMinute(s.heure_seance);
                const isFutureItem = isFutureDateTime(
                  s.date_seance as string,
                  sHH,
                  sMM
                );
                const canRealizeScheduled = scheduled && !isFutureItem;

                return (
                  <div
                    key={s.id}
                    className="w-full p-3 rounded border hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {s.patient
                            ? `${s.patient.prenom} ${s.patient.nom}`
                            : "Patient"}
                        </div>
                        <div className="text-sm text-gray-600 mt-0.5">
                          {s.dossier?.motif || "Dossier"} •{" "}
                          {s.prestataire
                            ? `${s.prestataire.prenom} ${s.prestataire.nom}`
                            : "—"}{" "}
                          • {timeLabel} {s.duree_minutes ? `• ${s.duree_minutes} min` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Voir dossier */}
                        <button
                          disabled={!openable}
                          onClick={() =>
                            openable &&
                            onOpenDossier(s.dossier!, s.patient!)
                          }
                          className={`p-2 rounded-lg transition ${
                            openable
                              ? "text-blue-600 hover:bg-blue-50"
                              : "text-gray-300 cursor-not-allowed"
                          }`}
                          title={openable ? "Voir le dossier" : "Dossier indisponible"}
                        >
                          <Eye className="w-5 h-5" />
                        </button>

                        {scheduled ? (
                          <>
                            {/* Enregistrer réalisation (icone ✅) — bloqué si futur */}
                            <button
                              onClick={() => canRealizeScheduled && onRealizeScheduled(s as any)}
                              disabled={!canRealizeScheduled}
                              className={`p-2 rounded-lg transition ${
                                canRealizeScheduled
                                  ? "text-emerald-700 hover:bg-emerald-50"
                                  : "text-gray-300 cursor-not-allowed"
                              }`}
                              title={
                                canRealizeScheduled
                                  ? "Enregistrer la réalisation"
                                  : "Non autorisé sur une séance future"
                              }
                            >
                              <CheckCircle2 className="w-5 h-5" />
                            </button>
                            {/* Modifier programmée (icone ✏️) */}
                            {isAdmin && (
                              <button
                                onClick={() => onEditScheduled(s as any)}
                                className="p-2 text-blue-700 hover:bg-blue-50 rounded-lg transition"
                                title="Modifier la séance programmée"
                              >
                                <SquarePen className="w-5 h-5" />
                              </button>
                            )}
                          </>
                        ) : (
                          // Réalisée : modifier (admin)
                          isAdmin && (
                            <button
                              onClick={() => onEditRealized(s as any)}
                              className="p-2 text-teal-600 hover:bg-teal-50 rounded-lg transition"
                              title="Modifier la séance réalisée"
                            >
                              <SquarePen className="w-5 h-5" />
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================== Programmer ici (heure fixée) — logique borne/quotas ================== */
function ProgramHereModal({
  date,
  fixedHour,
  onClose,
  onSuccess,
}: {
  date: string;
  fixedHour: number; // 8..20
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === "admin";
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dossiers, setDossiers] = useState<DossierSoin[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDossier, setSelectedDossier] = useState<DossierSoin | null>(
    null
  );
  const [prestataires, setPrestataires] = useState<UserBase[]>([]);
  const [prestataireId, setPrestataireId] = useState<string>(user?.id || "");

  const [minute, setMinute] = useState<string>("00");
  const [duree, setDuree] = useState<string>("");

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const today = toDateStr(new Date());
  const [lastRealDate, setLastRealDate] = useState<string | null>(null);
  const minDate = useMemo(
    () => (!lastRealDate ? today : lastRealDate > today ? lastRealDate : today),
    [today, lastRealDate]
  );

  useEffect(() => {
    (async () => {
      // Patients du client
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
        setPrestataires((us || []) as UserBase[]);
      }
    })();
  }, [isAdmin, userBase?.client_id]);

  useEffect(() => {
    (async () => {
      if (!selectedPatient) {
        setDossiers([]);
        setSelectedDossier(null);
        return;
      }
      // Dossiers en cours / à venir uniquement
      const { data } = await supabase
        .from("dossiers_soins")
        .select("*")
        .eq("patient_id", selectedPatient.id)
        .eq("client_id", userBase?.client_id)
        .in("etat", ["a_venir", "en_cours"])
        .order("created_at", { ascending: false });
      setDossiers((data || []) as DossierSoin[]);
    })();
  }, [selectedPatient, userBase?.client_id]);

  // calcul borne min basée sur dernière RÉALISÉE
  useEffect(() => {
    (async () => {
      setLastRealDate(null);
      if (!selectedDossier) return;
      const { data } = await supabase
        .from("seances")
        .select("etat_seance, date_seance")
        .eq("dossier_id", selectedDossier.id);

      const realDates = (data || [])
        .filter(
          (s: any) =>
            s.etat_seance === "réalisée" || s.etat_seance === "realisee"
        )
        .map((s: any) => s.date_seance as string)
        .filter(Boolean)
        .sort();
      setLastRealDate(realDates.length ? realDates[realDates.length - 1] : null);
    })();
  }, [selectedDossier]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients.slice(0, 50);
    const parts = q.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return patients.filter(
        (p) =>
          p.nom.toLowerCase().includes(parts[0]) ||
          p.prenom.toLowerCase().includes(parts[0])
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
  }, [patients, search]);

  const getNextSeanceNumber = async (dossierId: string) => {
    const { data } = await supabase
      .from("seances")
      .select("numero_seance")
      .eq("dossier_id", dossierId)
      .order("numero_seance", { ascending: false })
      .limit(1);
    return data && data.length > 0 ? data[0].numero_seance + 1 : 1;
  };

  const handleSave = async () => {
    setErr("");

    // borne min (pas de passé / ni < dernière réalisée)
    if (date < minDate) {
      setErr(`Impossible de programmer à une date < ${minDate}.`);
      return;
    }

    if (!selectedDossier) {
      setErr("Veuillez sélectionner un dossier non clôturé avec des séances restantes à programmer.");
      return;
    }

    // ➜ CONTRÔLE MAX (avant insert)
    try {
      const { remaining, max } = await remainingSlotsForDossier(
        selectedDossier.id
      );
      if (remaining <= 0) {
        setErr(
          max
            ? `Limite atteinte : ce dossier a déjà ${max} séance(s).`
            : "Limite atteinte."
        );
        return;
      }
    } catch (e: any) {
      setErr(e?.message || "Impossible de vérifier le nombre de séances.");
      return;
    }

    // minute + durée
    const mm = (minute || "00").replace(/[^\d]/g, "").slice(0, 2).padStart(2, "0");
    const mmNum = Number(mm);
    if (Number.isNaN(mmNum) || mmNum < 0 || mmNum > 59) {
      setErr("Minutes invalides (0–59).");
      return;
    }
    const dureeNum = duree === "" ? null : Number(duree);
    if (dureeNum !== null && (Number.isNaN(dureeNum) || dureeNum < 0)) {
      setErr("Durée invalide (minutes ≥ 0).");
      return;
    }

    const numero = await getNextSeanceNumber(selectedDossier.id);
    const heure = `${String(fixedHour).padStart(2, "0")}:${mm}:00`;

    const { error } = await supabase.from("seances").insert({
      dossier_id: selectedDossier.id,
      numero_seance: numero,
      date_seance: date,
      heure_seance: heure,
      etat_seance: "programmée",
      prestataire_id: isAdmin ? prestataireId : user?.id,
      montant_paye: 0,
      duree_minutes: dureeNum,
      note: null,
    });
    if (error) {
      setErr(error.message || "Impossible d’enregistrer la programmation.");
      return;
    }
    onSuccess();
  };

  return (
    <Modal>
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Programmer à {toDateStrReadable(date)} — {String(fixedHour).padStart(2, "0")}:MM
          </h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Recherche + patient */}
        <PatientSearchBlock
          search={search}
          setSearch={setSearch}
          selectedPatient={selectedPatient}
          setSelectedPatient={setSelectedPatient}
          patients={patients}
        />

        {/* Dossiers en cours */}
        <DossiersGrid
          selectedPatient={selectedPatient}
          dossiers={dossiers}
          selectedDossier={selectedDossier}
          setSelectedDossier={setSelectedDossier}
          showNombre
        />

        {/* Heure/Minute/Durée */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ReadOnlyField label="Heure (fixée)" value={String(fixedHour).padStart(2, "0")} />
          <NumberText
            label="Minutes"
            value={minute}
            onChange={(v) => setMinute(v.replace(/[^\d]/g, "").slice(0, 2))}
            placeholder="MM"
          />
          <NumberText
            label="Durée (min)"
            value={duree}
            onChange={(v) => setDuree(v.replace(/[^\d]/g, "").slice(0, 4))}
            placeholder="ex: 45"
          />
        </div>

        {/* Prestataire */}
        {isAdmin && (
          <div className="mt-3">
            <label className="block text-sm text-gray-700 mb-1">Prestataire</label>
            <select
              value={prestataireId}
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

        {/* Infos borne min */}
        {selectedDossier && (
          <div className="mt-2 text-xs text-gray-600">
            Date minimale autorisée : <b>{minDate}</b>
          </div>
        )}

        {err && <ErrorNote text={err} />}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            {saving ? "Enregistrement…" : "Programmer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ================== Ajouter réalisée ici / Conversion — LOGIQUE BORNES + QUOTA + BLOCADE SI PROGRAMMÉES ================== */
function AddRealHereModal({
  date,
  fixedHour,
  isAdmin,
  currentUserId,
  onClose,
  onSuccess,
  scheduledSeance, // optionnel: si présent => conversion d'une programmée
}: {
  date: string;
  fixedHour: number;
  isAdmin: boolean;
  currentUserId: string;
  onClose: () => void;
  onSuccess: () => void;
  scheduledSeance?: (Seance & { dossier?: DossierSoin; patient?: Patient }) | null;
}) {
  const { userBase } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dossiers, setDossiers] = useState<DossierSoin[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(scheduledSeance?.patient || null);
  const [selectedDossier, setSelectedDossier] = useState<DossierSoin | null>(scheduledSeance?.dossier || null);
  const [users, setUsers] = useState<UserBase[]>([]);
  const [prestataireId, setPrestataireId] = useState<string>(currentUserId);

  const [minute, setMinute] = useState<string>("00");
  const [montant, setMontant] = useState<string>(scheduledSeance ? String(scheduledSeance.montant_paye ?? 0) : "0");
  const [note, setNote] = useState<string>(scheduledSeance?.note || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const today = toDateStr(new Date());
  const dateOK = isAdmin ? date <= today : date === today;

  // --- BORNES dernière RÉALISÉE du dossier (date + heure)
  const [lastRealDate, setLastRealDate] = useState<string | null>(null); // "YYYY-MM-DD"
  const [lastRealTime, setLastRealTime] = useState<string | null>(null); // "HH:MM"

  // --- Compte des séances programmées pour le dossier sélectionné (blocage ajout si >0)
  const [scheduledCount, setScheduledCount] = useState<number>(0);
  const [scheduledCountLoading, setScheduledCountLoading] = useState(false);

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

  useEffect(() => {
    (async () => {
      if (!selectedPatient || scheduledSeance) {
        if (!selectedPatient) {
          setDossiers([]);
          setSelectedDossier(null);
        }
        return;
      }
      // Dossiers a_venir/en_cours
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

  // Charger la DERNIÈRE séance réalisée pour le dossier choisi
  useEffect(() => {
    (async () => {
      setLastRealDate(null);
      setLastRealTime(null);
      if (!selectedDossier) return;
      const { data } = await supabase
        .from("seances")
        .select("etat_seance, date_seance, heure_seance")
        .eq("dossier_id", selectedDossier.id)
        .in("etat_seance", ["réalisée", "realisee"])
        .order("date_seance", { ascending: false })
        .order("heure_seance", { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setLastRealDate(data[0].date_seance as string);
        setLastRealTime(
          data[0].heure_seance
            ? String(data[0].heure_seance).slice(0, 5)
            : "00:00"
        );
      }
    })();
  }, [selectedDossier]);

  // Charger le nombre de programmées du dossier sélectionné (sauf en conversion)
  useEffect(() => {
    (async () => {
      if (!selectedDossier || scheduledSeance) {
        setScheduledCount(0);
        return;
      }
      setScheduledCountLoading(true);
      const { count, data, error } = await supabase
        .from("seances")
        .select("id", { count: "exact", head: true })
        .eq("dossier_id", selectedDossier.id)
        .in("etat_seance", ["programmée", "programmee"] as any);

      if (!error) {
        setScheduledCount(typeof count === "number" ? count : (data?.length ?? 0));
      } else {
        setScheduledCount(0);
      }
      setScheduledCountLoading(false);
    })();
  }, [selectedDossier, scheduledSeance]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients.slice(0, 50);
    const parts = q.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return patients.filter(
        (p) =>
          p.nom.toLowerCase().includes(parts[0]) ||
          p.prenom.toLowerCase().includes(parts[0])
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
  }, [patients, search]);

  const getNextSeanceNumber = async (dossierId: string) => {
    const { data } = await supabase
      .from("seances")
      .select("numero_seance")
      .eq("dossier_id", dossierId)
      .order("numero_seance", { ascending: false })
      .limit(1);
    return data && data.length > 0 ? data[0].numero_seance + 1 : 1;
  };

  const sameDayAsLast = !!lastRealDate && date === lastRealDate;
  const lastHH = lastRealTime ? lastRealTime.slice(0, 2) : null;
  const lastMM = lastRealTime ? lastRealTime.slice(3, 5) : null;

  const hourTooSmall = sameDayAsLast && lastHH ? fixedHour < Number(lastHH) : false;

  const minuteNum = Number((minute || "").replace(/[^\d]/g, ""));
  const minuteTooSmallOrEqual =
    sameDayAsLast &&
    lastHH &&
    lastMM &&
    fixedHour === Number(lastHH) &&
    (!Number.isFinite(minuteNum) || minuteNum <= Number(lastMM));

  const dateBeforeLast = !!lastRealDate && date < lastRealDate;

  const handleSave = async () => {
    setErr("");

    // MODE CONVERSION d'une programmée -> réalisée
    if (scheduledSeance) {
      // 🔒 Interdire conversion si FUTUR
      const sDate = scheduledSeance.date_seance as string;
      const sHH = extractHour(scheduledSeance.heure_seance);
      const sMM = extractMinute(scheduledSeance.heure_seance);
      if (isFutureDateTime(sDate, sHH, sMM)) {
        setErr("Impossible de marquer comme réalisée une séance future.");
        return;
      }

      const montantNum = parseFloat(montant || "0");
      if (!Number.isFinite(montantNum) || montantNum < 0) {
        setErr("Montant invalide.");
        return;
      }

      setSaving(true);
      try {
        const { error: updErr } = await supabase
          .from("seances")
          .update({
            etat_seance: "réalisée" as EtatSeance,
            prestataire_id: prestataireId,
            montant_paye: montantNum,
            note: note || null,
          })
          .eq("id", scheduledSeance.id);
        if (updErr) throw updErr;
        onSuccess();
      } catch (e: any) {
        setErr(e?.message || "Erreur lors de l’enregistrement.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // --- AJOUT d'une nouvelle séance RÉALISÉE
    if (!dateOK) {
      setErr("Date non autorisée.");
      return;
    }
    if (!selectedDossier) {
      setErr("Sélectionnez un dossier.");
      return;
    }

    // 🔒 Re-vérification à la volée : des séances programmées pour ce dossier ?
    {
      const { count, data, error } = await supabase
        .from("seances")
        .select("id", { count: "exact", head: true })
        .eq("dossier_id", selectedDossier.id)
        .in("etat_seance", ["programmée", "programmee"] as any);

      const nbProg = !error ? (typeof count === "number" ? count : (data?.length ?? 0)) : 0;
      if (nbProg > 0) {
        setErr(
          `Impossible d’ajouter une séance réalisée : ${nbProg} séance(s) programmée(s) existent pour ce dossier. ` +
          `Veuillez d’abord les enregistrer comme réalisées ou les supprimer.`
        );
        return;
      }
    }

    // ➜ CONTRÔLE MAX (avant insert)
    try {
      const { remaining, max } = await remainingSlotsForDossier(
        selectedDossier.id
      );
      if (remaining <= 0) {
        setErr(
          max
            ? `Limite atteinte : ce dossier a déjà ${max} séance(s).`
            : "Limite atteinte."
        );
        return;
      }
    } catch (e: any) {
      setErr(e?.message || "Impossible de vérifier le nombre de séances.");
      return;
    }

    // minutes format
    const mm = (minute || "00").replace(/[^\d]/g, "").slice(0, 2).padStart(2, "0");
    const mmNum = Number(mm);
    if (Number.isNaN(mmNum) || mmNum < 0 || mmNum > 59) {
      setErr("Minutes invalides (0–59).");
      return;
    }
    // BORNES vs dernière réalisée
    if (lastRealDate && lastRealTime) {
      if (date < lastRealDate) {
        setErr(
          `Date invalide : doit être ≥ ${new Date(lastRealDate).toLocaleDateString("fr-FR")}.`
        );
        return;
      }
      if (date === lastRealDate) {
        if (fixedHour < Number(lastHH)) {
          setErr(`Heure invalide : doit être ≥ ${lastRealTime}.`);
          return;
        }
        if (fixedHour === Number(lastHH) && mmNum <= Number(lastMM)) {
          setErr(`Minutes invalides : doit être > ${lastRealTime}.`);
          return;
        }
      }
    }

    const montantNum = parseFloat(montant || "0");
    if (!Number.isFinite(montantNum) || montantNum < 0) {
      setErr("Montant invalide.");
      return;
    }

    setSaving(true);
    try {
      const numero = await getNextSeanceNumber(selectedDossier.id);
      const heure = `${String(fixedHour).padStart(2, "0")}:${mm}:00`;

      const { error } = await supabase.from("seances").insert({
        dossier_id: selectedDossier.id,
        numero_seance: numero,
        date_seance: date,
        heure_seance: heure,
        etat_seance: "réalisée",
        prestataire_id: isAdmin ? prestataireId : currentUserId,
        montant_paye: montantNum,
        note: note || null,
      });
      if (error) {
        setErr(error.message || "Impossible d’ajouter la séance.");
        return;
      }
      onSuccess();
    } catch (e: any) {
      setErr(e?.message || "Erreur lors de l’enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const disableSave =
    (scheduledSeance
      ? (() => {
          // désactiver si future (conversion)
          const sDate = scheduledSeance!.date_seance as string;
          const sHH = extractHour(scheduledSeance!.heure_seance);
          const sMM = extractMinute(scheduledSeance!.heure_seance);
          return isFutureDateTime(sDate, sHH, sMM);
        })()
      : (
          !dateOK ||
          !selectedDossier ||
          dateBeforeLast ||
          (sameDayAsLast && lastHH && fixedHour < Number(lastHH)) ||
          (sameDayAsLast &&
            lastHH &&
            lastMM &&
            fixedHour === Number(lastHH) &&
            minuteNum <= Number(lastMM)) ||
          (!scheduledSeance && selectedDossier && scheduledCount > 0)
        )
    ) || saving;

  return (
    <Modal>
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {scheduledSeance
              ? `Enregistrer la réalisation — ${toDateStrReadable(date)} • ${String(fixedHour).padStart(2, "0")}:MM`
              : `Ajouter une séance — ${toDateStrReadable(date)} • ${String(fixedHour).padStart(2, "0")}:MM`}
          </h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Patient / recherche (non affiché en conversion) */}
        {!scheduledSeance && (
          <PatientSearchBlock
            search={search}
            setSearch={setSearch}
            selectedPatient={selectedPatient}
            setSelectedPatient={(p) => {
              setSelectedPatient(p);
              setSelectedDossier(null);
            }}
            patients={patients}
          />
        )}

        {/* Dossier */}
        {!scheduledSeance && (
          <DossiersGrid
            selectedPatient={selectedPatient}
            dossiers={dossiers}
            selectedDossier={selectedDossier!}
            setSelectedDossier={setSelectedDossier}
          />
        )}

        {/* Alerte: séances programmées à traiter (ajout uniquement, pas conversion) */}
        {!scheduledSeance && selectedDossier && scheduledCount > 0 && (
          <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
            Ce dossier comporte <b>{scheduledCount}</b> séance(s) programmée(s).
            <br />
            Traitez ces séances (réaliser ou supprimer) avant d’ajouter une nouvelle séance réalisée.
          </div>
        )}

        {/* HH (fixe) + MM + paiement + note + prestataire */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ReadOnlyField label="Heure (fixée)" value={String(fixedHour).padStart(2, "0")} />
          <div>
            <label className="block text-sm text-gray-700 mb-1">Minutes</label>
            <input
              value={minute}
              onChange={(e) =>
                setMinute(e.target.value.replace(/[^\d]/g, "").slice(0, 2))
              }
              placeholder="MM"
              className={`w-full border rounded px-3 py-2 ${
                sameDayAsLast &&
                lastHH &&
                fixedHour === Number(lastHH) &&
                minuteTooSmallOrEqual
                  ? "border-red-300"
                  : "border-gray-300"
              }`}
              disabled={!!scheduledSeance} // conversion : on garde l'heure/minute existantes
            />
            {sameDayAsLast && lastRealTime && fixedHour === Number(lastHH) && !scheduledSeance && (
              <p
                className={`text-xs mt-1 ${
                  minuteTooSmallOrEqual ? "text-red-600" : "text-gray-500"
                }`}
              >
                Minutes &gt; {lastRealTime}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">
              Montant payé (DT)
            </label>
            <input
              type="number"
              step="0.01"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        {/* Prestataire */}
        <div className="mt-3">
          <label className="block text-sm text-gray-700 mb-1">Prestataire</label>
          <input
            value={isAdmin ? undefined : "Vous"}
            disabled={!isAdmin}
            placeholder={isAdmin ? "" : "Vous"}
            className={`w-full border rounded px-3 py-2 ${
              isAdmin ? "bg-white" : "bg-gray-50 text-gray-600"
            }`}
            onChange={() => {}}
          />
          {isAdmin && (
            <select
              value={prestataireId}
              onChange={(e) => setPrestataireId(e.target.value)}
              className="mt-2 w-full border rounded px-3 py-2 bg-white"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.prenom} {u.nom}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Infos borne */}
        {selectedDossier && lastRealDate && !scheduledSeance && (
          <div className="mt-2 text-xs">
            <span className="text-gray-600">
              Dernière séance réalisée le{" "}
              <b>
                {new Date(lastRealDate).toLocaleDateString("fr-FR")} à{" "}
                {lastRealTime || ""}
              </b>
            </span>
            {(dateBeforeLast || hourTooSmall) && (
              <div className="mt-1 text-red-600">
                La nouvelle séance doit être postérieure à cette date/heure.
              </div>
            )}
          </div>
        )}

        {err && <ErrorNote text={err} />}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={disableSave}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded disabled:opacity-50"
          >
            {saving
              ? "Enregistrement…"
              : scheduledSeance
              ? "Marquer comme réalisée"
              : "Ajouter"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ================== Petits composants réutilisables ================== */
function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1000]">
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
}

function PatientSearchBlock({
  search,
  setSearch,
  selectedPatient,
  setSelectedPatient,
  patients,
}: {
  search: string;
  setSearch: (v: string) => void;
  selectedPatient: Patient | null;
  setSelectedPatient: (p: Patient | null) => void;
  patients: Patient[];
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients.slice(0, 50);
    const parts = q.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return patients.filter(
        (p) =>
          p.nom.toLowerCase().includes(parts[0]) ||
          p.prenom.toLowerCase().includes(parts[0])
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
  }, [patients, search]);

  return (
    <div className="mt-3">
      <label className="block text-sm text-gray-700 mb-1">Patient</label>
      <div className="relative">
        <div className="flex items-center gap-2 border rounded px-2 py-1">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            value={selectedPatient ? `${selectedPatient.prenom} ${selectedPatient.nom}` : search}
            onChange={(e) => {
              if (selectedPatient) return;
              setSearch(e.target.value);
            }}
            placeholder="Rechercher…"
            className="flex-1 outline-none py-1"
          />
          {selectedPatient && (
            <button
              type="button"
              onClick={() => {
                setSelectedPatient(null);
                setSearch("");
              }}
              className="text-gray-500 hover:text-gray-700"
              title="Effacer la sélection"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {!!search.trim() && !selectedPatient && (
          <div className="absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-56 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">Aucun résultat</div>
            ) : (
              filtered.slice(0, 30).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPatient(p)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-50 text-sm"
                >
                  {p.prenom} {p.nom}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DossiersGrid({
  selectedPatient,
  dossiers,
  selectedDossier,
  setSelectedDossier,
  showNombre = false,
}: {
  selectedPatient: Patient | null;
  dossiers: DossierSoin[];
  selectedDossier: DossierSoin | null;
  setSelectedDossier: (d: DossierSoin | null) => void;
  showNombre?: boolean;
}) {
  return (
    <div className="mt-3">
      <label className="block text-sm text-gray-700 mb-1">
        Dossier{selectedPatient ? " non clôturé" : ""}
      </label>
      {!selectedPatient ? (
        <div className="text-sm text-gray-500">
          Choisissez d’abord un patient.
        </div>
      ) : dossiers.length === 0 ? (
        <div className="text-sm text-gray-500">
          Aucun dossier non clôturé avec des séances restante à programmer pour ce patient.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {dossiers.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDossier(d)}
              className={`p-3 rounded border text-left hover:bg-gray-50 ${
                selectedDossier?.id === d.id
                  ? "border-teal-500 ring-1 ring-teal-200"
                  : ""
              }`}
            >
              <div className="font-medium">{d.motif}</div>
              <div className="text-xs text-gray-500 mt-1">
                {showNombre && d.nombre_seances
                  ? `${d.nombre_seances} prévues • `
                  : ""}
                {d.etat}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-sm text-gray-700 mb-1">{label}</label>
      <input
        value={value}
        disabled
        className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-600"
      />
    </div>
  );
}
function NumberText({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-700 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border rounded px-3 py-2"
      />
    </div>
  );
}
function ErrorNote({ text }: { text: string }) {
  return (
    <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">
      {text}
    </div>
  );
}
