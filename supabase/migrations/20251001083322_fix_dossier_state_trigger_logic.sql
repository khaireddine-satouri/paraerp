/*
  # Fix dossier state trigger logic

  1. Changes
    - If no seances: etat = 'a_venir'
    - If numero_seance < nombre_seances: etat = 'en_cours'
    - If numero_seance = nombre_seances: etat = 'termine' and set date_fin

  2. Logic
    - Only the first seance sets date_debut
    - Any seance < total sets status to 'en_cours'
    - Last seance sets status to 'termine' and date_fin
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
    
  ELSIF NEW.numero_seance < v_nombre_seances THEN
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
