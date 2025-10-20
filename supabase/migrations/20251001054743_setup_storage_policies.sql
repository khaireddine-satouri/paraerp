/*
  # Configuration du stockage pour les documents

  1. Sécurité Storage
    - Configuration des policies pour le bucket documents
    - Utilisateurs authentifiés peuvent uploader des documents
    - Utilisateurs authentifiés peuvent voir tous les documents
    - Utilisateurs peuvent supprimer leurs propres documents

  2. Notes importantes
    - Les fichiers sont privés par défaut
    - Tous les utilisateurs authentifiés ont accès aux documents (contexte médical partagé)
*/

CREATE POLICY "Utilisateurs authentifiés peuvent uploader des documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Utilisateurs authentifiés peuvent voir les documents"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'documents');

CREATE POLICY "Utilisateurs peuvent supprimer leurs propres documents"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);