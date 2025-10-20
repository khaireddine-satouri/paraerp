/*
  # Ensure documents bucket configuration
  
  1. Changes
    - Verify documents bucket exists and is properly configured
    - Ensure all necessary policies are in place for authenticated users
  
  2. Security
    - Bucket remains private (not public)
    - Only authenticated users can upload, view, update and delete documents
*/

-- Ensure documents bucket exists (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Ensure all required policies exist
DO $$
BEGIN
  -- INSERT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload documents'
  ) THEN
    CREATE POLICY "Authenticated users can upload documents"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'documents');
  END IF;

  -- SELECT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can view documents'
  ) THEN
    CREATE POLICY "Authenticated users can view documents"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'documents');
  END IF;

  -- UPDATE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can update documents'
  ) THEN
    CREATE POLICY "Authenticated users can update documents"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'documents')
    WITH CHECK (bucket_id = 'documents');
  END IF;

  -- DELETE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can delete documents'
  ) THEN
    CREATE POLICY "Authenticated users can delete documents"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'documents');
  END IF;
END $$;
