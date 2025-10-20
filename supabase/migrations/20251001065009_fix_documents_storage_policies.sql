/*
  # Fix document storage policies

  1. Changes
    - Add UPDATE policy for documents bucket to allow file metadata updates
    - This is required for proper file upload functionality
  
  2. Security
    - Only authenticated users can update files in the documents bucket
    - Maintains existing security model where all authenticated users can manage documents
*/

-- Add UPDATE policy for documents bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects'
      AND policyname = 'Utilisateurs authentifiés peuvent mettre à jour les documents'
  ) THEN
    CREATE POLICY "Utilisateurs authentifiés peuvent mettre à jour les documents"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'documents')
    WITH CHECK (bucket_id = 'documents');
  END IF;
END $$;