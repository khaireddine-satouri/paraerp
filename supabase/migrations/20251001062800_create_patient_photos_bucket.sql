/*
  # Create patient photos storage bucket

  1. New Storage Bucket
    - Create `patient_photos` bucket for storing patient profile pictures
    - Configure public access for easy display
  
  2. Security Policies
    - Allow authenticated users to upload photos
    - Allow authenticated users to view photos
    - Allow authenticated users to update photos
    - Allow authenticated users to delete photos
  
  3. Notes
    - Photos will be organized by patient ID
    - Maximum file size handled by Supabase defaults
    - Supported formats: jpg, jpeg, png, webp
*/

-- Create the patient_photos bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('patient_photos', 'patient_photos', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow authenticated users to upload photos
CREATE POLICY "Authenticated users can upload patient photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'patient_photos'
);

-- Policy: Allow everyone to view photos (since bucket is public)
CREATE POLICY "Anyone can view patient photos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'patient_photos');

-- Policy: Allow authenticated users to update photos
CREATE POLICY "Authenticated users can update patient photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'patient_photos')
WITH CHECK (bucket_id = 'patient_photos');

-- Policy: Allow authenticated users to delete photos
CREATE POLICY "Authenticated users can delete patient photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'patient_photos');