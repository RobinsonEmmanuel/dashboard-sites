/**
 * Veille externe — deux étages, comme la vérification factuelle de l'audit IA.
 *
 * Sert à répondre à « qu'est-ce qui s'est passé DEHORS » : mises à jour Google et
 * AI Overviews, conjoncture touristique, géopolitique, canicules, réglementation.
 *
 * 1. COLLECTE — Perplexity (`sonar-pro`), une requête par axe, en parallèle. Le
 *    découpage par axe compte autant que le choix du moteur : une question large
 *    ramène trois généralités, sept questions ciblées ramènent des chiffres. C'est
 *    l'étage où le rappel se gagne, notamment sur les chiffres de fréquentation, qui
 *    vivent dans des pages institutionnelles et des PDF qu'une recherche généraliste
 *    survole.
 *
 * 2. STRUCTURATION — gpt-5.6-sol reçoit UNIQUEMENT le matériau collecté et ses
 *    citations, et en tire la chronologie au schéma strict : datation, périmètre
 *    géographique, transposabilité. Il ne cherche rien lui-même, donc il ne peut pas
 *    introduire un fait non sourcé. C'est le même modèle que la passe d'analyse, donc
 *    le même vocabulaire.
 *
 * Deux règles de conception, qui déterminent tout le reste :
 *
 * A. La veille produit une CHRONOLOGIE DATÉE, pas de la prose. Un événement daté et
 *    délimité géographiquement peut être confronté aux séries mensuelles du dossier ;
 *    un paragraphe d'ambiance ne peut rien confronter. C'est la date qui a de la
 *    valeur, pas le récit.
 *
 * B. La veille ne fournit JAMAIS un effet chiffré sur nos sites. Pour « les
 *    AI Overviews font baisser le trafic », la meilleure preuve concernant nos sites
 *    est déjà dans le dossier — impressions, clics, CTR et position, par site et par
 *    mois. Une étude tierce sur un autre corpus ne mesure pas nos sites ; elle fournit
 *    une hypothèse datée que nos propres chiffres valident ou non. Tout chiffre externe
 *    est donc conservé avec sa source, son périmètre et sa période de référence, et
 *    marqué selon qu'il est transposable ou non.
 */

import OpenAI from 'openai';

/** Collecte : le tier le plus large de Perplexity, pour le rappel et les citations. */
const MODELE_COLLECTE = 'sonar-pro';
const URL_PERPLEXITY = 'https://api.perplexity.ai';

/** Structuration : même modèle que la passe d'analyse, pour un vocabulaire cohérent. */
const MODELE_STRUCTURATION = 'gpt-5.6-sol';
const EFFORT_STRUCTURATION = 'medium';

export type CategorieVeille =
  | 'google_algorithme' | 'ia_generative' | 'conjoncture_touristique'
  | 'geopolitique' | 'meteo_climat' | 'reglementation' | 'concurrence_plateformes';

export interface EvenementVeille {
  categorie: CategorieVeille;
  titre: string;
  description: string;
  date_debut: string;
  date_fin: string | null;
  portee_geographique: string[];
  destinations_concernees: string[];
  chiffre_cle: {
    valeur: string;
    perimetre: string;
    periode_de_reference: string;
  } | null;
  effet_attendu: 'hausse' | 'baisse' | 'incertain';
  effet_attendu_sur: 'trafic_seo' | 'demande_touristique' | 'taux_de_conversion' | 'plusieurs';
  source_nom: string;
  source_url: string;
  date_publication_source: string;
  fiabilite_source: 'officielle' | 'presse_specialisee' | 'presse_generaliste' | 'etude_privee' | 'blog';
  applicabilite_a_nos_sites: 'directe' | 'indirecte' | 'non_transposable';
}

export interface ResultatVeille {
  evenements: EvenementVeille[];
  angles_non_couverts: string[];
}

