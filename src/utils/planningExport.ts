// /src/utils/planningExport.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

/** Ligne à exporter depuis le planning. Normalise tout pour éviter les jointures ici. */
export type PlanningExportRow = {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" ou null */
  heure: string | null;
  duree_minutes?: number | null;
  /** "Prénom Nom" */
  patient: string;
  /** motif du dossier */
  motif: string;
  /** "Prénom Nom" */
  prestataire: string;
  note?: string | null;
};

/** Petit helper */
function byDay(rows: PlanningExportRow[]) {
  const map = new Map<string, PlanningExportRow[]>();
  for (const r of rows) {
    const list = map.get(r.date) || [];
    list.push(r);
    map.set(r.date, list);
  }
  // tri à l’intérieur de chaque jour par heure croissante
  for (const [d, list] of map) {
    list.sort((a, b) => {
      const ha = a.heure ? a.heure : "00:00";
      const hb = b.heure ? b.heure : "00:00";
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    map.set(d, list);
  }
  // tri des jours
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Date/heure locale Tunis pour footer */
function tunisNowLabel() {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Tunis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

/** Joli libellé FR pour un "YYYY-MM-DD" */
function frDay(dateISO: string) {
  try {
    const d = new Date(dateISO);
    return d.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateISO;
  }
}

/**
 * PDF : 1 page par jour (paysage). Chaque page contient un tableau des séances du jour.
 *
 * @param rows      Lignes normalisées (déjà enrichies)
 * @param fromISO   "YYYY-MM-DD"
 * @param toISO     "YYYY-MM-DD"
 * @param title     Optionnel, titre principal (défaut "Séances programmées")
 */
export function exportProgrammationsPDFByDay(
  rows: PlanningExportRow[],
  fromISO: string,
  toISO: string,
  title = "Séances programmées"
) {
  // Regroupement
  const grouped = byDay(rows.filter(r => r.date >= fromISO && r.date <= toISO));

  // Création PDF paysage
  const doc = new jsPDF({ orientation: "landscape" });

  if (grouped.length === 0) {
    // page vide avec message
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(16);
    doc.text(title, pageWidth / 2, 18, { align: "center" });
    doc.setFontSize(10);
    doc.text(
      `Période : ${new Date(fromISO).toLocaleDateString("fr-FR")} → ${new Date(
        toISO
      ).toLocaleDateString("fr-FR")}`,
      pageWidth / 2,
      24,
      { align: "center" }
    );
    doc.setFontSize(12);
    doc.text("Aucune séance trouvée sur cette période.", pageWidth / 2, 45, {
      align: "center",
    });
  }

  grouped.forEach(([dateISO, dayRows], idx) => {
    if (idx > 0) doc.addPage("landscape");

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // En-tête
    doc.setFontSize(16);
    doc.text(title, pageWidth / 2, 14, { align: "center" });

    doc.setFontSize(11);
    doc.text(frDay(dateISO), pageWidth / 2, 22, { align: "center" });

    // Tableau
    const body = dayRows.map((r) => [
      r.heure ?? "—",
      r.patient || "-",
      r.motif || "-",
      r.prestataire || "-",
      r.note || "-",
    ]);

    autoTable(doc, {
      startY: 28,
      head: [["Heure", "Patient", "Motif", "Prestataire", "Note"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [13, 148, 136] }, // teal-600
      styles: { fontSize: 9 },
      columnStyles: { 4: { cellWidth: 80 } },
      didDrawPage: () => {
        // Footer (Tunis time)
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          `Téléchargé le ${tunisNowLabel()} (heure de Tunis)`,
          pageWidth / 2,
          pageHeight - 6,
          { align: "center" }
        );
      },
    });
  });

  const fileName = `programmees_${fromISO}_au_${toISO}.pdf`;
  doc.save(fileName);
}

/**
 * Excel : 1 onglet par jour. Onglet nommé "YYYY-MM-DD".
 *
 * @param rows    Lignes normalisées (déjà enrichies)
 * @param fromISO "YYYY-MM-DD"
 * @param toISO   "YYYY-MM-DD"
 * @param workbookName Nom de fichier (facultatif)
 */
export function exportProgrammationsExcelByDay(
  rows: PlanningExportRow[],
  fromISO: string,
  toISO: string,
  workbookName?: string
) {
  const grouped = byDay(rows.filter(r => r.date >= fromISO && r.date <= toISO));
  const wb = XLSX.utils.book_new();

  if (grouped.length === 0) {
    // Onglet vide avec info
    const ws = XLSX.utils.aoa_to_sheet([
      ["Séances programmées"],
      [
        `Période : ${new Date(fromISO).toLocaleDateString("fr-FR")} → ${new Date(
          toISO
        ).toLocaleDateString("fr-FR")}`,
      ],
      [],
      ["Aucune séance sur la période"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Aucune");
  } else {
    for (const [dateISO, dayRows] of grouped) {
      const aoa: (string | number)[][] = [];
      // En-tête texte
      aoa.push(["Séances programmées"]);
      aoa.push([frDay(dateISO)]);
      aoa.push([]);

      // Tableau
      aoa.push(["Heure", "Patient", "Motif", "Prestataire", "Note"]);
      for (const r of dayRows) {
        aoa.push([
          r.heure ?? "—",
          r.patient || "-",
          r.motif || "-",
          r.prestataire || "-",
          r.note || "-",
        ]);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Un peu de largeur de colonnes
      (ws["!cols"] = [
        { wch: 8 },   // Heure
        { wch: 24 },  // Patient
        { wch: 26 },  // Motif
        { wch: 24 },  // Prestataire
        { wch: 40 },  // Note
      ]);

      // Nom d’onglet : YYYY-MM-DD
      XLSX.utils.book_append_sheet(wb, ws, dateISO);
    }
  }

  const name =
    workbookName ||
    `programmees_${fromISO}_au_${toISO}_${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.xlsx`;
  XLSX.writeFile(wb, name);
}
