// /src/utils/planningExport.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

/** Une ligne de planning à exporter */
export interface PlanningExportRow {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" (peut être null si non renseigné) */
  heure: string | null;
  patient: string;
  motif: string;
  prestataire: string;
  note: string | null;
  /** Durée en minutes (facultatif) */
  duree_minutes?: number | null;
}

export interface PlanningExportOptions {
  /** borne min d’affichage (YYYY-MM-DD) – utilisé uniquement pour le nom de fichier */
  from?: string;
  /** borne max d’affichage (YYYY-MM-DD) – utilisé uniquement pour le nom de fichier */
  to?: string;
  /** titre principal (par défaut: "Séances programmées") */
  title?: string;
  /** orientation paysage PDF (true par défaut) */
  landscape?: boolean;
  /** nom de fichier sans extension (fallback si from/to absents) */
  fileBaseName?: string;
}

/* ------------------------------ Helpers ------------------------------ */

function toFRDateLabel(dateISO: string) {
  const d = new Date(dateISO);
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function byDateAsc(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function timeKey(hhmm: string | null) {
  if (!hhmm) return "99:99"; // pousse les lignes sans heure en bas
  const hh = hhmm.slice(0, 2);
  const mm = hhmm.slice(3, 5);
  return `${hh}:${mm}`;
}

function sanitizeSheetName(name: string) {
  // Excel: 31 chars max, pas de : \ / ? * [ ]
  const bad = /[:\\\/\?\*\[\]]/g;
  let n = name.replace(bad, " ");
  if (n.length > 31) n = n.slice(0, 31);
  return n || "Feuille";
}

function computeRangeFromRows(rows: PlanningExportRow[]) {
  if (!rows.length) return { from: undefined as string | undefined, to: undefined as string | undefined };
  const dates = Array.from(new Set(rows.map(r => r.date))).sort(byDateAsc);
  return { from: dates[0], to: dates[dates.length - 1] };
}

function filename(base: string | undefined, from?: string, to?: string, ext: "pdf" | "xlsx" = "pdf") {
  const safeBase = (base || "programmations").trim().replace(/\s+/g, "_").replace(/[^\w\-]+/g, "");
  if (from && to) return `${safeBase}_${from}_au_${to}.${ext}`;
  if (from) return `${safeBase}_à_partir_du_${from}.${ext}`;
  return `${safeBase}.${ext}`;
}

/* ---------------------------- PDF par jour --------------------------- */

/**
 * Exporte les séances programmées en PDF, 1 page par jour.
 * - Orientation paysage (par défaut)
 * - Tableau : Heure | Durée (min) | Patient | Motif | Prestataire | Note
 * - Bordures grises visibles aussi dans l’en-tête
 */
export function exportProgrammationsPDFByDay(
  rows: PlanningExportRow[],
  options: PlanningExportOptions = {}
) {
  const { title = "Séances programmées", landscape = true } = options;

  // Période utilisée uniquement pour le nom de fichier
  const { from: computedFrom, to: computedTo } = computeRangeFromRows(rows);
  const from = options.from ?? computedFrom;
  const to = options.to ?? computedTo;

  // groupage par date
  const byDay = new Map<string, PlanningExportRow[]>();
  for (const r of rows) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date)!.push(r);
  }
  const days = Array.from(byDay.keys()).sort(byDateAsc);

  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait" });
  const lineGray: [number, number, number] = [200, 200, 200]; // gris bordures

  days.forEach((day, idx) => {
    if (idx > 0) doc.addPage();

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Titres
    doc.setFontSize(16);
    doc.text(title, pageWidth / 2, 12, { align: "center" });
    doc.setFontSize(11);
    doc.text(toFRDateLabel(day), pageWidth / 2, 18, { align: "center" });

    const dayRows = (byDay.get(day) || []).sort((a, b) =>
      timeKey(a.heure).localeCompare(timeKey(b.heure))
    );

    autoTable(doc, {
      startY: 28,
      head: [["Heure", "Durée (min)", "Patient", "Motif", "Prestataire", "Note"]],
      body: dayRows.map((r) => [
        r.heure ?? "—",
        r.duree_minutes ?? "—",
        r.patient,
        r.motif,
        r.prestataire,
        r.note ?? "—",
      ]),
      theme: "grid",
      // Styles globaux (affectent aussi l’en-tête si non surchargé)
      styles: {
        fontSize: 9,
        cellPadding: 2,
        lineColor: lineGray,
        lineWidth: 0.2,
      },
      // En-tête : fond teal + bordures grises visibles
      headStyles: {
        fillColor: [13, 148, 136], // teal-600
        textColor: 255,
        lineColor: lineGray,
        lineWidth: 0.2,
      },
      // Corps : bordures grises (cohérence)
      bodyStyles: {
        lineColor: lineGray,
        lineWidth: 0.2,
      },
      // Bordure du tableau
      tableLineColor: lineGray,
      tableLineWidth: 0.2,
      columnStyles: {
        0: { cellWidth: 20 }, // Heure
        1: { cellWidth: 22 }, // Durée
        2: { cellWidth: 50 }, // Patient
        3: { cellWidth: 50 }, // Motif
        4: { cellWidth: 40 }, // Prestataire
        5: { cellWidth: "auto" }, // Note
      },
      didDrawPage: () => {
        // Footer (date Tunis)
        const tunis = new Intl.DateTimeFormat("fr-FR", {
          timeZone: "Africa/Tunis",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date());
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          `Téléchargé le ${tunis} (heure de Tunis)`,
          pageWidth / 2,
          pageHeight - 6,
          { align: "center" }
        );
      },
    });
  });

  const file = filename(options.fileBaseName, from, to, "pdf");
  doc.save(file);
}

