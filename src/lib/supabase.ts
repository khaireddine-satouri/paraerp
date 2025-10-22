import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Client {
  id: string;
  nom: string;
  statut: 'actif' | 'inactif';
  created_at: string;
  updated_at: string;
}

export interface UserBase {
  id: string;
  nom: string;
  prenom: string;
  type_utilisateur: 'admin' | 'assistant';
  client_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Patient {
  id: string;
  nom: string;
  prenom: string;
  telephone: string;
  telephone_2?: string | null;
  photo_url: string | null;     // URL publique (pour l’affichage)
  photo_path?: string | null;   // ✅ chemin storage (ex: "patientId/xxx.jpg")
  client_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DossierSoin {
  id: string;
  patient_id: string;
  motif: string;
  commentaire: string;
  nombre_seances: number;
  pec_cnam: boolean;
  etat_pec: 'en_cours' | 'depose' | null;
  prix_par_seance: number;
  date_debut: string | null;
  date_fin: string | null;
  etat: 'a_venir' | 'en_cours' | 'termine';
  est_actif?: boolean | null;   // ✅ lu depuis la DB (trigger)
  client_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Seance {
  id: string;
  dossier_id: string;
  numero_seance: number;
  date_seance: string;
  prestataire_id: string;
  montant_paye: number;
  note: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  dossier_id: string;
  nom: string;
  type_fichier: 'photo' | 'pdf';
  storage_path: string;         // ex: "dossierId/filename.pdf"
  uploaded_by: string | null;
  created_at: string;
}


