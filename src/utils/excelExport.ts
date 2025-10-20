import * as XLSX from 'xlsx';
import { Seance, Patient, DossierSoin, UserBase } from '../lib/supabase';

export interface EffectifRow {
  seance: Seance;
  patient?: Patient;
  dossier?: DossierSoin;
  prestataire?: UserBase;
}

export function exportEffectifToExcel(
  effectifData: EffectifRow[],
  date: string
) {
  const data = effectifData.map((row) => ({
    'Patient': row.patient ? `${row.patient.prenom} ${row.patient.nom}` : 'Inconnu',
    'Dossier': row.dossier?.motif || '',
    'Séance': `${row.seance.numero_seance}/${row.dossier?.nombre_seances || ''}`,
    'Prestataire': row.prestataire ? `${row.prestataire.prenom} ${row.prestataire.nom}` : '',
    'Montant payé (DT)': row.seance.montant_paye.toFixed(2),
    'Date': new Date(row.seance.date_seance).toLocaleDateString('fr-FR'),
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Effectif du jour');

  const fileName = `effectif_${date.replace(/-/g, '_')}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
