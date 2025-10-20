/*
  # Add RLS policies for seances table with client filtering

  1. Security Policies
    - Users can only view seances from dossiers belonging to their client
    - Users can create seances for dossiers in their client
    - Users can update seances from their client's dossiers
    - Users can delete seances from their client's dossiers
  
  2. Notes
    - Seances are filtered through the dossiers_soins table
    - Only seances linked to dossiers with matching client_id are accessible
*/

-- Drop any existing policies on seances
DROP POLICY IF EXISTS "Users can view seances from same client" ON seances;
DROP POLICY IF EXISTS "Users can create seances for their client" ON seances;
DROP POLICY IF EXISTS "Users can update seances from same client" ON seances;
DROP POLICY IF EXISTS "Users can delete seances from same client" ON seances;

-- Policy for SELECT: users can view seances linked to dossiers from their client
CREATE POLICY "Users can view seances from same client"
  ON seances FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dossiers_soins
      WHERE dossiers_soins.id = seances.dossier_id
      AND dossiers_soins.client_id = public.get_user_client_id()
    )
  );

-- Policy for INSERT: users can create seances for dossiers in their client
CREATE POLICY "Users can create seances for their client"
  ON seances FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dossiers_soins
      WHERE dossiers_soins.id = seances.dossier_id
      AND dossiers_soins.client_id = public.get_user_client_id()
    )
  );

-- Policy for UPDATE: users can update seances from their client's dossiers
CREATE POLICY "Users can update seances from same client"
  ON seances FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dossiers_soins
      WHERE dossiers_soins.id = seances.dossier_id
      AND dossiers_soins.client_id = public.get_user_client_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dossiers_soins
      WHERE dossiers_soins.id = seances.dossier_id
      AND dossiers_soins.client_id = public.get_user_client_id()
    )
  );

-- Policy for DELETE: users can delete seances from their client's dossiers
CREATE POLICY "Users can delete seances from same client"
  ON seances FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dossiers_soins
      WHERE dossiers_soins.id = seances.dossier_id
      AND dossiers_soins.client_id = public.get_user_client_id()
    )
  );
