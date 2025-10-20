/*
  # Add PEC state to dossiers_soins

  1. Changes
    - Add etat_pec column to dossiers_soins table
    - Default value: 'en_cours' for dossiers with pec_cnam = true
    - Two possible values: 'en_cours' (PEC en cours) or 'depose' (PEC déposé)

  2. Security
    - No RLS changes needed, column follows existing security model
*/

-- Add etat_pec column to dossiers_soins
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dossiers_soins' AND column_name = 'etat_pec'
  ) THEN
    ALTER TABLE dossiers_soins 
    ADD COLUMN etat_pec text DEFAULT 'en_cours' CHECK (etat_pec IN ('en_cours', 'depose'));
  END IF;
END $$;

-- Update existing records with pec_cnam = true to have etat_pec = 'en_cours'
UPDATE dossiers_soins 
SET etat_pec = 'en_cours' 
WHERE pec_cnam = true AND etat_pec IS NULL;
