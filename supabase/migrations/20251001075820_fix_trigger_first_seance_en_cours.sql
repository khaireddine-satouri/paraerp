/*
  # Fix trigger: first seance should set etat to 'en_cours'

  1. Changes
    - First seance (numero_seance = 1): sets date_debut to seance date and etat to 'en_cours' (not 'a_venir')
    - Middle seances (1 < numero_seance < nombre_seances): sets etat to 'en_cours'
    - Last seance (numero_seance = nombre_seances): sets date_fin to seance date and etat to 'termine'

  2. Logic
    - A dossier is only 'a_venir' when it has 0 seances
    - Once the first seance is recorded, the dossier is 'en_cours'
*/

-- Drop and recreate the function with corrected logic
DROP TRIGGER IF EXISTS trigger_update_dossier_on_seance_insert ON seances;
DROP FUNCTION IF EXISTS update_dossier_on_seance_insert();

-- Create function to update dossier dates and status
CREATE OR REPLACE FUNCTION update_dossier_on_seance_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_nombre_seances INTEGER;
BEGIN
  -- Get the total number of seances for this dossier
  SELECT nombre_seances INTO v_nombre_seances
  FROM dossiers_soins
  WHERE id = NEW.dossier_id;

  -- Update dossier based on seance number
  IF NEW.numero_seance = 1 THEN
    -- First seance: set date_debut and etat to 'en_cours'
    UPDATE dossiers_soins
    SET 
      date_debut = NEW.date_seance,
      etat = 'en_cours'
    WHERE id = NEW.dossier_id;
    
  ELSIF NEW.numero_seance > 1 AND NEW.numero_seance < v_nombre_seances THEN
    -- Middle seances: keep etat as 'en_cours'
    UPDATE dossiers_soins
    SET etat = 'en_cours'
    WHERE id = NEW.dossier_id;
    
  ELSIF NEW.numero_seance = v_nombre_seances THEN
    -- Last seance: set date_fin and etat to 'termine'
    UPDATE dossiers_soins
    SET 
      date_fin = NEW.date_seance,
      etat = 'termine'
    WHERE id = NEW.dossier_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
CREATE TRIGGER trigger_update_dossier_on_seance_insert
  AFTER INSERT ON seances
  FOR EACH ROW
  EXECUTE FUNCTION update_dossier_on_seance_insert();
