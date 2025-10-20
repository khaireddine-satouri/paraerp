/*
  # Add updated_by column to patients table

  1. Changes
    - Add `updated_by` column to `patients` table
    - References `users_base(id)` to track who last updated the patient record
    - Column is nullable to allow for existing records
  
  2. Notes
    - This allows tracking of the last user who modified patient information
    - Useful for audit trails and accountability
*/

-- Add updated_by column to patients table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE patients ADD COLUMN updated_by uuid REFERENCES users_base(id);
  END IF;
END $$;