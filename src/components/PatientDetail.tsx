import { useState, useEffect, useRef } from 'react';
import { supabase, Patient, DossierSoin } from '../lib/supabase';
import {
  ArrowLeft,
  Plus,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  CreditCard as Edit2,
  X,
  Trash2,
  User,
  Camera,
  Upload,
  Phone,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface PatientDetailProps {
  patient: Patient;
  onBack: () => void;
  onSelectDossier: (dossier: DossierSoin) => void;
}

export default function PatientDetail({ patient, onBack, onSelectDossier }: PatientDetailProps) {
  const { userBase } = useAuth();
  const isAdmin = userBase?.type_utilisateur === 'admin';
  const canDeletePhoto = ['admin', 'assistant'].includes(userBase?.type_utilisateur ?? '');

  const [dossiers, setDossiers] = useState<DossierSoin[]>([]);
  const [loading, setLoading] = useState(true);

  // --- photo locale : on ne dépend plus du prop après montage
  const [photoPath, setPhotoPath] = useState<string | null>((patient as any).photo_path ?? null);
  const [showDeletePhotoModal, setShowDeletePhotoModal] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [deletePhotoError, setDeletePhotoError] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Suppression dossier
  const [dossierToDelete, setDossierToDelete] = useState<DossierSoin | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>('');

  useEffect(() => {
    setPhotoPath((patient as any).photo_path ?? null); // si on change de patient
  }, [patient.id, (patient as any).photo_path]);

  useEffect(() => {
    loadDossiers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id]);

  const loadDossiers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('dossiers_soins')
        .select('*')
        .eq('patient_id', patient.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDossiers(data || []);
    } catch (error) {
      console.error('Erreur chargement dossiers:', error);
    } finally {
      setLoading(false);
    }
  };

  /** Suppression d’une photo patient (avec modal style dossier) */
  const confirmDeletePhoto = () => {
    setDeletePhotoError('');
    setShowDeletePhotoModal(true);
  };

  const handleConfirmDeletePhoto = async () => {
    if (!photoPath) return;
    setDeletingPhoto(true);
    setDeletePhotoError('');

    try {
      // 1) supprimer le fichier du storage (best-effort)
      await supabase.storage.from('patient_photos').remove([photoPath]).catch(() => {});

      // 2) mettre photo_path = null
      const { error: updErr } = await supabase
        .from('patients')
        .update({ photo_path: null })
        .eq('id', patient.id);
      if (updErr) throw updErr;

      // 3) MAJ immédiate UI
      setPhotoPath(null);
      setShowDeletePhotoModal(false);
    } catch (e: any) {
      console.error('Erreur suppression photo patient:', e);
      setDeletePhotoError(e?.message || 'La suppression a échoué. Réessayez.');
    } finally {
      setDeletingPhoto(false);
    }
  };

  /** Suppression d’un dossier (documents, séances, dossier) */
  const handleConfirmDeleteDossier = async () => {
    if (!dossierToDelete) return;
    setDeleting(true);
    setDeleteError('');

    try {
      const { data: docs, error: docsErr } = await supabase
        .from('documents')
        .select('id, storage_path')
        .eq('dossier_id', dossierToDelete.id);
      if (docsErr) throw docsErr;

      const paths = (docs || []).map((d) => d.storage_path).filter(Boolean);
      if (paths.length > 0) {
        const { error: stErr } = await supabase.storage.from('documents').remove(paths);
        if (stErr) throw stErr;
      }

      const { error: delDocsErr } = await supabase
        .from('documents')
        .delete()
        .eq('dossier_id', dossierToDelete.id);
      if (delDocsErr) throw delDocsErr;

      const { error: delSeancesErr } = await supabase
        .from('seances')
        .delete()
        .eq('dossier_id', dossierToDelete.id);
      if (delSeancesErr) throw delSeancesErr;

      const { error: delDosErr } = await supabase
        .from('dossiers_soins')
        .delete()
        .eq('id', dossierToDelete.id);
      if (delDosErr) throw delDosErr;

      setDossierToDelete(null);
      await loadDossiers();
    } catch (err: any) {
      console.error('Erreur suppression dossier:', err);
      setDeleteError(
        err?.message || "La suppression a échoué (vérifiez vos droits RLS et réessayez)."
      );
    } finally {
      setDeleting(false);
    }
  };

  const tel2 = (patient as any).telephone_2 as string | null | undefined;

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition"
      >
        <ArrowLeft className="w-5 h-5" />
        Retour
      </button>

      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          {/* Avatar + bouton suppression en overlay */}
          <div className="relative w-20 h-20">
            <div className="w-20 h-20 bg-teal-100 rounded-full flex items-center justify-center text-2xl font-bold text-teal-600 overflow-hidden">
              <PatientAvatar
                photoPath={photoPath}
                firstName={patient.prenom}
                lastName={patient.nom}
              />
            </div>

            {photoPath && canDeletePhoto && (
              <button
                onClick={confirmDeletePhoto}
                title="Supprimer la photo"
                className="absolute -top-1 -right-1 p-1 rounded-full bg-white shadow text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900">
              {patient.prenom} {patient.nom}
            </h2>

            <div className="mt-2 space-y-1 text-gray-700">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4" />
                <span>{patient.telephone}</span>
              </div>
              {tel2 ? (
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-4 h-4 opacity-70" />
                  <span>{tel2}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowEditModal(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition"
            >
              <Edit2 className="w-5 h-5" />
              Modifier
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition"
            >
              <Plus className="w-5 h-5" />
              Nouveau dossier
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Dossiers de soins</h3>
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
          </div>
        ) : dossiers.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">Aucun dossier de soins</p>
          </div>
        ) : (
          <div className="space-y-3">
            {dossiers.map((dossier) => (
              <DossierCard
                key={dossier.id}
                dossier={dossier}
                isAdmin={isAdmin}
                onOpen={() => onSelectDossier(dossier)}
                onAskDelete={() => {
                  if (!isAdmin) return;
                  setDeleteError('');
                  setDossierToDelete(dossier);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddDossierModal
          patientId={patient.id}
          clientId={patient.client_id as unknown as string}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            loadDossiers();
          }}
        />
      )}

      {showEditModal && (
        <EditPatientModal
          patient={patient}
          clientId={(patient as any).client_id as string}
          onClose={() => setShowEditModal(false)}
          // ⬇️ on reçoit le nouveau path et on met à jour immédiatement l’UI
          onSuccess={(newPath) => {
            setShowEditModal(false);
            setPhotoPath(newPath ?? null);
          }}
        />
      )}

      {dossierToDelete && (
        <ConfirmDeleteDossierModal
          dossier={dossierToDelete}
          loading={deleting}
          error={deleteError}
          onCancel={() => setDossierToDelete(null)}
          onConfirm={handleConfirmDeleteDossier}
        />
      )}

      {showDeletePhotoModal && (
        <ConfirmDeletePhotoModal
          loading={deletingPhoto}
          error={deletePhotoError}
          onCancel={() => setShowDeletePhotoModal(false)}
          onConfirm={handleConfirmDeletePhoto}
        />
      )}
    </div>
  );
}

/* ======= Avatar patient via signed URL (sans cache) ======= */
function PatientAvatar({
  photoPath,
  firstName,
  lastName,
}: {
  photoPath: string | null;
  firstName: string;
  lastName: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!photoPath) {
        if (alive) setUrl(null);
        return;
      }
      const { data, error } = await supabase.storage
        .from('patient_photos')
        .createSignedUrl(photoPath, 600);
      if (!error && data?.signedUrl && alive) {
        // petit cache-buster au cas où le navigateur recycle l’image
        setUrl(`${data.signedUrl}&cb=${Date.now()}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [photoPath]);

  if (!url) return <User className="w-8 h-8 text-teal-600" />;
  return (
    <img
      src={url}
      alt={`${firstName} ${lastName}`}
      className="w-full h-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

/* ================= Modal Édition Patient (caméra avant mobile + desktop) ================= */

interface EditPatientModalProps {
  patient: Patient;
  clientId: string;
  onClose: () => void;
  onSuccess: (newPhotoPath?: string | null) => void;
}

function EditPatientModal({ patient, clientId, onClose, onSuccess }: EditPatientModalProps) {
  const [nom, setNom] = useState(patient.nom);
  const [prenom, setPrenom] = useState(patient.prenom);
  const [telephone, setTelephone] = useState(patient.telephone);
  const [telephone2, setTelephone2] = useState<string>((patient as any).telephone_2 ?? ''); // NEW

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Inputs
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null); // mobile

  // Camera desktop
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  // Charger l’aperçu existant
  useEffect(() => {
    let alive = true;
    (async () => {
      const existingPath = (patient as any).photo_path as string | null;
      if (!existingPath) {
        if (alive) setPhotoPreview(null);
        return;
      }
      const { data, error } = await supabase.storage
        .from('patient_photos')
        .createSignedUrl(existingPath, 600);
      if (!error && alive) setPhotoPreview(data.signedUrl || null);
    })();
    return () => {
      alive = false;
    };
  }, [patient.id, (patient as any).photo_path]);

  const startCameraDesktop = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }, // caméra AVANT
      });
      setStream(mediaStream);
      setShowCamera(true);
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
    } catch {
      alert("Impossible d'accéder à la caméra");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    setShowCamera(false);
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
            const f = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
            setPhotoFile(f);
            const reader = new FileReader();
            reader.onloadend = () => setPhotoPreview(reader.result as string);
            reader.readAsDataURL(f);
            stopCamera();
          }
        }, 'image/jpeg');
      }
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(f);
    e.currentTarget.value = '';
  };

  const handleCameraClick = () => {
    // Mobile → input capture="user" (caméra avant)
    cameraInputRef.current?.click();

    // Desktop → getUserMedia
    if (
      !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      )
    ) {
      startCameraDesktop();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let newPhotoPath: string | null = (patient as any).photo_path || null;

      // Only do storage work if a new file was selected
      if (photoFile) {
        const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase();
        const filename = `${crypto.randomUUID()}.${ext}`;
        const folder = `${clientId}/${patient.id}`;
        const storagePath = `${folder}/${filename}`;

        // 1) Upload the new photo
        const { error: uploadError } = await supabase.storage
          .from('patient_photos')
          .upload(storagePath, photoFile, {
            contentType: photoFile.type || 'application/octet-stream',
            upsert: false,
            cacheControl: '3600',
          });
        if (uploadError) throw uploadError;

        newPhotoPath = storagePath;

        // 2) Cleanup: list all files in the patient's folder and delete everything except the new one
        const { data: files, error: listErr } = await supabase.storage
          .from('patient_photos')
          .list(folder, { limit: 1000 });
        if (listErr) {
          // Not fatal for UX; log and continue
          console.warn('List old patient photos failed:', listErr);
        } else {
          const pathsToRemove =
            (files || [])
              .map(f => `${folder}/${f.name}`)
              .filter(p => p !== newPhotoPath);

          if (pathsToRemove.length > 0) {
            const { error: rmErr } = await supabase.storage
              .from('patient_photos')
              .remove(pathsToRemove);
            if (rmErr) {
              console.warn('Removing old patient photos failed:', rmErr);
            }
          }
        }
      }

      // 3) Update DB (inclut téléphone_2)
      const { error: updateError } = await supabase
        .from('patients')
        .update({
          nom: nom.trim(),
          prenom: prenom.trim(),
          telephone: telephone.trim(),
          telephone_2: telephone2.trim() || null, // NEW
          photo_path: newPhotoPath,
        })
        .eq('id', patient.id);
      if (updateError) throw updateError;

      // 4) Instant UI update in parent
      onSuccess(newPhotoPath ?? null);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la modification du patient');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">Modifier le patient</h2>
          <button onClick={() => { stopCamera(); onClose(); }} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {showCamera ? (
          <div className="space-y-4">
            <video ref={videoRef} autoPlay className="w-full rounded-lg" />
            <div className="flex gap-2">
              <button
                onClick={takePhoto}
                className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition"
              >
                Prendre la photo
              </button>
              <button
                onClick={stopCamera}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                {photoPreview ? (
                  <img src={photoPreview} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-7 h-7 text-teal-600" />
                )}
              </div>

              <div className="flex-1 flex gap-2">
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"   // ✅ caméra avant par défaut sur mobile
                  onChange={handlePhotoChange}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm"
                >
                  <Upload className="w-4 h-4" />
                  Importer
                </button>
                <button
                  type="button"
                  onClick={handleCameraClick}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm"
                >
                  <Camera className="w-4 h-4" />
                  Caméra
                </button>
              </div>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nom *</label>
            <input
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Prénom *</label>
            <input
              type="text"
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Téléphone *</label>
            <input
              type="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Téléphone 2 (optionnel)</label>
            <input
              type="tel"
              value={telephone2}
              onChange={(e) => setTelephone2(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { stopCamera(); onClose(); }}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Modification...' : 'Modifier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ================= Carte Dossier ================= */

function DossierCard({
  dossier,
  isAdmin,
  onOpen,
  onAskDelete,
}: {
  dossier: DossierSoin;
  isAdmin: boolean;
  onOpen: () => void;
  onAskDelete: () => void;
}) {
  const [seanceCount, setSeanceCount] = useState(0);
  const [totalPaye, setTotalPaye] = useState(0);

  useEffect(() => {
    loadSeances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossier.id]);

  const loadSeances = async () => {
    const { data, error } = await supabase
      .from('seances')
      .select('montant_paye')
      .eq('dossier_id', dossier.id);

    if (!error && data) {
      setSeanceCount(data.length);
      const total = data.reduce((sum, s) => sum + (s.montant_paye || 0), 0);
      setTotalPaye(total);
    }
  };

  const totalDu = seanceCount * dossier.prix_par_seance;
  const estPaye = totalPaye >= totalDu;

  const getEtatBadge = (etat: string) => {
    const styles = {
      a_venir: 'bg-blue-100 text-blue-700',
      en_cours: 'bg-green-100 text-green-700',
      termine: 'bg-gray-100 text-gray-700',
    } as const;
    const labels = {
      a_venir: 'À venir',
      en_cours: 'En cours',
      termine: 'Terminé',
    } as const;
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[etat as keyof typeof styles]}`}>
        {labels[etat as keyof typeof labels]}
      </span>
    );
  };

  return (
    <div className="w-full bg-white p-4 rounded-lg shadow hover:shadow-md transition">
      <div className="flex items-start justify-between gap-4 mb-3">
        <button className="text-left flex-1" onClick={onOpen} title="Ouvrir le dossier">
          <h4 className="font-semibold text-gray-900">{dossier.motif}</h4>
        </button>
        <div className="flex items-center gap-2">
          {getEtatBadge(dossier.etat)}
          {isAdmin && (
            <button
              type="button"
              onClick={onAskDelete}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
              title="Supprimer le dossier"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <button className="w-full text-left" onClick={onOpen} title="Ouvrir le dossier">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <Clock className="w-4 h-4" />
            Séances: {seanceCount} / {dossier.nombre_seances}
          </div>

          {dossier.pec_cnam && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-teal-600">
                <CheckCircle className="w-4 h-4" />
                PEC Assurance - {dossier.etat_pec === 'depose' ? 'Déposé' : 'En cours'}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-gray-600">Paiement:</span>
            <span className={`font-medium ${estPaye ? 'text-green-600' : 'text-orange-600'}`}>
              {totalPaye.toFixed(2)} DT / {totalDu.toFixed(2)} DT
              {!estPaye && <AlertCircle className="w-4 h-4 inline ml-1" />}
            </span>
          </div>
        </div>
      </button>
    </div>
  );
}

/* ================= Modal Ajout Dossier ================= */

interface AddDossierModalProps {
  patientId: string;
  clientId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AddDossierModal({ patientId, clientId, onClose, onSuccess }: AddDossierModalProps) {
  const [motif, setMotif] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [nombreSeances, setNombreSeances] = useState(''); // string pour permettre vide
  const [pecCnam, setPecCnam] = useState(false);
  const [etatPec, setEtatPec] = useState<'en_cours' | 'depose'>('en_cours');
  const [prixParSeance, setPrixParSeance] = useState(''); // string pour permettre vide
  const [dateDebut, setDateDebut] = useState('');         // 'YYYY-MM-DD' ou ''
  const [dateFin, setDateFin] = useState('');             // 'YYYY-MM-DD' ou ''
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Helpers clamp (>= 0)
  const clampIntNonNeg = (v: string) => {
    if (v.trim() === '') return '';
    const parsed = Number.parseInt(v, 10);
    if (!Number.isFinite(parsed)) return '';
    return String(Math.max(0, parsed));
  };
  const clampNumNonNeg = (v: string) => {
    if (v.trim() === '') return '';
    const parsed = Number.parseFloat(v);
    if (!Number.isFinite(parsed)) return '';
    return String(Math.max(0, parsed));
  };

  // Handlers dates avec recadrage automatique
  const handleDateDebutChange = (v: string) => {
    setDateDebut(v);
    if (v && dateFin && v > dateFin) {
      setDateFin(v);
    }
  };
  const handleDateFinChange = (v: string) => {
    setDateFin(v);
    if (v && dateDebut && dateDebut > v) {
      setDateDebut(v);
    }
  };

  const minEndDate = dateDebut || undefined;
  const maxStartDate = dateFin || undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const ns = Math.max(0, Number.parseInt(nombreSeances || '0', 10) || 0);
      const prix = Math.max(0, Number.parseFloat(prixParSeance || '0') || 0);

      if (dateDebut && dateFin && dateFin < dateDebut) {
        throw new Error('La date de fin ne peut pas être antérieure à la date de début.');
      }

      const { data: { user } } = await supabase.auth.getUser();

      const { error: insertError } = await supabase.from('dossiers_soins').insert({
        patient_id: patientId,
        motif: motif.trim(),
        commentaire: commentaire.trim(),
        nombre_seances: ns,
        pec_cnam: pecCnam,
        etat_pec: pecCnam ? etatPec : null,
        prix_par_seance: prix,
        date_debut: dateDebut || null,
        date_fin: dateFin || null,
        created_by: user?.id,
        client_id: clientId,
        etat: 'a_venir',
      });

      if (insertError) throw insertError;
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la création du dossier');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-xl max-w-2xl w-full p-6 space-y-4 my-8">
        <h2 className="text-xl font-bold text-gray-900">Nouveau dossier de soins</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Motif *</label>
            <input
              type="text"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Commentaire</label>
            <textarea
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nombre de séances</label>
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min={0}
                value={nombreSeances}
                onChange={(e) => setNombreSeances(clampIntNonNeg(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Prix par séance (DT)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={prixParSeance}
                onChange={(e) => setPrixParSeance(clampNumNonNeg(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pec"
                checked={pecCnam}
                onChange={(e) => setPecCnam(e.target.checked)}
                className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
              />
              <label htmlFor="pec" className="text-sm font-medium text-gray-700">
                Prise en charge Assurance
              </label>
            </div>

            {pecCnam && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">État PEC</label>
                <select
                  value={etatPec}
                  onChange={(e) => setEtatPec(e.target.value as 'en_cours' | 'depose')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="en_cours">PEC en cours</option>
                  <option value="depose">PEC déposé</option>
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date de début</label>
              <input
                type="date"
                value={dateDebut}
                onChange={(e) => handleDateDebutChange(e.target.value)}
                max={maxStartDate}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date de fin</label>
              <input
                type="date"
                value={dateFin}
                onChange={(e) => handleDateFinChange(e.target.value)}
                min={minEndDate}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Création...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ================= Modal Confirmation Suppression Dossier ================= */

function ConfirmDeleteDossierModal({
  dossier,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  dossier: DossierSoin;
  loading: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-red-50 text-red-600">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">Supprimer ce dossier ?</h3>
            <p className="text-sm text-gray-700 mt-1">
              Vous êtes sur le point de supprimer le dossier <span className="font-semibold">« {dossier.motif} »</span>.
              Cette action supprimera également toutes les séances et tous les documents rattachés.
              <br />
              <span className="font-medium">Cette opération est irréversible.</span>
            </p>
            {error && (
              <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-50"
          >
            {loading ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= Modal Confirmation Suppression Photo ================= */

function ConfirmDeletePhotoModal({
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  loading: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-red-50 text-red-600">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">Supprimer la photo du patient ?</h3>
            <p className="text-sm text-gray-700 mt-1">
              Cette action supprimera définitivement le fichier associé et retirera la photo du profil.
              <br />
              <span className="font-medium">Cette opération est irréversible.</span>
            </p>
            {error && (
              <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-50"
          >
            {loading ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}
