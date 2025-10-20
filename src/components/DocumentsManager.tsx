import { useState, useEffect, useRef } from 'react';
import { supabase, Document } from '../lib/supabase';
import { Upload, FileText, Image, Trash2, X, Camera } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface DocumentsManagerProps {
  dossierId: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export default function DocumentsManager({ dossierId }: DocumentsManagerProps) {
  const { userBase } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>('');

  useEffect(() => {
    loadDocuments();
  }, [dossierId]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('documents')
        .select('id, nom, type_fichier, storage_path, created_at, uploaded_by')
        .eq('dossier_id', dossierId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Erreur chargement documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const openDeleteConfirm = (doc: Document) => {
    setDeleteError('');
    setDocumentToDelete(doc);
  };

  const handleConfirmDelete = async () => {
    if (!documentToDelete) return;
    setDeleting(true);
    setDeleteError('');

    try {
      if (documentToDelete.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove([documentToDelete.storage_path]);
        if (storageError) throw storageError;
      }

      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', documentToDelete.id);
      if (dbError) throw dbError;

      setDocumentToDelete(null);
      await loadDocuments();
    } catch (err: any) {
      console.error('Erreur suppression document:', err);
      setDeleteError(err?.message || 'La suppression a échoué. Réessayez.');
    } finally {
      setDeleting(false);
    }
  };

  const getDocumentUrl = async (path: string) => {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 120);
    if (error) return '';
    return data?.signedUrl || '';
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Documents</h3>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm transition"
        >
          <Upload className="w-4 h-4" />
          Ajouter
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          Aucun document
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onAskDelete={() => openDeleteConfirm(doc)}
              getUrl={getDocumentUrl}
            />
          ))}
        </div>
      )}

      {showUploadModal && (
        <UploadDocumentModal
          dossierId={dossierId}
          userId={userBase?.id || ''}
          clientId={userBase?.client_id || ''}
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => {
            setShowUploadModal(false);
            loadDocuments();
          }}
        />
      )}

      {documentToDelete && (
        <ConfirmDeleteDocumentModal
          document={documentToDelete}
          loading={deleting}
          error={deleteError}
          onCancel={() => setDocumentToDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

/* ======= Carte Document ======= */
function DocumentCard({ document, onAskDelete, getUrl }: { document: Document; onAskDelete: () => void; getUrl: (path: string) => Promise<string>; }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const signedUrl = await getUrl(document.storage_path);
      if (alive) setUrl(signedUrl);
    })();
    return () => { alive = false; };
  }, [document.storage_path, getUrl]);

  const handleView = () => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
      <button onClick={handleView} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        {document.type_fichier === 'photo' ? (
          <Image className="w-5 h-5 text-teal-600 flex-shrink-0" />
        ) : (
          <FileText className="w-5 h-5 text-teal-600 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate">{document.nom}</p>
          <p className="text-xs text-gray-500">
            {new Date(document.created_at).toLocaleDateString('fr-FR')}
          </p>
        </div>
      </button>
      <button
        onClick={onAskDelete}
        className="p-2 text-red-600 hover:bg-red-50 rounded transition"
        title="Supprimer le document"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ======= Modal Upload ======= */
function UploadDocumentModal({ dossierId, userId, clientId, onClose, onSuccess }: { dossierId: string; userId: string; clientId: string; onClose: () => void; onSuccess: () => void; }) {
  const [nom, setNom] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // getUserMedia desktop
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  const startCameraDesktop = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }  // ✅ arrière par défaut
      });
      setStream(mediaStream);
      setShowCamera(true);
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
    } catch {
      alert("Impossible d'accéder à la caméra");
    }
  };

  const takePhoto = () => {
    if (videoRef.current && stream) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const photoFile = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
            if (photoFile.size > MAX_FILE_SIZE) {
              alert('Fichier trop volumineux (max 10 Mo)');
              return;
            }
            setFile(photoFile);
            if (!nom) setNom(`Photo ${new Date().toLocaleDateString('fr-FR')}`);
            stopCamera();
          }
        }, 'image/jpeg');
      }
    }
  };

  const stopCamera = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setShowCamera(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > MAX_FILE_SIZE) {
        alert('Fichier trop volumineux (max 10 Mo)');
        e.currentTarget.value = '';
        return;
      }
      if (!ALLOWED_TYPES.includes(f.type)) {
        alert('Type de fichier non supporté');
        e.currentTarget.value = '';
        return;
      }
      setFile(f);
      if (!nom) setNom(f.name.replace(/\.[^/.]+$/, ''));
    }
    e.currentTarget.value = '';
  };

  const handleCameraClick = () => {
    cameraInputRef.current?.click(); // sur mobile → input natif (caméra arrière par défaut via capture)
    startCameraDesktop();            // sur desktop → getUserMedia
  };

  const handleCameraFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > MAX_FILE_SIZE) {
        alert('Fichier trop volumineux (max 10 Mo)');
        e.currentTarget.value = '';
        return;
      }
      if (!ALLOWED_TYPES.includes(f.type)) {
        alert('Type de fichier non supporté');
        e.currentTarget.value = '';
        return;
      }
      setFile(f);
      if (!nom) setNom(`Photo ${new Date().toLocaleDateString('fr-FR')}`);
    }
    e.currentTarget.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (!clientId) { setError("Impossible de déterminer le client_id."); return; }

    setError('');
    setLoading(true);
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const filename = `${crypto.randomUUID()}.${ext}`;
      const storagePath = `${clientId}/${dossierId}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
          cacheControl: '3600',
        });
      if (uploadError) throw uploadError;

      const typeFichier: 'photo' | 'pdf' =
        file.type === 'application/pdf' ? 'pdf' : 'photo';

      const { error: dbError } = await supabase.from('documents').insert({
        dossier_id: dossierId,
        nom: nom.trim() || file.name,
        type_fichier: typeFichier,   // ✅ respecte contrainte
        storage_path: storagePath,
        uploaded_by: userId,
      });
      if (dbError) throw dbError;

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'upload");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Ajouter un document</h2>
          <button
            onClick={() => { stopCamera(); onClose(); }}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Inputs */}
        <input ref={galleryInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileSelect} className="hidden" />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleCameraFileSelected} className="hidden" />

        {showCamera ? (
          <div className="space-y-4">
            <video ref={videoRef} autoPlay className="w-full rounded-lg" />
            <div className="flex gap-2">
              <button onClick={takePhoto} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg">Prendre la photo</button>
              <button onClick={stopCamera} className="px-4 py-2 border border-gray-300 rounded-lg">Annuler</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nom du document *</label>
              <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} required className="w-full px-4 py-2 border rounded-lg" />
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => galleryInputRef.current?.click()} className="flex-1 px-4 py-2 border rounded-lg">Importer</button>
              <button type="button" onClick={handleCameraClick} className="flex-1 px-4 py-2 border rounded-lg">Caméra</button>
            </div>

            {file && <p className="text-sm text-gray-600 mt-2 truncate">Fichier: {file.name}</p>}
            {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg">{error}</div>}

            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Annuler</button>
              <button type="submit" disabled={loading || !file} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg">{loading ? 'Upload...' : 'Ajouter'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ======= Modal Confirmation Suppression ======= */
function ConfirmDeleteDocumentModal({ document, loading, error, onCancel, onConfirm }: { document: Document; loading: boolean; error?: string; onCancel: () => void; onConfirm: () => void; }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-red-50 text-red-600">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">Confirmer la suppression</h3>
            <p className="text-sm text-gray-700 mt-1">
              Vous êtes sur le point de supprimer le document <span className="font-semibold">{document.nom}</span>.
              Cette action supprimera définitivement le fichier et son enregistrement.
            </p>
            {error && <div className="mt-3 text-sm bg-red-50 text-red-700 px-3 py-2">{error}</div>}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={loading} className="px-4 py-2 border rounded-lg">Annuler</button>
          <button onClick={onConfirm} disabled={loading} className="px-4 py-2 bg-red-600 text-white rounded-lg">{loading ? 'Suppression…' : 'Supprimer'}</button>
        </div>
      </div>
    </div>
  );
}
