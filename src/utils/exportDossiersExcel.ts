// utils/excelExportDashboard.ts
import * as XLSX from "xlsx";
import { DossierSoin, Patient, Seance, UserBase } from "../lib/supabase";

type SeanceWithJoin = Seance & { prestataire?: UserBase };
type DossierWithJoins = DossierSoin & {
  patient?: Patient;
  seances?: SeanceWithJoin[];
};

function isProgrammee(etat?: string | null) {
  return etat === "programmée" || etat === "programmee";
}
function isRealisee(etat?: string | null) {
  return etat === "réalisée" || etat === "realisee";
}

function fmtDate(d?: string | null) {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("fr-FR");
}

function etatLabel(etat: string) {
  switch (etat) {
    case "a_venir":
      return "À venir";
    case "en_cours":
      return "En cours";
    case "termine":
      return "Terminé";
    default:
      return etat;
  }
}

function tunisTimestamp() {
  // => "JJ-MM-YYYY-HH-MM-SS" en heure de Tunis
  const parts = new Intl.DateTimeFormat("fr-TN", {
    timeZone: "Africa/Tunis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const jj = get("day");
  const mm = get("month");
  const yyyy = get("year");
  const hh = get("hour");
  const mi = get("minute");
  const ss = get("second");
  return `${jj}-${mm}-${yyyy}-${hh}-${mi}-${ss}`;
}

export function exportDossiersToExcel(
  dossiers: DossierWithJoins[],
  opts?: { filename?: string; filtered?: boolean }
) {
  const wb = XLSX.utils.book_new();

  // ====== Onglet 1 : Dossiers (synthèse) ======
  const dossiersRows = dossiers.map((d) => {
    const seances = (d.seances || []) as SeanceWithJoin[];

    // Réalisées uniquement pour les calculs financiers
    const realised = seances.filter((s) => isRealisee((s as any).etat_seance));
    const realisedCount = realised.length;

    const totalDu = realisedCount * (d.prix_par_seance ?? 0);
    const totalPaye = realised.reduce(
      (sum, s) => sum + (Number(s.montant_paye) || 0),
      0
    );
    const solde = totalPaye - totalDu; // >0 = crédit (surpaiement)
    const surpaiement = Math.max(0, solde);

    const statut =
      solde > 0 ? "Crédité" : solde < 0 ? "Débiteur" : "Payé";

    // Dernière séance (toutes confondues pour l’info de suivi)
    const last = (d.seances || [])
      .slice()
      .sort(
        (a, b) =>
          new Date(b.date_seance).getTime() - new Date(a.date_seance).getTime()
      )[0];

    return {
      Patient: d.patient ? `${d.patient.prenom} ${d.patient.nom}` : "—",
      Dossier: d.motif,
      "État dossier": etatLabel(d.etat),
      "PEC Assurance": d.pec_cnam ? "Oui" : "Non",
      "État PEC": d.pec_cnam ? (d.etat_pec === "depose" ? "Déposé" : "En cours") : "—",
      Activité: d.est_actif ? "Actif" : "Inactif",
      "Séances prévues (N)": d.nombre_seances ?? 0,
      "Séances réalisées (X)": realisedCount,
      "Total dû (DT)": Number(totalDu.toFixed(2)),
      "Total payé (DT)": Number(totalPaye.toFixed(2)),
      "Solde (DT)": Number(solde.toFixed(2)), // >0 = crédité
      "Surpaiement (DT)": Number(surpaiement.toFixed(2)),
      Statut: statut, // Payé / Débiteur / Crédité
      "Date début": fmtDate(d.date_debut),
      "Dernière séance": fmtDate(last?.date_seance ?? null),
      "Date fin": fmtDate(d.date_fin),
    };
  });

  const wsDossiers = XLSX.utils.json_to_sheet(dossiersRows, { skipHeader: false });
  // Ajuste une largeur de colonnes raisonnable
  const colWidths = Object.keys(dossiersRows[0] || {}).map(() => ({ wch: 20 }));
  wsDossiers["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(wb, wsDossiers, "Dossiers");

  // ====== Onglet 2 : Paiements_Seances (détail) ======
  // ⚠️ Pas d’ID dossier dans cet onglet (conforme à la demande)
  const detailRows: any[] = [];
  dossiers.forEach((d) => {
    const seances = (d.seances || []) as SeanceWithJoin[];

    seances
      .slice()
      .sort(
        (a, b) =>
          new Date(a.date_seance).getTime() - new Date(b.date_seance).getTime()
      )
      .forEach((s) => {
        detailRows.push({
          Patient: d.patient ? `${d.patient.prenom} ${d.patient.nom}` : "—",
          Dossier: d.motif,
          "N° Séance": s.numero_seance,
          Date: fmtDate(s.date_seance),
          Heure: s.heure_seance ? String(s.heure_seance).slice(0, 5) : "—",
          Prestataire: s.prestataire
            ? `${s.prestataire.prenom} ${s.prestataire.nom}`
            : "—",
          État: isProgrammee((s as any).etat_seance)
            ? "Programmée"
            : isRealisee((s as any).etat_seance)
            ? "Réalisée"
            : s.etat_seance ?? "—",
          "Montant payé (DT)": isRealisee((s as any).etat_seance)
            ? Number((Number(s.montant_paye) || 0).toFixed(2))
            : 0,
          Note: s.note || "",
        });
      });
  });

  const wsDetail = XLSX.utils.json_to_sheet(detailRows, { skipHeader: false });
  wsDetail["!cols"] = Object.keys(detailRows[0] || {}).map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, wsDetail, "Paiements_Seances");

  // ====== Fichier ======
  const ts = tunisTimestamp();
  const prefix = opts?.filtered === false ? "dossiers_tous" : "dossiers_filtres"; // défaut: filtres
  const filename =
    opts?.filename ?? `${prefix}_${ts}.xlsx`;

  XLSX.writeFile(wb, filename);
}