const SCHEMA_VEILLE = {
  type: 'object',
  properties: {
    evenements: {
      type: 'array',
      description:
        'Chronologie datée des faits externes. Chaque entrée doit être sourcée par une URL consultable et datée. Pas de doublon, pas de fait sans date.',
      items: {
        type: 'object',
        properties: {
          categorie: {
            type: 'string',
            enum: ['google_algorithme', 'ia_generative', 'conjoncture_touristique', 'geopolitique', 'meteo_climat', 'reglementation', 'concurrence_plateformes'],
          },
          titre: { type: 'string', description: 'Le fait, en une ligne' },
          description: { type: 'string', description: 'Deux à quatre phrases : quoi, où, et pourquoi cela peut compter pour des sites de contenu voyage' },
          date_debut: { type: 'string', description: 'YYYY-MM-DD si le jour est connu, sinon YYYY-MM. Jamais une année seule.' },
          date_fin: { type: ['string', 'null'], description: 'Même format, ou null si l\'événement est ponctuel ou toujours en cours' },
          portee_geographique: {
            type: 'array', items: { type: 'string' },
            description: 'Pays ou marchés linguistiques concernés (ex. « France », « marché anglophone »). Un déploiement Google limité aux États-Unis ne concerne pas un site francophone.',
          },
          destinations_concernees: {
            type: 'array', items: { type: 'string' },
            description: 'Uniquement des destinations de la liste fournie dans le contexte. Tableau vide si l\'événement est transversal.',
          },
          chiffre_cle: {
            type: ['object', 'null'],
            description: 'Un seul chiffre, celui qui permet de juger l\'ampleur. null si aucun chiffre fiable n\'existe — préférable à un ordre de grandeur inventé.',
            properties: {
              valeur: { type: 'string', description: 'Le chiffre avec son unité, tel que publié (ex. « -12 % de nuitées », « 4,2 millions de visiteurs »)' },
              perimetre: { type: 'string', description: 'Sur quoi porte exactement ce chiffre (pays, secteur, corpus de sites étudié)' },
              periode_de_reference: { type: 'string', description: 'La période mesurée, et celle à laquelle elle est comparée' },
            },
            required: ['valeur', 'perimetre', 'periode_de_reference'],
            additionalProperties: false,
          },
          effet_attendu: { type: 'string', enum: ['hausse', 'baisse', 'incertain'] },
          effet_attendu_sur: { type: 'string', enum: ['trafic_seo', 'demande_touristique', 'taux_de_conversion', 'plusieurs'] },
          source_nom: { type: 'string' },
          source_url: { type: 'string', description: 'URL consultable de la source primaire. Jamais une page d\'accueil.' },
          date_publication_source: { type: 'string', description: 'YYYY-MM-DD ou YYYY-MM' },
          fiabilite_source: {
            type: 'string',
            enum: ['officielle', 'presse_specialisee', 'presse_generaliste', 'etude_privee', 'blog'],
            description: 'officielle = institut statistique, office de tourisme national, communication Google. etude_privee = éditeur ou agence SEO.',
          },
          applicabilite_a_nos_sites: {
            type: 'string',
            enum: ['directe', 'indirecte', 'non_transposable'],
            description:
              'directe = porte sur nos marchés et notre type de contenu. indirecte = mécanisme plausible mais périmètre différent. non_transposable = chiffre mesuré sur un autre corpus, à ne jamais appliquer à nos sites.',
          },
        },
        required: ['categorie', 'titre', 'description', 'date_debut', 'date_fin', 'portee_geographique', 'destinations_concernees', 'chiffre_cle', 'effet_attendu', 'effet_attendu_sur', 'source_nom', 'source_url', 'date_publication_source', 'fiabilite_source', 'applicabilite_a_nos_sites'],
        additionalProperties: false,
      },
    },
    angles_non_couverts: {
      type: 'array', items: { type: 'string' },
      description: 'Ce que la recherche n\'a pas permis d\'établir faute de source fiable. Explicite plutôt que silencieux.',
    },
  },
  required: ['evenements', 'angles_non_couverts'],
  additionalProperties: false,
} as const;

/* ────────────────────────── Étage 1 : la collecte ──────────────────────────── */

interface AxeVeille {
  cle: string;
  titre: string;
  question: (ctx: { destinations: string[]; marches: string[]; mois: number; aujourdhui: string }) => string;
}

/**
 * Sept axes plutôt qu'une question large. Chaque axe est formulé pour appeler des
 * faits datés et des sources primaires, et pour autoriser explicitement la réponse
 * « je n'ai pas trouvé » — une case vide vaut mieux qu'un chiffre inventé.
 */
