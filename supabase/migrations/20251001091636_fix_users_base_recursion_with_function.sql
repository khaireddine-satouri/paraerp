/*
  # Fix infinite recursion in users_base policies

  1. Changes
    - Create a SECURITY DEFINER function to check admin status without recursion
    - Replace the problematic policy with one using this function
    - This bypasses RLS when checking admin status
  
  2. Security
    - Function is SECURITY DEFINER so it runs with elevated privileges
    - Only checks admin status, doesn't expose other data
*/

-- Drop the problematic policy
DROP POLICY IF EXISTS "Utilisateurs peuvent voir leur profil ou admin voit tous" ON users_base;

-- Create a function that bypasses RLS to check admin status
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean;
BEGIN
  SELECT type_utilisateur = 'admin' INTO is_admin
  FROM public.users_base
  WHERE id = auth.uid();
  
  RETURN COALESCE(is_admin, false);
END;
$$;

-- Create new policy using the function
CREATE POLICY "Users can view own profile or admins view all"
  ON users_base FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id 
    OR 
    public.current_user_is_admin()
  );
