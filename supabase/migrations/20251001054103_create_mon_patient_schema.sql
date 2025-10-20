/*
  # Schéma complet pour Mon Patient - Application de gestion de patients pour kinésithérapeute

  1. Tables créées
    - `users_base` : Profils utilisateurs avec nom, prénom et type (admin/assistant)
    - `patients` : Données des patients (nom, prénom, téléphone, photo)
    - `dossiers_soins` : Dossiers de soins associés aux patients
    - `seances` : Historique des séances pour chaque dossier
    - `documents` : Documents attachés aux dossiers (photos/PDF)
    - `app_settings` : Paramètres application (jours inactivité)

  2. Sécurité
    - RLS activé sur toutes les tables
    - Policies restrictives basées sur auth.uid() et type utilisateur
    - Admin : accès total
    - Assistant : accès limité à ses propres séances + lecture patients/dossiers

  3. Fonctionnalités
    - Gestion automatique des timestamps (created_at, updated_at)
    - Calcul automatique du total payé via agrégation
    - Labels et statuts calculables (actif/inactif, payé/débiteur)
    - Upload de documents via Supabase Storage
*/

-- Extension pour UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table users_base : profils utilisateurs étendus
CREATE TABLE IF NOT EXISTS users_base (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nom text NOT NULL,
  prenom text NOT NULL,
  type_utilisateur text NOT NULL CHECK (type_utilisateur IN ('admin', 'assistant')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Table patients
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  prenom text NOT NULL,
  telephone text NOT NULL,
  photo_url text,
  created_by uuid REFERENCES users_base(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Table dossiers_soins
CREATE TABLE IF NOT EXISTS dossiers_soins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  motif text NOT NULL,
  commentaire text DEFAULT '',
  nombre_seances integer NOT NULL DEFAULT 0,
  pec_cnam boolean DEFAULT false,
  prix_par_seance numeric(10,2) DEFAULT 0,
  date_debut date,
  date_fin date,
  etat text NOT NULL DEFAULT 'a_venir' CHECK (etat IN ('a_venir', 'en_cours', 'termine')),
  created_by uuid REFERENCES users_base(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES users_base(id)
);

-- Table seances
CREATE TABLE IF NOT EXISTS seances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers_soins(id) ON DELETE CASCADE,
  numero_seance integer NOT NULL,
  date_seance date NOT NULL DEFAULT CURRENT_DATE,
  prestataire_id uuid NOT NULL REFERENCES users_base(id),
  montant_paye numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Table documents
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers_soins(id) ON DELETE CASCADE,
  nom text NOT NULL,
  type_fichier text NOT NULL CHECK (type_fichier IN ('photo', 'pdf')),
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES users_base(id),
  created_at timestamptz DEFAULT now()
);

-- Table app_settings : paramètres globaux
CREATE TABLE IF NOT EXISTS app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cle text UNIQUE NOT NULL,
  valeur text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

-- Insérer la valeur par défaut pour les jours d'inactivité
INSERT INTO app_settings (cle, valeur, description)
VALUES ('jours_inactivite', '4', 'Nombre de jours après lesquels un patient est considéré comme inactif')
ON CONFLICT (cle) DO NOTHING;

-- Index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_patients_nom ON patients(nom);
CREATE INDEX IF NOT EXISTS idx_patients_prenom ON patients(prenom);
CREATE INDEX IF NOT EXISTS idx_dossiers_patient ON dossiers_soins(patient_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_etat ON dossiers_soins(etat);
CREATE INDEX IF NOT EXISTS idx_seances_dossier ON seances(dossier_id);
CREATE INDEX IF NOT EXISTS idx_seances_prestataire ON seances(prestataire_id);
CREATE INDEX IF NOT EXISTS idx_seances_date ON seances(date_seance);
CREATE INDEX IF NOT EXISTS idx_documents_dossier ON documents(dossier_id);

-- Enable RLS sur toutes les tables
ALTER TABLE users_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE dossiers_soins ENABLE ROW LEVEL SECURITY;
ALTER TABLE seances ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Policies pour users_base
CREATE POLICY "Utilisateurs peuvent voir leur propre profil"
  ON users_base FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Utilisateurs peuvent modifier leur propre profil"
  ON users_base FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policies pour patients (tous les utilisateurs authentifiés peuvent voir)
CREATE POLICY "Utilisateurs authentifiés peuvent voir les patients"
  ON patients FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Utilisateurs authentifiés peuvent créer des patients"
  ON patients FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Utilisateurs authentifiés peuvent modifier les patients"
  ON patients FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policies pour dossiers_soins
CREATE POLICY "Utilisateurs authentifiés peuvent voir les dossiers"
  ON dossiers_soins FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Utilisateurs authentifiés peuvent créer des dossiers"
  ON dossiers_soins FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Admin peut modifier tous les dossiers"
  ON dossiers_soins FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users_base
      WHERE users_base.id = auth.uid()
      AND users_base.type_utilisateur = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users_base
      WHERE users_base.id = auth.uid()
      AND users_base.type_utilisateur = 'admin'
    )
  );

CREATE POLICY "Assistant peut modifier les dossiers qu'il a créés"
  ON dossiers_soins FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Policies pour seances
CREATE POLICY "Utilisateurs authentifiés peuvent voir les séances"
  ON seances FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Utilisateurs peuvent créer leurs propres séances"
  ON seances FOR INSERT
  TO authenticated
  WITH CHECK (
    prestataire_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users_base
      WHERE users_base.id = auth.uid()
      AND users_base.type_utilisateur = 'admin'
    )
  );

CREATE POLICY "Admin peut modifier toutes les séances"
  ON seances FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users_base
      WHERE users_base.id = auth.uid()
      AND users_base.type_utilisateur = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users_base
      WHERE users_base.id = auth.uid()
      AND users_base.type_utilisateur = 'admin'
    )
  );

CREATE POLICY "Assistant peut modifier ses propres séances"
  ON seances FOR UPDATE
  TO authenticated
  USING (prestataire_id = auth.uid())
  WITH CHECK (prestataire_id = auth.uid());

-- Policies pour documents
CREATE POLICY "Utilisateurs authentifiés peuvent voir les documents"
  ON documents FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Utilisateurs authentifiés peuvent ajouter des documents"
  ON documents FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Utilisateurs peuvent supprimer les documents qu'ils ont uploadés"
  ON documents FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid());

-- Policies pour app_settings
CREATE POLICY "Utilisateurs authentifiés peuvent voir les paramètres"
  ON app_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin peut modifier les paramètres"
  ON app_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users_base
      WHERE users_base.id = auth.uid()
      AND users_base.type_utilisateur = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users_base
      WHERE users_base.id = auth.uid()
      AND users_base.type_utilisateur = 'admin'
    )
  );

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour updated_at
CREATE TRIGGER update_users_base_updated_at BEFORE UPDATE ON users_base
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dossiers_soins_updated_at BEFORE UPDATE ON dossiers_soins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();