const AXES: AxeVeille[] = [
  {
    cle: 'google_algorithme',
    titre: 'Mises à jour de l\'algorithme Google',
    question: ({ mois, aujourdhui }) =>
      `Nous sommes le ${aujourdhui}. Liste les mises à jour de l'algorithme de Google confirmées par Google ` +
      `sur les ${mois} derniers mois : core updates, spam updates, mises à jour du système de reviews et ` +
      `toute autre modification annoncée. Pour chacune : nom exact, date de début et date de fin de ` +
      `déploiement, ce que Google en a dit, et les effets constatés sur les sites de contenu éditorial. ` +
      `Cite la source primaire (blog Google Search Central en priorité) avec sa date de publication.`,
  },
  {
    cle: 'ia_generative',
    titre: 'AI Overviews, mode IA et effet sur le clic',
    question: ({ marches, mois, aujourdhui }) =>
      `Nous sommes le ${aujourdhui}. Deux questions distinctes sur les ${mois} derniers mois.\n` +
      `1) CHRONOLOGIE DE DÉPLOIEMENT : à quelles dates les AI Overviews de Google, puis le mode IA, ` +
      `ont-ils été déployés dans chaque pays et chaque langue, en particulier pour ces marchés : ` +
      `${marches.join(' ; ')} ? Je veux les dates par marché, pas une date globale.\n` +
      `2) EFFET MESURÉ SUR LE CLIC : quelles études chiffrent la variation du taux de clic depuis les ` +
      `résultats de recherche lorsque des AI Overviews sont présents ? Pour chacune : qui l'a publiée, ` +
      `à quelle date, sur quel corpus de sites et de requêtes, avec quelle méthode, et le chiffre exact. ` +
      `Précise si le corpus étudié comporte du contenu voyage et dans quelles langues. ` +
      `Cite les sources avec leurs dates.`,
  },
  {
    cle: 'conjoncture_touristique',
    titre: 'Fréquentation touristique des destinations couvertes',
    question: ({ destinations, mois, aujourdhui }) =>
      `Nous sommes le ${aujourdhui}. Quels sont les chiffres officiels de fréquentation touristique ` +
      `publiés sur les ${mois} derniers mois pour ces destinations : ${destinations.join(', ')} ? ` +
      `Privilégie les sources officielles : instituts statistiques nationaux, offices de tourisme ` +
      `nationaux ou régionaux, Eurostat, ONU Tourisme. Pour chaque chiffre, donne impérativement la ` +
      `PÉRIODE MESURÉE et la PÉRIODE DE COMPARAISON (par exemple « nuitées de mai à juillet 2026 versus ` +
      `même période 2025 »), l'indicateur exact (arrivées, nuitées, passagers aériens) et l'URL de la ` +
      `publication. Si tu n'as pas de chiffre officiel pour une destination, dis-le explicitement pour ` +
      `cette destination plutôt que de citer une estimation de presse.`,
  },
  {
    cle: 'geopolitique',
    titre: 'Géopolitique et sécurité affectant les réservations',
    question: ({ destinations, mois, aujourdhui }) =>
      `Nous sommes le ${aujourdhui}. Quels événements géopolitiques ou de sécurité des ${mois} derniers ` +
      `mois ont affecté les intentions de voyage ou les réservations vers ces destinations, ou les grands ` +
      `flux qui les concernent : ${destinations.join(', ')} ? Inclus les conflits, les avis officiels aux ` +
      `voyageurs, les fermetures d'espace aérien et les annulations de vols massives. Pour chacun : dates ` +
      `de début et de fin, pays et régions concernés, et si possible l'effet chiffré sur les réservations ` +
      `avec sa source. Ignore ce qui ne concerne aucune de ces destinations.`,
  },
  {
    cle: 'meteo_climat',
    titre: 'Météo et climat',
    question: ({ destinations, mois, aujourdhui }) =>
      `Nous sommes le ${aujourdhui}. Quels épisodes météorologiques ou climatiques marquants des ${mois} ` +
      `derniers mois ont touché ces destinations : ${destinations.join(', ')} ? Canicules, incendies, ` +
      `inondations, tempêtes, éruptions. Pour chacun : dates précises, zones touchées, et tout élément ` +
      `chiffré sur l'effet touristique (annulations, fermetures de sites, baisse de fréquentation) avec ` +
      `sa source et sa date.`,
  },
  {
    cle: 'reglementation',
    titre: 'Réglementation touristique',
    question: ({ destinations, aujourdhui }) =>
      `Nous sommes le ${aujourdhui}. Quelles évolutions réglementaires touchant les voyageurs sont ` +
      `entrées en vigueur récemment, ou sont programmées à une date connue, pour ces destinations : ` +
      `${destinations.join(', ')} ? Inclus les taxes de séjour, les quotas et jauges de visiteurs, les ` +
      `réservations obligatoires de créneaux, les restrictions d'accès à des sites naturels, les ` +
      `changements sur les locations de courte durée, et les dispositifs d'entrée dans l'espace ` +
      `Schengen (EES, ETIAS). Pour chaque mesure : date d'entrée en vigueur, périmètre exact, et source ` +
      `officielle.`,
  },
  {
    cle: 'concurrence_plateformes',
    titre: 'Plateformes de réservation et programmes d\'affiliation',
    question: ({ mois, aujourdhui }) =>
      `Nous sommes le ${aujourdhui}. Quels changements des ${mois} derniers mois concernent Booking.com, ` +
      `GetYourGuide, Tiqets et les loueurs de voitures en ligne, du point de vue d'un éditeur de contenu ` +
      `affilié ? Modifications des programmes d'affiliation et des barèmes de commission, changements de ` +
      `conditions, décisions réglementaires européennes les concernant, arrivée de fonctionnalités de ` +
      `réservation dans les assistants IA. Dates et sources.`,
  },
];

