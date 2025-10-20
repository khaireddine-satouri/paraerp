// /src/utils/pdfExport.ts
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DossierSoin, Patient, Seance, UserBase } from '../lib/supabase';

export interface DossierDetailPDF {
  dossier: DossierSoin;
  patient: Patient;
  seances: (Seance & { prestataire?: UserBase })[];
  paymentStatusOverride?: string;
}

export function exportDossierToPDF(data: DossierDetailPDF) {
  const doc = new jsPDF();
  const { dossier, patient, seances, paymentStatusOverride } = data;

  const pageWidth = doc.internal.pageSize.getWidth();
  let yPosition = 20;

  // Titre
  doc.setFontSize(18);
  doc.text('Détail du Dossier', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 15;

  // --- Infos Patient ---
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Informations Patient', 14, yPosition);
  yPosition += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Nom: ${patient.prenom} ${patient.nom}`, 14, yPosition);
  yPosition += 5;
  doc.text(`Téléphone: ${patient.telephone}`, 14, yPosition);
  yPosition += 5;
  if (patient.email) {
    doc.text(`Email: ${patient.email}`, 14, yPosition);
    yPosition += 5;
  }
  if (patient.date_naissance) {
    doc.text(
      `Date de naissance: ${new Date(patient.date_naissance).toLocaleDateString('fr-FR')}`,
      14,
      yPosition
    );
    yPosition += 5;
  }
  yPosition += 5;

  // --- Infos Dossier ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Informations Dossier', 14, yPosition);
  yPosition += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Motif: ${dossier.motif}`, 14, yPosition);
  yPosition += 5;
  doc.text(`État: ${getEtatLabel(dossier.etat)}`, 14, yPosition);
  yPosition += 5;

  // 🔹 Séances total + réalisées (2 lignes séparées)
  const totalSeances = dossier.nombre_seances ?? 0;
  const seancesRealisees = seances.filter(
    (s) => s.etat_seance === 'réalisée' || s.etat_seance === 'realisee'
  ).length;
  doc.text(`Nombre de séances prévues: ${totalSeances}`, 14, yPosition);
  yPosition += 5;
  doc.text(`Nombre de séances réalisées: ${seancesRealisees}`, 14, yPosition);
  yPosition += 5;

  // Suite infos
  doc.text(`Prix par séance: ${dossier.prix_par_seance.toFixed(2)} DT`, 14, yPosition);
  yPosition += 5;
  doc.text(`PEC Assurance: ${dossier.pec_cnam ? 'Oui' : 'Non'}`, 14, yPosition);
  yPosition += 5;
  if (dossier.pec_cnam) {
    doc.text(
      `État PEC: ${dossier.etat_pec === 'depose' ? 'Déposé' : 'En cours'}`,
      14,
      yPosition
    );
    yPosition += 5;
  }
  if (dossier.date_debut) {
    doc.text(
      `Date début: ${new Date(dossier.date_debut).toLocaleDateString('fr-FR')}`,
      14,
      yPosition
    );
    yPosition += 5;
  }
  if (dossier.date_fin) {
    doc.text(
      `Date fin: ${new Date(dossier.date_fin).toLocaleDateString('fr-FR')}`,
      14,
      yPosition
    );
    yPosition += 5;
  }
  if (dossier.commentaire) {
    yPosition += 2;
    doc.text(`Commentaire: ${dossier.commentaire}`, 14, yPosition);
    yPosition += 5;
  }
  yPosition += 5;

  // --- Paiements ---
  const totalPaye = seances.reduce((sum, s) => sum + (Number(s.montant_paye) || 0), 0);
  const totalDu = totalSeances * dossier.prix_par_seance;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Historique des Paiements par Séance', 14, yPosition);
  yPosition += 7;

  const tableData = seances.map((seance) => [
    `${seance.numero_seance}`,
    new Date(seance.date_seance).toLocaleDateString('fr-FR'),
    seance.prestataire ? `${seance.prestataire.prenom} ${seance.prestataire.nom}` : '-',
    `${(Number(seance.montant_paye) || 0).toFixed(2)} DT`,
    seance.note || '-',
  ]);

  autoTable(doc, {
    startY: yPosition,
    head: [['Séance', 'Date', 'Prestataire', 'Montant Payé', 'Note']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [13, 148, 136] },
    styles: { fontSize: 8 },
    columnStyles: {
      4: { cellWidth: 40 }
    }
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? yPosition + 10;
  yPosition = finalY + 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Total payé: ${totalPaye.toFixed(2)} DT`, 14, yPosition);
  yPosition += 6;
  doc.text(`Total dû: ${totalDu.toFixed(2)} DT`, 14, yPosition);
  yPosition += 6;

  // Statut paiement
  const statut =
    paymentStatusOverride ??
    (dossier.est_paye === null
      ? 'Non disponible'
      : totalPaye >= totalDu
      ? 'Payé'
      : 'Débiteur');

  doc.text(`Statut: ${statut}`, 14, yPosition);

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  const tunisDate = new Date().toLocaleString('fr-FR', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(128, 128, 128);
  doc.text(
    `Téléchargé le ${tunisDate} (heure de Tunis)`,
    pageWidth / 2,
    pageHeight - 10,
    { align: 'center' }
  );

  const safeMotif = `${dossier.motif || ''}`.trim().replace(/\s+/g, '_').replace(/[^\w\-]+/g, '');
  const fileName = `dossier_${patient.nom}_${safeMotif || 'detail'}.pdf`;
  doc.save(fileName);
}

function getEtatLabel(etat: string): string {
  switch (etat) {
    case 'a_venir':
      return 'À venir';
    case 'en_cours':
      return 'En cours';
    case 'termine':
      return 'Terminé';
    default:
      return etat;
  }
}
