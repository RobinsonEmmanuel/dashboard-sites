/**
 * Correspondance « Où » du tableau éditorial → sites du dashboard.
 *
 * La résolution est DYNAMIQUE : elle se fait contre la collection `sites`, pas contre
 * une liste figée dans le code — la liste des sites vit dans l'interface et une table
 * codée en dur y serait périmée dès le prochain site créé. La comparaison ignore la
 * casse, les accents et le suffixe « Lovers », de sorte que « Maroc » trouve
 * « Maroc Lovers » et « Crète » trouve « Crete ».
 *
 * Ne restent codés ici que les cas qu'aucune normalisation ne peut deviner : un nom
 * réellement différent entre le tableau et le dashboard, et les destinations publiées
 * sur PLUSIEURS sites à la fois.
 */

const NORMALISE = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\blovers\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Alias irréductibles : clé normalisée du tableau → un ou plusieurs `shortName`.
 *
 * « ZigZag » vaut deux sites : Claire publie le même article sur zigzagvoyages.fr et
 * zigzagonearth.com. C'est une copie à l'identique, donc DEUX publications pour UN
 * seul travail de rédaction — le dossier expose les deux mesures séparément et ne les
 * confond jamais.
 */
const ALIAS: Record<string, string[]> = {
  'zigzag': ['ZZ FR', 'ZZ EN'],
  'andalousie': ['Andalucia'],
  'corsica': ['Corse'],
  'canarias 1': ['Canarias'],
  'sicile': ['Sicilia'],
  'croatie': ['Croatia'],
};

export interface SiteConnu {
  shortName: string;
  name: string;
  active: boolean;
}

export interface ResolutionDestination {
  /** shortName des sites porteurs. Vide si la destination n'a pu être rattachée. */
  sites: string[];
  /** Vrai quand la destination est publiée sur plusieurs sites (même article dupliqué). */
  dupliquee: boolean;
  raison: string | null;
}

/**
 * @param destination Libellé de la colonne « Où ».
 * @param sitesConnus Sites du dashboard, lus en base.
 */
export function resoudreDestination(
  destination: string,
  sitesConnus: SiteConnu[],
): ResolutionDestination {
  const cle = NORMALISE(destination);

  const alias = ALIAS[cle];
  if (alias) {
    const trouves = alias.filter((sn) => sitesConnus.some((s) => s.shortName === sn));
    const manquants = alias.filter((sn) => !trouves.includes(sn));
    return {
      sites: trouves,
      dupliquee: trouves.length > 1,
      raison: manquants.length
        ? `Alias « ${destination} » → ${alias.join(', ')}, mais ${manquants.join(', ')} n'existe pas dans la collection sites.`
        : null,
    };
  }

  const parShortName = new Map(sitesConnus.map((s) => [NORMALISE(s.shortName), s.shortName]));
  const parNom = new Map(sitesConnus.map((s) => [NORMALISE(s.name), s.shortName]));
  const direct = parShortName.get(cle) ?? parNom.get(cle);
  if (direct) return { sites: [direct], dupliquee: false, raison: null };

  return {
    sites: [],
    dupliquee: false,
    raison: `« ${destination} » ne correspond à aucun site (ni shortName, ni nom). Créer le site dans l'interface, ou ajouter un alias dans lib/editorial/destinations.ts.`,
  };
}