/* --------------------------- Excel par jour -------------------------- */

/**
 * Exporte les séances programmées en Excel, 1 onglet par jour.
 * - Onglet nommé "JJ mois AAAA" (tronqué si nécessaire)
 * - Colonnes : Heure | Durée (min) | Patient | Motif | Prestataire | Note
 */
export function exportProgrammationsExcelByDay(
  rows: PlanningExportRow[],
  options: PlanningExportOptions = {}
) {
  // Période utilisée uniquement pour le nom de fichier
  const { from: computedFrom, to: computedTo } = computeRangeFromRows(rows);
  const from = options.from ?? computedFrom;
  const to = options.to ?? computedTo;

  // groupage par date
  const byDay = new Map<string, PlanningExportRow[]>();
  for (const r of rows) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date)!.push(r);
  }
  const days = Array.from(byDay.keys()).sort(byDateAsc);

  const wb = XLSX.utils.book_new();

  days.forEach((day) => {
    const dayRows = (byDay.get(day) || []).sort((a, b) =>
      timeKey(a.heure).localeCompare(timeKey(b.heure))
    );

    // Données avec entêtes
    const headers = ["Heure", "Durée (min)", "Patient", "Motif", "Prestataire", "Note"];
    const data = [
      headers,
      ...dayRows.map((r) => [
        r.heure ?? "—",
        r.duree_minutes ?? "",
        r.patient,
        r.motif,
        r.prestataire,
        r.note ?? "",
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Largeur des colonnes (approximative)
    const colWidths = [
      { wch: 8 },  // Heure
      { wch: 12 }, // Durée
      { wch: 24 }, // Patient
      { wch: 24 }, // Motif
      { wch: 20 }, // Prestataire
      { wch: 40 }, // Note
    ];
    (ws as any)["!cols"] = colWidths;

    const sheetName = sanitizeSheetName(
      new Date(day).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    );
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const file = filename(options.fileBaseName, from, to, "xlsx");
  XLSX.writeFile(wb, file);
}
