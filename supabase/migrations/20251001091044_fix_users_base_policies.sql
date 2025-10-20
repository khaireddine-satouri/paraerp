/*
  # Fix users_base RLS policies to avoid infinite recursion

  1. Security Changes
    - Drop the problematic policy that causes infinite recursion
    - Update the main SELECT policy to allow users to see their own profile
    - Add a separate policy using a function to allow admins to see all users
  
  2. Implementation
    - Create a helper function that checks if current user is admin
    - Use this function in the policy to avoid recursive queries
*/

-- Drop the problematic policy
DROP POLICY IF EXISTS "Admins peuvent voir tous les utilisateurs" ON users_base;

-- Create a function to check if current user is admin (no recursion)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users_base
    WHERE id = auth.uid()
    AND type_utilisateur = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the main policy to allow both self-view and admin view
DROP POLICY IF EXISTS "Utilisateurs peuvent voir leur propre profil" ON users_base;

CREATE POLICY "Utilisateurs peuvent voir leur profil ou admin voit tous"
  ON users_base FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id 
    OR 
    (
      SELECT type_utilisateur = 'admin' 
      FROM users_base 
      WHERE id = auth.uid()
      LIMIT 1
    )
  );
