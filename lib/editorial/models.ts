/** Collections alimentées par l'import du tableau de production éditoriale. */

export const COLLECTION_ACTIVITE = 'editorial_activity';
export const COLLECTION_STOCK = 'editorial_stock';

/** Une semaine de production, pour une personne et une destination. */
export interface EditorialActivite {
  _id?: string;
  destination: string;
  /**
   * shortName des sites porteurs — plusieurs quand le même article est publié sur
   * plusieurs sites (ZigZag FR + EN). Tableau vide = destination non rattachée.
   */
  sites: string[];
  personne: string | null;
  /** Objectif affiché dans la colonne « Quoi » (ex. « MAJ + new max 3 »). */
  objectif: string | null;
  semaineDebut: string;   // YYYY-MM-DD (lundi)
  semaineFin: string;     // YYYY-MM-DD
  mois: string;           // YYYY-MM du début de semaine
  nouveaux: number | null;
  majs: number | null;
  notes: string[];
  importedAt: Date;
}

/** Photo du stock d'articles d'une destination à une date donnée. */
export interface EditorialStock {
  _id?: string;
  destination: string;
  sites: string[];
  dateStr: string;              // YYYY-MM-DD
  libelle: string;              // « ACTUEL », « 31 juillet »…
  publies: number | null;
  resteAMaj: number | null;
  importedAt: Date;
}
