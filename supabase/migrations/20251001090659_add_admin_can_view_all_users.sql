/*
  # Allow admins to view all users

  1. Security Changes
    - Add policy for admins to view all users in users_base table
    - Admins need to see the list of prestataires in various parts of the application
  
  2. Notes
    - This policy checks the type_utilisateur field in users_base to determine if a user is an admin
    - Regular users can still only see their own profile
*/

-- Drop existing policy if needed and recreate with admin access
CREATE POLICY "Admins peuvent voir tous les utilisateurs"
  ON users_base FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users_base
      WHERE id = auth.uid()
      AND type_utilisateur = 'admin'
    )
  );
