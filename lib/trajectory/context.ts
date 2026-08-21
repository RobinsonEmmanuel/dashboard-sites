/**
 * Contexte métier injecté dans l'analyse de trajectoire.
 *
 * C'est l'équivalent du « profil client » d'auditor : sans lui, le modèle produit
 * des recommandations génériques qui ignorent ce qu'on cherche à faire. À relire
 * et corriger à chaque changement de cap — le fichier est versionné, donc chaque
 * analyse passée reste interprétable au vu du contexte de l'époque.
 *
 * Les noms de sites doivent être des `shortName` (cf. `lib/models/site.ts`).
 */

export interface ContexteMetier {
  /** Où on veut être et quand. Une phrase. */
  horizon: string;
  objectifs: string[];
  /** Sites où on investit du temps de production, dont on n'attend pas encore de revenu. */
  sites_en_investissement: string[];
  /** Sites matures dont on attend du revenu maintenant. */
  sites_en_recolte: string[];
  contraintes: string[];
  /** Les questions sur lesquelles l'analyse doit aider à trancher. */
  decisions_ouvertes: string[];
  /** Tout ce qui explique un chiffre et qui n'est pas dans la base (refonte, pénalité, saisonnalité exceptionnelle…). */
  evenements_a_connaitre: string[];
}

export const CONTEXTE_METIER: ContexteMetier = {
  horizon: 'À COMPLÉTER — ex. « doubler le revenu d\'affiliation à 24 mois sans augmenter le rythme de production »',
  objectifs: [
    'À COMPLÉTER — objectif chiffré pour l\'année en cours',
  ],
  sites_en_investissement: [],
  sites_en_recolte: [],
  contraintes: [
    'À COMPLÉTER — ex. temps de rédaction disponible par mois, budget outillage',
  ],
  decisions_ouvertes: [
    'À COMPLÉTER — ex. « faut-il lancer un nouveau site ou densifier les existants ? »',
  ],
  evenements_a_connaitre: [
    'À COMPLÉTER — ex. « refonte technique de Corsica Lovers en mars 2026 »',
  ],
};