export interface CollecteAxe {
  axe: string;
  titre: string;
  reponse: string;
  citations: string[];
  erreur: string | null;
}

async function collecter(
  client: OpenAI,
  axe: AxeVeille,
  ctx: { destinations: string[]; marches: string[]; mois: number; aujourdhui: string },
): Promise<CollecteAxe> {
  const consigne =
    'Tu es un documentaliste. Tu réponds uniquement par des faits datés et sourcés, en français. ' +
    'Chaque fait porte sa date et l\'URL de sa source. Quand une information demandée n\'est pas ' +
    'disponible dans une source fiable, écris-le explicitement au lieu de l\'estimer. Ne conclus rien, ' +
    'n\'interprète rien : tu rassembles la matière première.';

  try {
    const completion = await client.chat.completions.create({
      model: MODELE_COLLECTE,
      messages: [
        { role: 'system', content: consigne },
        { role: 'user', content: axe.question(ctx) },
      ],
    });
    // `citations` est propre à Perplexity : absent du type OpenAI, présent dans la réponse.
    const citations = (completion as unknown as { citations?: string[] }).citations ?? [];
    return {
      axe: axe.cle,
      titre: axe.titre,
      reponse: completion.choices[0]?.message?.content ?? '',
      citations,
      erreur: null,
    };
  } catch (e) {
    // Un axe qui échoue ne doit pas emporter la veille entière : les autres restent utiles.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[veille] axe ${axe.cle} en échec :`, msg);
    return { axe: axe.cle, titre: axe.titre, reponse: '', citations: [], erreur: msg };
  }
}

/* ─────────────────────── Étage 2 : la structuration ───────────────────────── */

const SYSTEM_STRUCTURATION = [
  'Tu transformes un matériau de veille déjà collecté en une chronologie structurée, destinée à être ' +
  'confrontée aux séries mensuelles de trafic et de revenu d\'un éditeur de sites de contenu voyage.',

  'RÈGLE ABSOLUE : tu ne dois utiliser QUE les faits présents dans le matériau fourni. Tu n\'as pas ' +
  'accès au web et tu ne dois rien ajouter de mémoire — ni un fait, ni une date, ni un chiffre, ni une ' +
  'URL. Un fait dont le matériau ne donne pas de source utilisable doit être écarté, pas complété.',

  'DATATION. Chaque événement porte une date de début au jour si elle est connue, sinon au mois. Jamais ' +
  'une année seule : un fait que le matériau ne permet pas de dater au mois près n\'est pas exploitable ' +
  'et doit être écarté.',

  'PÉRIMÈTRE. Renseigne toujours `portee_geographique` : c\'est ce qui permet d\'écarter un fait hors ' +
  'sujet. Un déploiement limité à un marché anglophone ne concerne pas un site francophone. Pour ' +
  '`destinations_concernees`, n\'utilise que des destinations de la liste fournie ; laisse le tableau ' +
  'vide si l\'événement est transversal.',

  'TRANSPOSABILITÉ. `applicabilite_a_nos_sites` vaut « directe » seulement si le fait porte sur nos ' +
  'marchés linguistiques et sur du contenu éditorial de voyage. Un chiffre mesuré sur un autre corpus ' +
  'est « non_transposable », même si le mécanisme est crédible : c\'est un fait de marché, pas une ' +
  'mesure de nos sites. Ne dérive JAMAIS un ordre de grandeur applicable à cet éditeur.',

  'CHIFFRES. `chiffre_cle` ne contient qu\'un seul chiffre, celui qui permet de juger l\'ampleur, avec ' +
  'son périmètre exact et sa période de référence telle que publiée. S\'il manque la période de ' +
  'comparaison, le chiffre est inutilisable : mets `chiffre_cle` à null et garde l\'événement pour sa ' +
  'seule valeur de date. null est toujours préférable à un chiffre approximatif.',

  'DÉDOUBLONNAGE. Le matériau vient de sept recherches distinctes qui se recoupent. Un même fait ' +
  'apparaissant dans plusieurs axes est UN seul événement, rattaché à sa meilleure source — la plus ' +
  'officielle, puis la plus précise.',

  'SOURCES. `source_url` doit être une URL présente dans le matériau et pointer vers la page du fait, ' +
  'jamais vers une page d\'accueil. Classe `fiabilite_source` sans complaisance : « officielle » est ' +
  'réservé aux instituts statistiques, offices de tourisme nationaux et communications de l\'éditeur ' +
  'concerné ; une publication d\'agence ou d\'éditeur d\'outil SEO est « etude_privee », même ' +
  'présentée comme une étude.',

  'ANGLES NON COUVERTS. Tout ce que le matériau signale comme introuvable, ou que tu écartes faute de ' +
  'date ou de source, va dans `angles_non_couverts`. Un trou explicite vaut mieux qu\'un trou masqué.',

  'ORDRE. Du plus récent au plus ancien.',
].join('\n\n');

