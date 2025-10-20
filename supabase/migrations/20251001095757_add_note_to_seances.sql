/*
  # Add note field to seances table

  1. Changes
    - Add `note` column to `seances` table to store session notes
    - Column is optional (nullable) and stores text
  
  2. Notes
    - Allows tracking additional information for each session
    - No default value required
*/

-- Add note column to seances table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seances' AND column_name = 'note'
  ) THEN
    ALTER TABLE seances ADD COLUMN note text;
  END IF;
END $$;
