/* Réglages du site. Ce fichier est le seul à modifier pour changer le mot de
   passe : régénérez l'empreinte avec `python3 scripts/mot_de_passe.py`.

   L'empreinte SHA-256 évite d'écrire le mot de passe en clair dans le dépôt,
   mais elle ne le rend pas indevinable : le contrôle s'exécute dans le
   navigateur et les données restent téléchargeables par qui connaît leur
   adresse. Ce sont des scrutins publics ; la porte réserve l'outil au groupe,
   elle ne garde pas un secret. */

window.CONFIG = {
  // « horizons2027 » — à changer avant diffusion.
  empreinteMotDePasse: 'd42c8813762dfce804382ee168ed835aee0c284c503185c385d1716191fa7068',
};