export interface OptionsVeille {
  aujourdhui: string;
  /** Destinations et marchés couverts, pour cadrer la recherche. */
  destinations: string[];
  marches: string[];
  /** Fenêtre à couvrir, en mois. */
  moisCouverts?: number;
}

export interface ResultatVeilleComplet extends ResultatVeille {
  collectes: Array<{ axe: string; caracteres: number; citations: number; erreur: string | null }>;
}

export async function genererVeille(opts: OptionsVeille): Promise<ResultatVeilleComplet> {
  const clePerplexity = process.env.PERPLEXITY_API_KEY?.trim();
  const cleOpenai = process.env.OPENAI_API_KEY?.trim();
  if (!clePerplexity) {
    throw new Error('Variable PERPLEXITY_API_KEY manquante — nécessaire pour la collecte de la veille.');
  }
  if (!cleOpenai) {
    throw new Error('Variable OPENAI_API_KEY manquante — nécessaire pour la structuration de la veille.');
  }

  // L'API Perplexity est compatible OpenAI : même client, autre base_url.
  const perplexity = new OpenAI({ apiKey: clePerplexity, baseURL: URL_PERPLEXITY });
  const openai = new OpenAI({ apiKey: cleOpenai });

  const ctx = {
    destinations: opts.destinations,
    marches: opts.marches,
    mois: opts.moisCouverts ?? 18,
    aujourdhui: opts.aujourdhui,
  };

  console.log(`[veille] collecte ${MODELE_COLLECTE} — ${AXES.length} axes en parallèle`);
  const collectes = await Promise.all(AXES.map((axe) => collecter(perplexity, axe, ctx)));

  const utiles = collectes.filter((c) => c.reponse.trim().length > 0);
  if (utiles.length === 0) {
    throw new Error(
      'Veille : aucun axe n\'a produit de matériau. ' +
      (collectes.find((c) => c.erreur)?.erreur ?? 'Vérifiez la clé Perplexity.'),
    );
  }

  const materiau = {
    date_du_jour: opts.aujourdhui,
    fenetre_couverte_en_mois: ctx.mois,
    destinations_couvertes: opts.destinations,
    marches_linguistiques: opts.marches,
    axes_en_echec: collectes.filter((c) => c.erreur).map((c) => ({ axe: c.axe, erreur: c.erreur })),
    materiau_collecte: utiles.map((c) => ({
      axe: c.axe,
      titre: c.titre,
      reponse: c.reponse,
      urls_citees: c.citations,
    })),
  };

  console.log(
    `[veille] structuration ${MODELE_STRUCTURATION} — ${utiles.length}/${AXES.length} axes, ` +
    `${Math.round(JSON.stringify(materiau).length / 1024)} Ko`,
  );

  const completion = await openai.chat.completions.create({
    model: MODELE_STRUCTURATION,
    reasoning_effort: EFFORT_STRUCTURATION,
    messages: [
      { role: 'system', content: SYSTEM_STRUCTURATION },
      { role: 'user', content: JSON.stringify(materiau, null, 2) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'veille_externe', strict: true, schema: SCHEMA_VEILLE },
    },
  });

  const brut = completion.choices[0]?.message?.content;
  if (!brut) throw new Error('Veille : structuration vide (aucun contenu renvoyé).');

  const resultat = JSON.parse(brut) as ResultatVeille;
  return {
    ...resultat,
    collectes: collectes.map((c) => ({
      axe: c.axe,
      caracteres: c.reponse.length,
      citations: c.citations.length,
      erreur: c.erreur,
    })),
  };
}

export const MODELE_VEILLE_UTILISE = `${MODELE_COLLECTE}+${MODELE_STRUCTURATION}`;
