/*
  # Create Multi-Tenant System with Clients

  1. New Tables
    - `clients`
      - `id` (uuid, primary key)
      - `nom` (text, client name)
      - `statut` (text, either 'actif' or 'inactif')
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Changes
    - Add `client_id` to `users_base` table to link users to clients
    - Add `client_id` to `patients` table to link patients to clients
    - Add `client_id` to `dossiers_soins` table to link dossiers to clients
  
  3. Security
    - Enable RLS on `clients` table
    - Users can only see their own client
    - Admins can only see users from the same client
    - All data is scoped to the user's client
*/

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  statut text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add client_id to users_base
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users_base' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE users_base ADD COLUMN client_id uuid REFERENCES clients(id);
  END IF;
END $$;

-- Add client_id to patients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE patients ADD COLUMN client_id uuid REFERENCES clients(id);
  END IF;
END $$;

-- Add client_id to dossiers_soins
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dossiers_soins' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE dossiers_soins ADD COLUMN client_id uuid REFERENCES clients(id);
  END IF;
END $$;

-- Enable RLS on clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Function to get current user's client_id
CREATE OR REPLACE FUNCTION public.get_user_client_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_client_id uuid;
BEGIN
  SELECT client_id INTO user_client_id
  FROM public.users_base
  WHERE id = auth.uid();
  
  RETURN user_client_id;
END;
$$;

-- Clients policies: users can only see their own client
DROP POLICY IF EXISTS "Users can view own client" ON clients;
CREATE POLICY "Users can view own client"
  ON clients FOR SELECT
  TO authenticated
  USING (id = public.get_user_client_id());

DROP POLICY IF EXISTS "Admins can update own client" ON clients;
CREATE POLICY "Admins can update own client"
  ON clients FOR UPDATE
  TO authenticated
  USING (
    id = public.get_user_client_id()
    AND public.current_user_is_admin()
  );

-- Update users_base policies to scope by client
DROP POLICY IF EXISTS "Users can view own profile or admins view all" ON users_base;
CREATE POLICY "Users can view own profile or admins view same client users"
  ON users_base FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id 
    OR 
    (public.current_user_is_admin() AND client_id = public.get_user_client_id())
  );

-- Update patients policies to scope by client
DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent voir les patients" ON patients;
CREATE POLICY "Users can view patients from same client"
  ON patients FOR SELECT
  TO authenticated
  USING (client_id = public.get_user_client_id());

DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent créer des patients" ON patients;
CREATE POLICY "Users can create patients for their client"
  ON patients FOR INSERT
  TO authenticated
  WITH CHECK (client_id = public.get_user_client_id());

DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent modifier les patients" ON patients;
CREATE POLICY "Users can update patients from same client"
  ON patients FOR UPDATE
  TO authenticated
  USING (client_id = public.get_user_client_id())
  WITH CHECK (client_id = public.get_user_client_id());

DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent supprimer les patients" ON patients;
CREATE POLICY "Users can delete patients from same client"
  ON patients FOR DELETE
  TO authenticated
  USING (client_id = public.get_user_client_id());

-- Update dossiers_soins policies to scope by client
DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent voir les dossiers" ON dossiers_soins;
CREATE POLICY "Users can view dossiers from same client"
  ON dossiers_soins FOR SELECT
  TO authenticated
  USING (client_id = public.get_user_client_id());

DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent créer des dossiers" ON dossiers_soins;
CREATE POLICY "Users can create dossiers for their client"
  ON dossiers_soins FOR INSERT
  TO authenticated
  WITH CHECK (client_id = public.get_user_client_id());

DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent modifier les dossiers" ON dossiers_soins;
CREATE POLICY "Users can update dossiers from same client"
  ON dossiers_soins FOR UPDATE
  TO authenticated
  USING (client_id = public.get_user_client_id())
  WITH CHECK (client_id = public.get_user_client_id());

DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent supprimer les dossiers" ON dossiers_soins;
CREATE POLICY "Users can delete dossiers from same client"
  ON dossiers_soins FOR DELETE
  TO authenticated
  USING (client_id = public.get_user_client_id());

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_users_base_client_id ON users_base(client_id);
CREATE INDEX IF NOT EXISTS idx_patients_client_id ON patients(client_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_soins_client_id ON dossiers_soins(client_id);
