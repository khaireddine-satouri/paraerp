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
  X,
  Search,
  Eye,
  CheckCircle2,
  SquarePen,
  Download,
  Filter,
} from "lucide-react";

import EditSeanceModal from "./EditSeanceModal";
import EditScheduledSeanceModal from "./EditScheduledSeanceModal";
import {
  exportProgrammationsPDFByDay,
  exportProgrammationsExcelByDay,
  PlanningExportRow,
} from "../utils/planningExport";

/* ------------------ Utils communs ------------------ */
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
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const hh = get("hour");
  const mi = get("minute");
  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    hour: Number(hh || "0"),
    minute: Number(mi || "0"),
  };
}
// ➜ version “heure de Tunis”
function isFutureDateTimeInTZ(dateISO: string, hh: number, mm: number, tz = "Africa/Tunis") {
  const { dateStr, hour, minute } = nowInTZ(tz);
  if (dateISO > dateStr) return true;
  if (dateISO < dateStr) return false;
  if (hh > hour) return true;
  if (hh < hour) return false;
  return mm > minute;
}

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

// dernière programmée & dernière réalisée (pour un dossier)
async function getLastForDossier(dossierId: string) {
  const [prog, real] = await Promise.all([
    supabase
      .from("seances")
      .select("date_seance, heure_seance")
      .eq("dossier_id", dossierId)
      .in("etat_seance", ["programmée", "programmee"] as any)
      .order("date_seance", { ascending: false })
      .order("heure_seance", { ascending: false })
      .limit(1),
    supabase
      .from("seances")
      .select("date_seance, heure_seance")
      .eq("dossier_id", dossierId)
      .in("etat_seance", ["réalisée", "realisee"] as any)
      .order("date_seance", { ascending: false })
      .order("heure_seance", { ascending: false })
      .limit(1),
  ]);

  const lastProg = prog.data && prog.data[0];
  const lastReal = real.data && real.data[0];
  return {
    lastProgDate: lastProg ? (lastProg.date_seance as string) : null,
    lastProgTime: lastProg?.heure_seance ? String(lastProg.heure_seance).slice(0, 5) : null,
    lastRealDate: lastReal ? (lastReal.date_seance as string) : null,
    lastRealTime: lastReal?.heure_seance ? String(lastReal.heure_seance).slice(0, 5) : null,
  };
}

