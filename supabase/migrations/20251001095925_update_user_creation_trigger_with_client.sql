/*
  # Update user creation trigger to handle client_id

  1. Changes
    - Update the trigger function to extract client_id from user metadata
    - When a new user signs up, their client_id should be set from auth metadata
  
  2. Notes
    - The client_id should be set in the user's raw_app_meta_data during signup
    - This allows proper multi-tenant isolation from the start
*/

-- Update the function to include client_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_nom text;
  user_prenom text;
  user_type text;
  user_client_id uuid;
BEGIN
  -- Extract metadata
  user_nom := COALESCE(new.raw_user_meta_data->>'nom', '');
  user_prenom := COALESCE(new.raw_user_meta_data->>'prenom', '');
  user_type := COALESCE(new.raw_app_meta_data->>'type_utilisateur', 'assistant');
  user_client_id := (new.raw_app_meta_data->>'client_id')::uuid;

  -- Insert into users_base
  INSERT INTO public.users_base (id, nom, prenom, type_utilisateur, client_id)
  VALUES (new.id, user_nom, user_prenom, user_type, user_client_id);

  RETURN new;
END;
$$;
