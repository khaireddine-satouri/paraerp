/*
  # Création automatique des profils utilisateurs

  1. Fonction trigger
    - Fonction qui crée automatiquement une entrée dans users_base
    - Déclenchée à chaque création de compte dans auth.users
    - Définit des valeurs par défaut (type_utilisateur = 'assistant')

  2. Trigger
    - Se déclenche après l'insertion dans auth.users
    - Appelle la fonction pour créer le profil dans users_base

  3. Notes importantes
    - Le nom et prénom sont extraits du email par défaut
    - Le type est 'assistant' par défaut (l'admin devra le modifier manuellement)
    - Les métadonnées de l'utilisateur peuvent être utilisées si disponibles
*/

-- Fonction pour créer automatiquement un profil utilisateur
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users_base (id, nom, prenom, type_utilisateur)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nom', 'Nom'),
    COALESCE(NEW.raw_user_meta_data->>'prenom', 'Prénom'),
    COALESCE(NEW.raw_user_meta_data->>'type_utilisateur', 'assistant')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger pour créer le profil automatiquement
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();