/** Types d'état (DB avec/ sans accents tolérés) */
type EtatSeance = "programmée" | "programmee" | "réalisée" | "realisee";

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
  const [etatFilter, setEtatFilter] = useState<"programmée" | "réalisée">("programmée");

  // Filtre prestataire (admin)
  const [prestataires, setPrestataires] = useState<UserBase[]>([]);
  const [prestataireFilter, setPrestataireFilter] = useState<string>("all"); // "all" | userId

  // Plage d’affichage (slot)
  const [slotMinutes, setSlotMinutes] = useState<30 | 60>(60);

  const todayStr = useMemo(() => toDateStr(new Date()), []);
  const [anchorDate, setAnchorDate] = useState<string>(todayStr);

  // Sélecteurs Mois/Année (vue mois)
  const anchor = useMemo(() => new Date(anchorDate), [anchorDate]);
  const [monthSelect, setMonthSelect] = useState<number>(anchor.getMonth());
  const [yearSelect, setYearSelect] = useState<number>(anchor.getFullYear());

  useEffect(() => {
    const d = new Date(anchorDate);
    setMonthSelect(d.getMonth());
    setYearSelect(d.getFullYear());
  }, [anchorDate]);

  const yearsRange = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 9 }, (_, i) => y - 4 + i);
  }, []);

  // Charger prestataires (admin)
  useEffect(() => {
    (async () => {
      if (!isAdmin || !userBase?.client_id) return;
      const { data } = await supabase
        .from("users_base")
        .select("id, nom, prenom")
        .eq("client_id", userBase.client_id)
        .order("nom");
      setPrestataires((data || []) as UserBase[]);
    })();
  }, [isAdmin, userBase?.client_id]);

  // Période affichée
  const startEnd = useMemo(() => {
    const d = new Date(anchorDate);
    if (mode === "day") {
      const start = toDateStr(d);
      const end = toDateStr(addDays(d, 1));
      return { start, end };
    }
    if (mode === "week") {
      const wd = d.getDay(); // 0 dim … 6 sam
      const monday = addDays(d, -((wd + 6) % 7));
      const start = toDateStr(monday);
      const end = toDateStr(addDays(monday, 7));
      return { start, end };
    }
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { start: toDateStr(first), end: toDateStr(nextMonth) };
  }, [anchorDate, mode]);

  // Slots (8:00 → 21:00 exclusive)
  type Slot = { hour: number; minute: number };
  const slots: Slot[] = useMemo(() => {
    const res: Slot[] = [];
    for (let h = 8; h < 21; h++) {
      if (slotMinutes === 60) {
        res.push({ hour: h, minute: 0 });
      } else {
        res.push({ hour: h, minute: 0 });
        res.push({ hour: h, minute: 30 });
      }
    }
    return res;
  }, [slotMinutes]);

  // Données
  const [rows, setRows] = useState<
    (Seance & {
      dossier?: DossierSoin;
      patient?: Patient;
      prestataire?: UserBase;
    })[]
  >([]);
  const [loading, setLoading] = useState(true);

  // Slot sélectionné
  const [slot, setSlot] = useState<{ date: string; hour: number; minute: number } | null>(null);

  // Modales internes
  const [showProgramHere, setShowProgramHere] = useState(false);
  const [showAddRealHere, setShowAddRealHere] = useState(false);

  // Modales d’édition
  const [editScheduled, setEditScheduled] =
    useState<Seance & { dossier?: DossierSoin; patient?: Patient } | null>(null);
  const [editRealized, setEditRealized] =
    useState<Seance & { dossier?: DossierSoin; patient?: Patient } | null>(null);
  const [realizeFromScheduled, setRealizeFromScheduled] =
    useState<Seance & { dossier?: DossierSoin; patient?: Patient } | null>(null);

  // Export (programmées)
  const [pdfFrom, setPdfFrom] = useState<string>(todayStr);
  const [pdfTo, setPdfTo] = useState<string>(todayStr);

  // Refresh + Realtime
  const [reloadNonce, setReloadNonce] = useState(0);
  const refresh = () => setReloadNonce((n) => n + 1);

  useEffect(() => {
    (async () => {
      if (!userBase?.client_id) return;
      setLoading(true);
      try {
        const clientId = userBase.client_id;

        const etatColValues: EtatSeance[] =
          etatFilter === "programmée"
            ? ["programmée", "programmee"]
            : ["réalisée", "realisee"];

        let q = supabase
          .from("seances")
          .select("*")
          .gte("date_seance", startEnd.start)
          .lt("date_seance", startEnd.end)
          .in("etat_seance", etatColValues as any)
          .order("date_seance", { ascending: true })
          .order("heure_seance", { ascending: true });

        if (!isAdmin) {
          q = q.eq("prestataire_id", user?.id);
        } else if (prestataireFilter !== "all") {
          q = q.eq("prestataire_id", prestataireFilter);
        }

        const { data: seancesRaw, error: seErr } = await q;
        if (seErr) throw seErr;

        if (!seancesRaw || seancesRaw.length === 0) {
          setRows([]);
          setLoading(false);
          return;
        }

        const dossierIds = Array.from(new Set(seancesRaw.map((s: any) => s.dossier_id))).filter(Boolean);
        const { data: dossiers, error: dErr } = await supabase
          .from("dossiers_soins")
          .select("*")
          .in("id", dossierIds)
          .eq("client_id", clientId);
        if (dErr) throw dErr;
        const dossierById = new Map((dossiers || []).map((d: any) => [d.id, d]));

        const patientIds = Array.from(new Set((dossiers || []).map((d: any) => d.patient_id).filter(Boolean)));
        let patientsById = new Map<string, any>();
        if (patientIds.length > 0) {
          const { data: patients, error: pErr } = await supabase
            .from("patients")
            .select("*")
            .in("id", patientIds);
          if (pErr) throw pErr;
          patientsById = new Map((patients || []).map((p: any) => [p.id, p]));
        }

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
    prestataireFilter,
  ]);

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

  // Agrégations par date+slot
  const countByDateSlot = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows) {
      const date = s.date_seance;
      const hh = extractHour(s.heure_seance);
      const mm = extractMinute(s.heure_seance);
      const mmGroup = slotMinutes === 60 ? 0 : (mm < 30 ? 0 : 30);
      const key = `${date}|${String(hh).padStart(2, "0")}|${String(mmGroup).padStart(2, "0")}`;
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [rows, slotMinutes]);

  // Navigation
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

  // Grilles de dates
  const daysInView = useMemo(() => {
    if (mode === "day") return [anchorDate];
    if (mode === "week") {
      const d = new Date(anchorDate);
      const wd = d.getDay();
      const monday = addDays(d, -((wd + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(monday, i)));
    }
    const d = new Date(anchorDate);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const startMonday = addDays(first, -((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => toDateStr(addDays(startMonday, i)));
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
      const rangeTxt = `Semaine du ${toDateStrReadable(daysInView[0])} au ${toDateStrReadable(
        daysInView[6]
      )}`;
      return `${prefix} — ${rangeTxt}`;
    }
    const monthTxt = d.toLocaleDateString("fr-FR", { year: "numeric", month: "long" });
    return `${prefix} — ${monthTxt}`;
  }, [anchorDate, mode, daysInView, etatFilter]);

  // Liste séances d’un slot
  const sessionsOfSlot = (date: string, hour: number, minute: number) =>
    rows.filter((s) => {
      if (s.date_seance !== date) return false;
      const hh = extractHour(s.heure_seance);
      const mm = extractMinute(s.heure_seance);
      if (slotMinutes === 60) return hh === hour;
      const start = minute;
      const end = minute + 29;
      return hh === hour && mm >= start && mm <= end;
    });

  // Règles clics (heure de Tunis pour RÉALISÉE)
  const canProgramHere = (date: string) => {
    return isAdmin && etatFilter === "programmée" && date >= todayStr;
  };
  const canAddRealHere = (date: string, hour: number, minute: number) => {
    const { dateStr, hour: tnH, minute: tnM } = nowInTZ("Africa/Tunis");
    if (date > dateStr) return false;
    if (date < dateStr) return true;
    if (hour > tnH) return false;
    if (hour < tnH) return true;
    return minute <= tnM;
  };

  // Actions
  const openEditScheduled = (s: Seance & { dossier?: DossierSoin; patient?: Patient }) =>
    setEditScheduled(s);
  const openEditRealized = (s: Seance & { dossier?: DossierSoin; patient?: Patient }) =>
    setEditRealized(s);
  const openRealizeFromScheduled = (s: Seance & { dossier?: DossierSoin; patient?: Patient }) =>
    setRealizeFromScheduled(s);

  // Export (respecte filtre prestataire)
  const handleExport = async (kind: "pdf" | "excel") => {
    if (pdfFrom > pdfTo || pdfFrom < todayStr) {
      alert("Veuillez choisir une plage valide (à partir d’aujourd’hui).");
      return;
    }
    let q = supabase
      .from("seances")
      .select("*")
      .in("etat_seance", ["programmée", "programmee"] as any)
      .gte("date_seance", pdfFrom)
      .lte("date_seance", pdfTo)
      .order("date_seance", { ascending: true })
      .order("heure_seance", { ascending: true });

    if (!isAdmin) q = q.eq("prestataire_id", user?.id);
    else if (prestataireFilter !== "all") q = q.eq("prestataire_id", prestataireFilter);

    const { data: seancesRaw, error } = await q;
    if (error) {
      alert(error.message || "Erreur lors du chargement des séances.");
      return;
    }
    if (!seancesRaw || seancesRaw.length === 0) {
      alert("Aucune séance sur cette période.");
      return;
    }

    const dossierIds = Array.from(new Set(seancesRaw.map((s: any) => s.dossier_id))).filter(Boolean);
    const { data: dossiers } = await supabase.from("dossiers_soins").select("*").in("id", dossierIds);
    const dossierById = new Map((dossiers || []).map((d: any) => [d.id, d]));
    const patientIds = Array.from(new Set((dossiers || []).map((d: any) => d.patient_id).filter(Boolean)));
    const prestataireIds = Array.from(new Set(seancesRaw.map((s: any) => s.prestataire_id).filter(Boolean)));

    let patientsById = new Map<string, any>();
    if (patientIds.length > 0) {
      const { data: patients } = await supabase.from("patients").select("*").in("id", patientIds);
      patientsById = new Map((patients || []).map((p: any) => [p.id, p]));
    }
    let prestasById = new Map<string, any>();
    if (prestataireIds.length > 0) {
      const { data: prestas } = await supabase.from("users_base").select("id, nom, prenom").in("id", prestataireIds);
      prestasById = new Map((prestas || []).map((u: any) => [u.id, u]));
    }

    const exportRows: PlanningExportRow[] = (seancesRaw || [])
      .map((s: any) => {
        const d = dossierById.get(s.dossier_id);
        if (!d) return null;
        const p = patientsById.get(d.patient_id);
        const u = prestasById.get(s.prestataire_id);
        return {
          date: String(s.date_seance),
          heure: s.heure_seance ? String(s.heure_seance).slice(0, 5) : null,
          patient: p ? `${p.prenom} ${p.nom}` : "-",
          motif: d?.motif || "-",
          prestataire: u ? `${u.prenom} ${u.nom}` : "-",
          note: s.note || null,
          duree_minutes: s.duree_minutes ?? null,
        } as PlanningExportRow;
      })
      .filter(Boolean) as PlanningExportRow[];

    if (kind === "pdf") {
      exportProgrammationsPDFByDay(exportRows, pdfFrom, pdfTo, "Séances programmées");
    } else {
      exportProgrammationsExcelByDay(exportRows, pdfFrom, pdfTo);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header / Filtres — mobile-friendly layout */}
      <div className="bg-white rounded-xl shadow p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          {/* Titre */}
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">{titleLabel}</h2>
          </div>

          {/* Navigation principale */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button onClick={goPrev} className="p-2 rounded hover:bg-gray-100 shrink-0" title="Précédent">
                <ChevronLeft className="w-5 h-5" />
              </button>

              {mode === "month" ? (
                <div className="flex w-full gap-2">
                  <select
                    value={monthSelect}
                    onChange={(e) => {
                      const m = Number(e.target.value);
                      setMonthSelect(m);
                      onChangeMonthYear(m, yearSelect, setAnchorDate);
                    }}
                    className="w-full sm:w-auto flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg bg-white"
                    aria-label="Mois"
                  >
                    {Array.from({ length: 12 }, (_, i) => i).map((m) => (
                      <option key={m} value={m}>
                        {new Date(2000, m, 1).toLocaleDateString("fr-FR", { month: "long" })}
                      </option>
                    ))}
                  </select>

                  <select
                    value={yearSelect}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      setYearSelect(y);
                      onChangeMonthYear(monthSelect, y, setAnchorDate);
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

              <button onClick={goNext} className="p-2 rounded hover:bg-gray-100 shrink-0" title="Suivant">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Ligne filtres compactes */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                onClick={goToday}
                className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50"
                title="Aller à aujourd’hui"
              >
                Aujourd’hui
              </button>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                  <Filter className="w-4 h-4" /> Vue
                </span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded-lg bg-white"
                >
                  <option value="day">Jour</option>
                  <option value="week">Semaine</option>
                  <option value="month">Mois</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">État</span>
                <select
                  value={etatFilter}
                  onChange={(e) => setEtatFilter(e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded-lg bg-white"
                >
                  <option value="programmée">Programmées</option>
                  <option value="réalisée">Réalisées</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Plage</span>
                <select
                  value={slotMinutes}
                  onChange={(e) => setSlotMinutes(Number(e.target.value) as 30 | 60)}
                  className="px-3 py-2 border border-gray-300 rounded-lg bg-white"
                  title="Taille des créneaux"
                >
                  <option value={60}>1 h</option>
                  <option value={30}>30 min</option>
                </select>
              </div>

              {/* Filtre prestataire (admin) */}
              {isAdmin && (
                <div className="flex items-center gap-2 min-w-[200px]">
                  <span className="text-sm text-gray-600">Prestataire</span>
                  <select
                    value={prestataireFilter}
                    onChange={(e) => setPrestataireFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg bg-white w-full"
                  >
                    <option value="all">Tous</option>
                    {prestataires.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.prenom} {u.nom}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Export — groupe compact (affiché uniquement pour programmées) */}
            {/* Export — groupe compact (affiché uniquement pour programmées) */}
{etatFilter === "programmée" && (
  <div className="flex flex-col gap-2 sm:gap-3">
    {/* Ligne dates : empilée en mobile, en ligne sur ≥ sm */}
    <div className="w-full space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
      <div className="w-full min-w-0">
        {/* label mobile seulement */}
        <label className="block sm:hidden text-xs text-gray-500 mb-1">Début</label>
        <input
          type="date"
          min={todayStr}
          value={pdfFrom}
          onChange={(e) => setPdfFrom(e.target.value)}
          className="w-full min-w-0 px-3 py-2 border border-gray-300 rounded-lg"
          aria-label="Date de début"
          title="De"
        />
      </div>

      {/* flèche visible seulement en ≥sm */}
      <span className="hidden sm:inline text-gray-500">→</span>

      <div className="w-full min-w-0">
        {/* label mobile seulement */}
        <label className="block sm:hidden text-xs text-gray-500 mb-1">Fin</label>
        <input
          type="date"
          min={todayStr}
          value={pdfTo}
          onChange={(e) => setPdfTo(e.target.value)}
          className="w-full min-w-0 px-3 py-2 border border-gray-300 rounded-lg"
          aria-label="Date de fin"
          title="À"
        />
      </div>
    </div>

    {/* Ligne boutons */}
    <div className="flex items-center gap-2">
      <button
        onClick={() => handleExport("pdf")}
        className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
        title="Exporter PDF (1 page par jour)"
      >
        <Download className="w-4 h-4" />
        PDF
      </button>

      <button
        onClick={() => handleExport("excel")}
        className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
        title="Exporter Excel (1 onglet par jour)"
      >
        <Download className="w-4 h-4" />
        Excel
      </button>
    </div>
  </div>
)}

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
            slots={slots}
            countByDateSlot={countByDateSlot}
            loading={loading}
            onClickCell={(date, hour, minute) => setSlot({ date, hour, minute })}
            today={todayStr}
            etatFilter={etatFilter}
            slotMinutes={slotMinutes}
          />
        )}
      </div>

      {/* Drawer du créneau */}
      {slot && (
        <SlotDrawer
          date={slot.date}
          hour={slot.hour}
          minute={slot.minute}
          items={sessionsOfSlot(slot.date, slot.hour, slot.minute)}
          onClose={() => setSlot(null)}
          onOpenDossier={onOpenDossier}
          etatFilter={etatFilter}
          canProgramHere={canProgramHere(slot.date)}
          canAddRealHere={canAddRealHere(slot.date, slot.hour, slot.minute)}
          onProgram={() => setShowProgramHere(true)}
          onAddReal={() => setShowAddRealHere(true)}
          onEditScheduled={openEditScheduled}
          onEditRealized={openEditRealized}
          onRealizeScheduled={openRealizeFromScheduled}
          isAdmin={isAdmin}
          today={todayStr}
          slotMinutes={slotMinutes}
        />
      )}

      {/* Programmer ici */}
      {showProgramHere && slot && (
        <ProgramHereModal
          date={slot.date}
          fixedHour={slot.hour}
          fixedMinute={slot.minute}
          onClose={() => setShowProgramHere(false)}
          onSuccess={() => {
            setShowProgramHere(false);
            refresh();
          }}
        />
      )}

      {/* Ajouter RÉALISÉE ici / Conversion */}
      {showAddRealHere && slot && (
        <AddRealHereModal
          date={slot.date}
          fixedHour={slot.hour}
          fixedMinute={slot.minute}
          isAdmin={isAdmin}
          currentUserId={user?.id || ""}
          onClose={() => setShowAddRealHere(false)}
          onSuccess={() => {
            setShowAddRealHere(false);
            refresh();
          }}
        />
      )}

      {/* Édit programmé */}
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

      {/* Édit réalisée */}
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

      {/* Conversion programmée → réalisée */}
      {realizeFromScheduled && (
        <AddRealHereModal
          date={realizeFromScheduled.date_seance}
          fixedHour={extractHour(realizeFromScheduled.heure_seance)}
          fixedMinute={extractMinute(realizeFromScheduled.heure_seance)}
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
  slots,
  countByDateSlot,
  onClickCell,
  loading,
  today,
  etatFilter,
  slotMinutes,
}: {
  days: string[];
  slots: { hour: number; minute: number }[];
  countByDateSlot: Map<string, number>;
  onClickCell: (date: string, hour: number, minute: number) => void;
  loading: boolean;
  today: string;
  etatFilter: "programmée" | "réalisée";
  slotMinutes: 30 | 60;
}) {
  const { dateStr: tnDate, hour: tnH, minute: tnM } = nowInTZ("Africa/Tunis");

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full table-fixed border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white z-10 text-left p-3 border-b border-gray-200 text-gray-600 w-28">
              Heure
            </th>
            {days.map((d) => (
              <th
                key={d}
                className={`text-left p-3 border-b border-gray-200 text-gray-600 min-w-[170px] ${
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
          {slots.map(({ hour, minute }, idx) => {
            const isLast = idx === slots.length - 1;
            const rowBottom = isLast ? "border-b border-gray-200" : "";

            const label =
              slotMinutes === 60
                ? `${String(hour).padStart(2, "0")}h–${String(hour + 1).padStart(2, "0")}h`
                : `${String(hour).padStart(2, "0")}h${String(minute).padStart(2, "0")}–${
                    minute === 0 ? `${String(hour).padStart(2, "0")}h30` : `${String(hour + 1).padStart(2, "0")}h00`
                  }`;

            return (
              <tr key={`${hour}:${minute}`}>
                <td className={`sticky left-0 bg-white z-10 p-3 text-gray-700 font-medium border-r border-gray-200 border-t ${rowBottom}`}>
                  {label}
                </td>

                {days.map((d) => {
                  const mmGroup = slotMinutes === 60 ? 0 : minute;
                  const k = `${d}|${String(hour).padStart(2, "0")}|${String(mmGroup).padStart(2, "0")}`;
                  const c = countByDateSlot.get(k) || 0;

                  // Désactivation : pour RÉALISÉE utiliser l'heure de Tunis
                  const pastDate = d < today;
                  const futureLocal =
                    d > today ||
                    (d === today &&
                      (hour > new Date().getHours() ||
                        (hour === new Date().getHours() && minute > new Date().getMinutes())));

                  const futureTN =
                    d > tnDate || (d === tnDate && (hour > tnH || (hour === tnH && minute > tnM)));

                  const disabled =
                    etatFilter === "programmée" ? pastDate : futureTN;

                  return (
                    <td
                      key={k}
                      className={`p-2 align-top border-l border-gray-200 border-t ${rowBottom} ${
                        d === today ? "bg-teal-50/50" : ""
                      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50"}`}
                      onClick={() => {
                        if (!disabled) onClickCell(d, hour, minute);
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
            className={`bg-white p-3 text-left hover:bg-gray-50 ${d === today ? "bg-teal-50" : ""}`}
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

/* ================== Slot drawer ================== */
function SlotDrawer({
  date,
  hour,
  minute,
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
  slotMinutes,
}: {
  date: string;
  hour: number;
  minute: number;
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
  onEditScheduled: (s: Seance & { dossier?: DossierSoin; patient?: Patient }) => void;
  onEditRealized: (s: Seance & { dossier?: DossierSoin; patient?: Patient }) => void;
  onRealizeScheduled: (s: Seance & { dossier?: DossierSoin; patient?: Patient }) => void;
  isAdmin: boolean;
  today: string;
  slotMinutes: 30 | 60;
}) {
  const isProg = etatFilter === "programmée";
  const enabled = isProg ? canProgramHere : canAddRealHere;

  const canOpen = (s: Seance) => Boolean(s.dossier && s.patient);
  const isProgrammee = (s: Seance) => isProgrammeeState(s.etat_seance);

  const slotRangeLabel =
    slotMinutes === 60
      ? `${String(hour).padStart(2, "0")}h–${String(hour + 1).padStart(2, "0")}h`
      : `${String(hour).padStart(2, "0")}h${String(minute).padStart(2, "0")}–${
          minute === 0 ? `${String(hour).padStart(2, "0")}h30` : `${String(hour + 1).padStart(2, "0")}h00`
        }`;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl p-4 sm:p-6 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {toDateStrReadable(date)} — {slotRangeLabel}
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
            {isProg ? (isAdmin ? "Programmer ici" : "Non autorisé") : "Ajouter séance ici"}
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
                const timeLabel = s.heure_seance ? String(s.heure_seance).slice(0, 5) : "—";

                const sHH = extractHour(s.heure_seance);
                const sMM = extractMinute(s.heure_seance);
                const isFutureTN = isFutureDateTimeInTZ(s.date_seance as string, sHH, sMM, "Africa/Tunis");
                const canRealizeScheduled = scheduled && !isFutureTN;

                return (
                  <div key={s.id} className="w-full p-3 rounded border hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {s.patient ? `${s.patient.prenom} ${s.patient.nom}` : "Patient"}
                        </div>
                        <div className="text-sm text-gray-600 mt-0.5">
                          {s.dossier?.motif || "Dossier"} •{" "}
                          {s.prestataire ? `${s.prestataire.prenom} ${s.prestataire.nom}` : "—"} • {timeLabel}{" "}
                          {s.duree_minutes ? `• ${s.duree_minutes} min` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          disabled={!openable}
                          onClick={() => openable && onOpenDossier(s.dossier!, s.patient!)}
                          className={`p-2 rounded-lg transition ${
                            openable ? "text-blue-600 hover:bg-blue-50" : "text-gray-300 cursor-not-allowed"
                          }`}
                          title={openable ? "Voir le dossier" : "Dossier indisponible"}
                        >
                          <Eye className="w-5 h-5" />
                        </button>

                        {scheduled ? (
                          <>
                            <button
                              onClick={() => canRealizeScheduled && onRealizeScheduled(s as any)}
                              disabled={!canRealizeScheduled}
                              className={`p-2 rounded-lg transition ${
                                canRealizeScheduled ? "text-emerald-700 hover:bg-emerald-50" : "text-gray-300 cursor-not-allowed"
                              }`}
                              title={canRealizeScheduled ? "Enregistrer la réalisation" : "Non autorisé sur une séance future (heure de Tunis)"}
                            >
                              <CheckCircle2 className="w-5 h-5" />
                            </button>
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

/* ================== Programmer ici ================== */
function ProgramHereModal({
  date,
  fixedHour,
  fixedMinute,
  onClose,
  onSuccess,
}: {
  date: string;
  fixedHour: number;
  fixedMinute: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === "admin";
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dossiers, setDossiers] = useState<DossierSoin[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDossier, setSelectedDossier] = useState<DossierSoin | null>(null);
  const [prestataires, setPrestataires] = useState<UserBase[]>([]);
  const [prestataireId, setPrestataireId] = useState<string>(user?.id || "");

  const [minute, setMinute] = useState<string>(String(fixedMinute).padStart(2, "0"));
  const [duree, setDuree] = useState<string>("");

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const { dateStr: todayTN, hour: nowH_TN, minute: nowM_TN } = useMemo(
    () => nowInTZ("Africa/Tunis"),
    []
  );

  // bornes dossier
  const [lastProgDate, setLastProgDate] = useState<string | null>(null);
  const [lastProgTime, setLastProgTime] = useState<string | null>(null);
  const [lastRealDate, setLastRealDate] = useState<string | null>(null);
  const [lastRealTime, setLastRealTime] = useState<string | null>(null);

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

  useEffect(() => {
    (async () => {
      setLastProgDate(null);
      setLastProgTime(null);
      setLastRealDate(null);
      setLastRealTime(null);
      if (!selectedDossier) return;
      const { lastProgDate, lastProgTime, lastRealDate, lastRealTime } = await getLastForDossier(
        selectedDossier.id
      );
      setLastProgDate(lastProgDate);
      setLastProgTime(lastProgTime);
      setLastRealDate(lastRealDate);
      setLastRealTime(lastRealTime);
    })();
  }, [selectedDossier]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients.slice(0, 50);
    const parts = q.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return patients.filter(
        (p) => p.nom.toLowerCase().includes(parts[0]) || p.prenom.toLowerCase().includes(parts[0])
      );
    }
    return patients.filter((p) => {
      const full = `${p.prenom} ${p.nom}`.toLowerCase();
      return (
        full.includes(parts.join(" ")) ||
        (p.prenom.toLowerCase().includes(parts[0]) && p.nom.toLowerCase().includes(parts[1])) ||
        (p.prenom.toLowerCase().includes(parts[1]) && p.nom.toLowerCase().includes(parts[0]))
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

    if (!selectedDossier) {
      setErr("Veuillez sélectionner un dossier non clôturé avec des séances restantes à programmer.");
      return;
    }

    // Contrôle heure Tunis (aujourd’hui → pas dans le passé ; pas avant aujourd’hui)
    if (date === todayTN) {
      const mm = Number((minute || "00").replace(/[^\d]/g, "").slice(0, 2));
      if (fixedHour < nowH_TN || (fixedHour === nowH_TN && mm < nowM_TN)) {
        setErr("Heure invalide : ne peut pas être dans le passé (heure de Tunis).");
        return;
      }
    } else if (date < todayTN) {
      setErr("Impossible de programmer dans le passé.");
      return;
    }

    const mmStr = (minute || "00").replace(/[^\d]/g, "").slice(0, 2).padStart(2, "0");
    const mmNum = Number(mmStr);
    if (Number.isNaN(mmNum) || mmNum < 0 || mmNum > 59) {
      setErr("Minutes invalides (0–59).");
      return;
    }
    const dureeNum = duree === "" ? null : Number(duree);
    if (dureeNum !== null && (Number.isNaN(dureeNum) || dureeNum < 0)) {
      setErr("Durée invalide (minutes ≥ 0).");
      return;
    }

    try {
      const { remaining, max } = await remainingSlotsForDossier(selectedDossier.id);
      if (remaining <= 0) {
        setErr(max ? `Limite atteinte : ce dossier a déjà ${max} séance(s).` : "Limite atteinte.");
        return;
      }
    } catch (e: any) {
      setErr(e?.message || "Impossible de vérifier le nombre de séances.");
      return;
    }

    const checkAfter = (refDate: string | null, refTime: string | null, label: string) => {
      if (!refDate) return true;
      const HH = fixedHour;
      const MM = mmNum;
      if (date < refDate) {
        setErr(
          `Doit être ≥ ${label} ${new Date(refDate).toLocaleDateString("fr-FR")}${
            refTime ? " " + refTime : ""
          }.`
        );
        return false;
      }
      if (date === refDate && refTime) {
        const rH = Number(refTime.slice(0, 2));
        const rM = Number(refTime.slice(3, 5));
        if (HH < rH || (HH === rH && MM <= rM)) {
          setErr(`Doit être > ${label} ${refTime}.`);
          return false;
        }
      }
      return true;
    };
    if (!checkAfter(lastProgDate, lastProgTime, "la dernière séance programmée")) return;
    if (!checkAfter(lastRealDate, lastRealTime, "la dernière séance réalisée")) return;

    setSaving(true);
    try {
      const numero = await getNextSeanceNumber(selectedDossier.id);
      const heure = `${String(fixedHour).padStart(2, "0")}:${String(mmNum).padStart(2, "0")}:00`;

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
    } catch (e: any) {
      setErr(e?.message || "Erreur lors de l’enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal>
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Programmer — {new Date(date).toLocaleDateString("fr-FR")} • {String(fixedHour).padStart(2, "0")}h
          </h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <PatientSearchBlock
          search={search}
          setSearch={setSearch}
          selectedPatient={selectedPatient}
          setSelectedPatient={setSelectedPatient}
          patients={patients}
        />

        <DossiersGrid
          selectedPatient={selectedPatient}
          dossiers={dossiers}
          selectedDossier={selectedDossier}
          setSelectedDossier={setSelectedDossier}
          showNombre
        />

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ReadOnlyField label="Heure (fixe)" value={String(fixedHour).padStart(2, "0")} />
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

        {selectedDossier && (
          <div className="mt-2 text-xs text-gray-600 space-y-1">
            {lastProgDate && (
              <div>
                Dernière <b>programmée</b> : {new Date(lastProgDate).toLocaleDateString("fr-FR")} {lastProgTime || ""}
              </div>
            )}
            {lastRealDate && (
              <div>
                Dernière <b>réalisée</b> : {new Date(lastRealDate).toLocaleDateString("fr-FR")} {lastRealTime || ""}
              </div>
            )}
            <div>
              Heure Tunis actuelle : {String(nowH_TN).padStart(2, "0")}:{String(nowM_TN).padStart(2, "0")}
            </div>
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

/* ================== Ajouter réalisée ici / Conversion ================== */
function AddRealHereModal({
  date,
  fixedHour,
  fixedMinute,
  isAdmin,
  currentUserId,
  onClose,
  onSuccess,
  scheduledSeance,
}: {
  date: string;
  fixedHour: number;
  fixedMinute: number;
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

  const [minute, setMinute] = useState<string>(String(fixedMinute).padStart(2, "0"));
  const [montant, setMontant] = useState<string>("");
  const [note, setNote] = useState<string>(scheduledSeance?.note || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const { dateStr: tnDate, hour: tnH, minute: tnM } = nowInTZ("Africa/Tunis");
  const dateOK = isAdmin ? date <= tnDate : date === tnDate;

  // Dernière réalisée
  const [lastRealDate, setLastRealDate] = useState<string | null>(null);
  const [lastRealTime, setLastRealTime] = useState<string | null>(null);

  // Programmées existantes (blocage ajout)
  const [scheduledCount, setScheduledCount] = useState<number>(0);

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
        setLastRealTime(data[0].heure_seance ? String(data[0].heure_seance).slice(0, 5) : "00:00");
      }
    })();
  }, [selectedDossier]);

  useEffect(() => {
    (async () => {
      if (!selectedDossier || scheduledSeance) {
        setScheduledCount(0);
        return;
      }
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
    })();
  }, [selectedDossier, scheduledSeance]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients.slice(0, 50);
    const parts = q.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return patients.filter(
        (p) => p.nom.toLowerCase().includes(parts[0]) || p.prenom.toLowerCase().includes(parts[0])
      );
    }
    return patients.filter((p) => {
      const full = `${p.prenom} ${p.nom}`.toLowerCase();
      return (
        full.includes(parts.join(" ")) ||
        (p.prenom.toLowerCase().includes(parts[0]) && p.nom.toLowerCase().includes(parts[1])) ||
        (p.prenom.toLowerCase().includes(parts[1]) && p.nom.toLowerCase().includes(parts[0]))
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

    // Conversion d'une programmée -> réalisée
    if (scheduledSeance) {
      const sDate = scheduledSeance.date_seance as string;
      const sHH = extractHour(scheduledSeance.heure_seance);
      const sMM = extractMinute(scheduledSeance.heure_seance);
      if (isFutureDateTimeInTZ(sDate, sHH, sMM, "Africa/Tunis")) {
        setErr("Impossible de marquer comme réalisée une séance future (heure de Tunis).");
        return;
      }

      const montantNum = parseFloat(montant);
      if (!Number.isFinite(montantNum) || montant.trim() === "" || montantNum < 0) {
        setErr("Montant obligatoire et valide (≥ 0).");
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

    // Ajout nouvelle RÉALISÉE
    if (!dateOK) {
      setErr("Date non autorisée.");
      return;
    }
    if (!selectedDossier) {
      setErr("Sélectionnez un dossier.");
      return;
    }

    // Interdire “futur” à l’instant Tunis (même jour)
    if (date === tnDate) {
      const mm = (minute || "00").replace(/[^\d]/g, "").slice(0, 2).padStart(2, "0");
      const mmNum = Number(mm);
      if (fixedHour > tnH || (fixedHour === tnH && mmNum > tnM)) {
        setErr("Impossible d’ajouter une séance réalisée dans le futur (heure de Tunis).");
        return;
      }
    }

    // Programmées à traiter d’abord ?
    {
      const { count, data, error } = await supabase
        .from("seances")
        .select("id", { count: "exact", head: true })
        .eq("dossier_id", selectedDossier.id)
        .in("etat_seance", ["programmée", "programmee"] as any);

      const nbProg = !error ? (typeof count === "number" ? count : (data?.length ?? 0)) : 0;
      if (nbProg > 0) {
        setErr(
          `Impossible d’ajouter une séance réalisée : ${nbProg} programmée(s) existent pour ce dossier. ` +
            `Veuillez d’abord les enregistrer comme réalisées ou les supprimer.`
        );
        return;
      }
    }

    const mm = (minute || "00").replace(/[^\d]/g, "").slice(0, 2).padStart(2, "0");
    const mmNum = Number(mm);
    if (Number.isNaN(mmNum) || mmNum < 0 || mmNum > 59) {
      setErr("Minutes invalides (0–59).");
      return;
    }

    if (lastRealDate && lastRealTime) {
      if (date < lastRealDate) {
        setErr(`Date invalide : doit être ≥ ${new Date(lastRealDate).toLocaleDateString("fr-FR")}.`);
        return;
      }
      if (date === lastRealDate) {
        const rH = Number(lastHH);
        const rM = Number(lastMM);
        if (fixedHour < rH || (fixedHour === rH && mmNum <= rM)) {
          setErr(`Horaire invalide : doit être > ${lastRealTime}.`);
          return;
        }
      }
    }

    const montantNum = parseFloat(montant);
    if (!Number.isFinite(montantNum) || montant.trim() === "" || montantNum < 0) {
      setErr("Montant obligatoire et valide (≥ 0).");
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
          const sDate = scheduledSeance!.date_seance as string;
          const sHH = extractHour(scheduledSeance!.heure_seance);
          const sMM = extractMinute(scheduledSeance!.heure_seance);
          return isFutureDateTimeInTZ(sDate, sHH, sMM, "Africa/Tunis");
        })()
      : (
          !dateOK ||
          !selectedDossier ||
          dateBeforeLast ||
          (sameDayAsLast && lastHH && fixedHour === Number(lastHH) && minuteTooSmallOrEqual) ||
          (!scheduledSeance && selectedDossier && scheduledCount > 0)
        )) || saving;

  return (
    <Modal>
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {scheduledSeance
              ? `Enregistrer la réalisation — ${new Date(date).toLocaleDateString("fr-FR")} • ${String(
                  fixedHour
                ).padStart(2, "0")}h`
              : `Ajouter une séance — ${new Date(date).toLocaleDateString("fr-FR")} • ${String(fixedHour).padStart(
                  2,
                  "0"
                )}h`}
          </h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

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

        {!scheduledSeance && (
          <DossiersGrid
            selectedPatient={selectedPatient}
            dossiers={dossiers}
            selectedDossier={selectedDossier!}
            setSelectedDossier={setSelectedDossier}
          />
        )}

        {!scheduledSeance && selectedDossier && scheduledCount > 0 && (
          <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
            Ce dossier comporte <b>{scheduledCount}</b> séance(s) programmée(s).
            <br />
            Traitez ces séances (réaliser ou supprimer) avant d’ajouter une nouvelle séance réalisée.
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ReadOnlyField label="Heure (fixe)" value={String(fixedHour).padStart(2, "0")} />
          <div>
            <label className="block text-sm text-gray-700 mb-1">Minutes</label>
            <input
              value={minute}
              onChange={(e) => setMinute(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
              placeholder="MM"
              className={`w-full border rounded px-3 py-2 ${
                sameDayAsLast && lastHH && fixedHour === Number(lastHH) && minuteTooSmallOrEqual
                  ? "border-red-300"
                  : "border-gray-300"
              }`}
              disabled={!!scheduledSeance}
            />
            {sameDayAsLast && lastRealTime && fixedHour === Number(lastHH) && !scheduledSeance && (
              <p className={`text-xs mt-1 ${minuteTooSmallOrEqual ? "text-red-600" : "text-gray-500"}`}>
                Minutes &gt; {lastRealTime}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Montant payé (DT) *</label>
            <input
              type="number"
              step="0.01"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="ex: 0,00"
            />
          </div>
        </div>

        {isAdmin && (
          <div className="mt-3">
            <label className="block text-sm text-gray-700 mb-1">Prestataire</label>
            <select
              value={prestataireId}
              onChange={(e) => setPrestataireId(e.target.value)}
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

        <div className="mt-3">
          <label className="block text-sm text-gray-700 mb-1">Note (optionnelle)</label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ajouter une note…"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
          />
        </div>

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
            {saving ? "Enregistrement…" : scheduledSeance ? "Marquer comme réalisée" : "Ajouter"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ================== Petits composants ================== */
function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1000]">
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 flex items-center justify-center p-4">{children}</div>
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
        (p) => p.nom.toLowerCase().includes(parts[0]) || p.prenom.toLowerCase().includes(parts[0])
      );
    }
    return patients.filter((p) => {
      const full = `${p.prenom} ${p.nom}`.toLowerCase();
      return (
        full.includes(parts.join(" ")) ||
        (p.prenom.toLowerCase().includes(parts[0]) && p.nom.toLowerCase().includes(parts[1])) ||
        (p.prenom.toLowerCase().includes(parts[1]) && p.nom.toLowerCase().includes(parts[0]))
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
        <div className="text-sm text-gray-500">Choisissez d’abord un patient.</div>
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
                selectedDossier?.id === d.id ? "border-teal-500 ring-1 ring-teal-200" : ""
              }`}
            >
              <div className="font-medium">{d.motif}</div>
              <div className="text-xs text-gray-500 mt-1">
                {showNombre && d.nombre_seances ? `${d.nombre_seances} prévues • ` : ""}
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
      <input value={value} disabled className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-600" />
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
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border rounded px-3 py-2" />
    </div>
  );
}
function ErrorNote({ text }: { text: string }) {
  return <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">{text}</div>;
}

/* helper */
function onChangeMonthYear(monthIndex: number, year: number, setAnchorDate: (s: string) => void) {
  const first = new Date(year, monthIndex, 1);
  setAnchorDate(toDateStr(first));
}
