import { useRef } from 'react';
import { Camera, Upload } from 'lucide-react';

interface PhotoUploadSectionProps {
  photoPreview: string | null;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void; // Importer (galerie/fichier)
  onPhotoCapture: (file: File) => void;                             // Caméra (photo prise)
}

export default function PhotoUploadSection({
  photoPreview,
  onPhotoChange,
  onPhotoCapture,
}: PhotoUploadSectionProps) {
  // Un input pour la galerie/fichiers
  const importInputRef = useRef<HTMLInputElement>(null);
  // Un input pour la caméra (capture natif)
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Handler dédié à la capture caméra (on appelle onPhotoCapture(file))
  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    onPhotoCapture(f);
    // on réinitialise la valeur pour pouvoir reprendre une autre photo immédiatement
    e.target.value = '';
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Photo du patient
      </label>

      <div className="flex items-center gap-4">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden">
          {photoPreview ? (
            <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
          ) : (
            <Camera className="w-8 h-8 text-gray-400" />
          )}
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            {/* ===== Importer (galerie/fichier) ===== */}
            <input
              ref={importInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                onPhotoChange(e);
                // idem, permet de sélectionner le même fichier à nouveau si besoin
                if (e.target) e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
            >
              <Upload className="w-4 h-4" />
              Importer
            </button>

            {/* ===== Caméra (capture natif) ===== */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"   // ← clé pour ouvrir la CAMÉRA sur mobile
              onChange={handleCameraChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
            >
              <Camera className="w-4 h-4" />
              Caméra
            </button>
          </div>

          <p className="text-xs text-gray-500">JPG, PNG ou WEBP</p>
        </div>
      </div>
    </div>
  );
}
