/*
  # Add automatic client_id assignment triggers

  1. New Functions
    - Function to auto-assign client_id to patients
    - Function to auto-assign client_id to dossiers
  
  2. Triggers
    - Trigger on patients INSERT to set client_id
    - Trigger on dossiers_soins INSERT to set client_id
  
  3. Notes
    - Ensures all new records automatically get the user's client_id
    - Prevents manual client_id manipulation
*/

-- Function to set client_id on patients
CREATE OR REPLACE FUNCTION public.set_patient_client_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set client_id from current user if not already set
  IF NEW.client_id IS NULL THEN
    NEW.client_id := public.get_user_client_id();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to set client_id on dossiers
CREATE OR REPLACE FUNCTION public.set_dossier_client_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set client_id from current user if not already set
  IF NEW.client_id IS NULL THEN
    NEW.client_id := public.get_user_client_id();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for patients
DROP TRIGGER IF EXISTS trigger_set_patient_client_id ON patients;
CREATE TRIGGER trigger_set_patient_client_id
  BEFORE INSERT ON patients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_patient_client_id();

-- Create trigger for dossiers_soins
DROP TRIGGER IF EXISTS trigger_set_dossier_client_id ON dossiers_soins;
CREATE TRIGGER trigger_set_dossier_client_id
  BEFORE INSERT ON dossiers_soins
  FOR EACH ROW
  EXECUTE FUNCTION public.set_dossier_client_id();
