// /src/utils/planningExport.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/** Une ligne « normalisée » pour l’export du planning des SEANCES PROGRAMMÉES */
export interface PlanningExportRow {
  date: string;                  // "YYYY-MM-DD"
  heure: string | null;          // "HH:MM"
  patient: string;
  motif: string;
  prestataire: string;
  dureeMinutes: number | null;   // 🔹 ajouté
  note: string | null;
}

/** Regroupe les lignes par jour "YYYY-MM-DD" */
function groupByDate(rows: PlanningExportRow[]): Record<string, PlanningExportRow[]> {
  return rows.reduce((acc, r) => {
    (acc[r.date] ||= []).push(r);
    return acc;
  }, {} as Record<string, PlanningExportRow[]>);
}

/** Format FR d’une date ISO "YYYY-MM-DD" */
function frDate(d: string) {
  return new Date(d).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Export PDF : 1 page par jour (en mode portrait) */
export function exportProgrammationsPDFByDay(
  rows: PlanningExportRow[],
  fromISO: string,
  toISO: string,
  title = "Séances programmées"
) {
  if (!rows || rows.length === 0) {
    alert("Aucune séance à exporter.");
    return;
  }

  // 🔸 Portrait par défaut (pas d’orientation: "landscape")
  const doc = new jsPDF();

  const byDay = groupByDate(rows);
  const days = Object.keys(byDay).sort();

  days.forEach((day, idx) => {
    if (idx > 0) doc.addPage(); // nouvelle page par jour
    const dayRows = byDay[day];

    // En-tête
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(16);
    doc.text(title, pageWidth / 2, 14, { align: "center" });

    doc.setFontSize(10);
    doc.text(
      `Période : ${new Date(fromISO).toLocaleDateString("fr-FR")} → ${new Date(toISO).toLocaleDateString("fr-FR")}`,
      pageWidth / 2,
      20,
      { align: "center" }
    );

    doc.setFontSize(12);
    doc.text(frDate(day), 14, 30);

    // Tableau
    const body = dayRows.map((r) => [
      r.heure ?? "—",
      r.patient,
      r.motif,
      r.prestataire,
      r.dureeMinutes != null ? String(r.dureeMinutes) : "—", // 🔹 Durée (min)
      r.note || "—",
    ]);

    autoTable(doc, {
      startY: 36,
      head: [["Heure", "Patient", "Motif", "Prestataire", "Durée (min)", "Note"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [13, 148, 136] }, // teal-600
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 40 },
        2: { cellWidth: 40 },
        3: { cellWidth: 38 },
        4: { cellWidth: 22 },
        5: { cellWidth: 60 }, // Note
      },
    });

    // Pied de page (heure de Tunis)
    const tunis = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Africa/Tunis",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Téléchargé le ${tunis} (heure de Tunis)`, pageWidth / 2, pageHeight - 6, {
      align: "center",
    });
  });

  const fileName = `programmations_${fromISO}_au_${toISO}.pdf`;
  doc.save(fileName);
}

/** Export Excel : 1 onglet par jour, avec durée (min) */
export async function exportProgrammationsExcelByDay(
  rows: PlanningExportRow[],
  fromISO: string,
  toISO: string
) {
  // Chargement dynamique pour éviter d’alourdir le bundle principal si inutile
  const XLSX = await import("xlsx");

  const byDay = groupByDate(rows);
  const days = Object.keys(byDay).sort();

  const wb = XLSX.utils.book_new();

  for (const day of days) {
    const dayRows = byDay[day];

    const data = [
      ["Heure", "Patient", "Motif", "Prestataire", "Durée (min)", "Note"],
      ...dayRows.map((r) => [
        r.heure ?? "",
        r.patient,
        r.motif,
        r.prestataire,
        r.dureeMinutes != null ? r.dureeMinutes : "",
        r.note ?? "",
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    // un peu de largeur par défaut
    ws["!cols"] = [
      { wch: 8 },
      { wch: 22 },
      { wch: 22 },
      { wch: 20 },
      { wch: 12 },
      { wch: 40 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, frDate(day).slice(0, 31)); // nom d’onglet max 31
  }

  const fileName = `programmations_${fromISO}_au_${toISO}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
