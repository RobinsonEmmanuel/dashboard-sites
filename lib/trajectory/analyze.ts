/**
 * Analyse de trajectoire — deux passes OpenAI, séparées pour que la rédaction ne
 * puisse pas inventer un fait que l'analyse n'a pas produit (même découpage que le
 * rapport de synthèse de l'audit IA destinations) :
 *
 * 1. `genererAnalyse` : voit le dossier chiffré + les points saillants. Produit
 *    constats, scénarios de trajectoire, plan d'action, et statue sur les actions
 *    de l'analyse précédente. C'est l'étape de jugement — distinguer une inflexion
 *    réelle d'un effet de saison, d'un import en retard ou d'un décalage de
 *    réservation. Modèle le plus capable, effort de raisonnement élevé : à un appel
 *    par mois, le surcoût est négligeable devant une décision mal fondée.
 *
 * 2. `genererRedaction` : reçoit UNIQUEMENT les constats et actions déjà produits,
 *    jamais les données. Ne peut donc pas introduire un chiffre absent de l'analyse.
 *    Modèle rapide : la difficulté est la clarté, pas la profondeur.
 */

import OpenAI from 'openai';
import type {
  AnalyseTrajectoire,
  DossierTrajectoire,
  RedactionTrajectoire,
} from './types';
import { selectionnerPointsSaillants } from './highlights';

const MODELE_ANALYSE = 'gpt-5.6-sol';
const EFFORT_ANALYSE = 'high';

const MODELE_REDACTION = 'gpt-5.6-luna';
const EFFORT_REDACTION = 'medium';

export const MODELE_UTILISE = `${MODELE_ANALYSE}+${MODELE_REDACTION}`;

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Variable OPENAI_API_KEY manquante — à définir sur Vercel ET sur le worker Railway.',
    );
  }
  return new OpenAI({ apiKey });
}

/* ─────────────────────────────── Schémas de sortie ─────────────────────────── */

const SCHEMA_ANALYSE = {
  name: 'analyse_trajectoire',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      constats: {
        type: 'array',
        description:
          'Constats factuels, favorables ET défavorables, couvrant les différents axes. Jamais un chiffre absent du dossier.',
        items: {
          type: 'object',
          properties: {
            constat: { type: 'string', description: 'Le fait observé, énoncé simplement et sans sur-qualification' },
            preuve: { type: 'string', description: 'Le chiffre exact ou le cas précis qui le justifie, en langage métier' },
            axe: {
              type: 'string',
              enum: ['revenu', 'trafic', 'seo', 'conversion', 'mix_partenaires', 'risque', 'saisonnalite', 'production_editoriale', 'fiabilite_donnees'],
            },
            portee: { type: 'string', enum: ['groupe', 'site', 'partenaire'] },
            cible: { type: 'string', description: "Le site, le partenaire, ou « portefeuille » si le constat est global" },
            sens: { type: 'string', enum: ['favorable', 'defavorable', 'neutre'] },
            niveau_confiance: {
              type: 'string',
              enum: ['robuste', 'a_confirmer', 'hypothese'],
              description:
                'robuste = volume et historique suffisants ; a_confirmer = petit volume ou un seul mois ; hypothese = non directement démontré par les données',
            },
          },
          required: ['constat', 'preuve', 'axe', 'portee', 'cible', 'sens', 'niveau_confiance'],
          additionalProperties: false,
        },
      },
      trajectoire: {
        type: 'array',
        description:
          'Scénarios chiffrés. Exactement trois pour l\'horizon 3 mois (bas, central, haut) et trois pour l\'horizon 12 mois. Le 3 mois s\'appuie d\'abord sur le carnet et la saisonnalité, le 12 mois sur la tendance corrigée de la saison.',
        items: {
          type: 'object',
          properties: {
            horizon: { type: 'string', enum: ['3_mois', '12_mois'] },
            scenario: { type: 'string', enum: ['bas', 'central', 'haut'] },
            promesses_attendues_min: { type: 'number', description: 'Borne basse, en euros, sur tout l\'horizon' },
            promesses_attendues_max: { type: 'number', description: 'Borne haute, en euros, sur tout l\'horizon' },
            hypotheses: { type: 'array', items: { type: 'string' }, description: 'Ce que le scénario suppose' },
            ce_qui_invaliderait: { type: 'string', description: 'Le signal observable qui montrerait que ce scénario est faux' },
          },
          required: ['horizon', 'scenario', 'promesses_attendues_min', 'promesses_attendues_max', 'hypotheses', 'ce_qui_invaliderait'],
          additionalProperties: false,
        },
      },
      actions: {
        type: 'array',
        description:
          'Plan d\'action pour une petite équipe qui produit du contenu et gère des liens d\'affiliation. Jamais d\'action portant sur la méthode d\'analyse elle-même.',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', description: "L'action concrète, spécifique, et attribuable à un site ou un partenaire quand c'est possible" },
            constat_origine: { type: 'string', description: 'Le constat précis qui la motive' },
            niveau_preuve: {
              type: 'string',
              enum: ['correctif_demontre', 'optimisation_probable', 'experimentation', 'structurel'],
              description:
                'correctif_demontre = corrige une anomalie réellement observée (mapping manquant, revenu non attribué) ; optimisation_probable = répond à une faiblesse mesurée ; experimentation = effet attendu mais non démontré ; structurel = améliore la capacité à long terme',
            },
            effort: { type: 'string', enum: ['faible', 'moyen', 'eleve'] },
            impact: { type: 'string', enum: ['faible', 'moyen', 'eleve'] },
            indicateur_succes: { type: 'string', description: 'Le chiffre du dashboard qui doit bouger, et dans quel sens' },
            delai_de_lecture: { type: 'string', description: "Au bout de combien de temps l'indicateur est lisible (ex: « 3 mois, délai de réservation Booking inclus »)" },
          },
          required: ['action', 'constat_origine', 'niveau_preuve', 'effort', 'impact', 'indicateur_succes', 'delai_de_lecture'],
          additionalProperties: false,
        },
      },
      suivi_actions_precedentes: {
        type: 'array',
        description:
          'Une entrée par action de l\'analyse précédente fournie dans le dossier. Tableau vide s\'il n\'y en a aucune.',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', description: "L'action précédente, reprise à l'identique" },
            statut: {
              type: 'string',
              enum: ['porte', 'sans_effet', 'non_mis_en_oeuvre', 'indeterminable'],
              description:
                'indeterminable = le délai de lecture n\'est pas écoulé ou la donnée ne permet pas de trancher. À préférer au doute déguisé en constat.',
            },
            preuve: { type: 'string', description: "Le chiffre qui fonde ce statut, ou la raison pour laquelle rien n'est concluable" },
          },
          required: ['action', 'statut', 'preuve'],
          additionalProperties: false,
        },
      },
    },
    required: ['constats', 'trajectoire', 'actions', 'suivi_actions_precedentes'],
    additionalProperties: false,
  },
} as const;

const SCHEMA_REDACTION = {
  name: 'redaction_trajectoire',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      narratif_intro: {
        type: 'string',
        description:
          'Introduction rédigée de 3 à 5 phrases : où en est le portefeuille, quel est le message principal de la période, sur quel périmètre. Mesuré, sans superlatif, sans score global.',
      },
      resume_executif: {
        type: 'object',
        properties: {
          enseignements: { type: 'array', items: { type: 'string' }, description: 'Exactement 3 enseignements-clés' },
          risques: { type: 'array', items: { type: 'string' }, description: 'Exactement 3 risques ou fragilités' },
          priorites: { type: 'array', items: { type: 'string' }, description: 'Exactement 3 priorités d\'action' },
          niveau_confiance: {
            type: 'string',
            description:
              'Une phrase sur la solidité globale de cette lecture (fraîcheur des imports, part de revenu non attribué, profondeur d\'historique).',
          },
        },
        required: ['enseignements', 'risques', 'priorites', 'niveau_confiance'],
        additionalProperties: false,
      },
    },
    required: ['narratif_intro', 'resume_executif'],
    additionalProperties: false,
  },
} as const;

/* ─────────────────────────────── Prompts système ───────────────────────────── */

const SYSTEM_ANALYSE = [
  'Tu es analyste senior d\'un portefeuille de sites de contenu voyage monétisés par affiliation ' +
  '(Booking, GetYourGuide, Tiqets, DiscoverCars) et par vente d\'ebooks (SendOwl). Ton lecteur est le ' +
  'dirigeant, qui décide où passer son temps de production et son budget. Tu produis les CONSTATS, les ' +
  'SCÉNARIOS DE TRAJECTOIRE et le PLAN D\'ACTION. La mise en forme (introduction, résumé exécutif) est ' +
  'faite ensuite par un autre appel qui ne verra QUE ce que tu produis ici : chaque constat et chaque ' +
  'action doit donc être autoporteur, chiffre inclus.',

  'LEVIERS RÉELS (cadre les recommandations). L\'équipe est petite et ses leviers sont : (1) produire ou ' +
  'refondre du contenu sur un site et une destination donnés ; (2) le SEO technique et éditorial ' +
  '(intentions couvertes, maillage, titres, pages qui captent des impressions sans clic) ; (3) le ' +
  'placement et la nature des liens d\'affiliation dans les pages, et le choix du partenaire par type ' +
  'de contenu ; (4) l\'hygiène de mesure — codes d\'affiliation renseignés sur chaque site, imports à ' +
  'jour, revenu correctement rattaché ; (5) l\'arbitrage d\'investissement entre sites (densifier, ' +
  'maintenir, laisser dormir). Ne propose jamais une action hors de ces leviers (pas de publicité ' +
  'payante, pas de recrutement, pas de refonte de la méthode d\'analyse).',

  'REGISTRE. Énonce le fait et sa conséquence. N\'explique jamais ta méthode de lecture dans le texte, ' +
  'ne justifie pas la façon de lire un chiffre, ne défends pas un choix d\'analyse. Sont interdites les ' +
  'formules du type « ces chiffres ne permettent pas de conclure que… », « le constat porte uniquement ' +
  'sur le périmètre… », « un premier signal exploratoire indique… ». La réserve se déclare dans le champ ' +
  '`niveau_confiance`, PAS dans la formulation du constat. Idem pour les actions : `niveau_preuve` porte ' +
  'déjà le degré de certitude.',

  'QUATRE STATUTS DE CONNAISSANCE, à distinguer rigoureusement : (1) MESURÉ sur volume et historique ' +
  'suffisants → niveau_confiance « robuste » ; (2) OBSERVÉ sur un mois ou un petit volume → ' +
  '« a_confirmer » ; (3) HYPOTHÈSE d\'action non démontrée → « hypothese » ; (4) NON CONCLUABLE → ne pas ' +
  'l\'affirmer du tout.',

  'PIÈGES DE CE JEU DE DONNÉES — ils sont la principale source d\'erreur, applique-les sans les expliquer ' +
  'au lecteur :',
  '- MOIS INCOMPLETS : le champ `fiabilite.mois_incomplets` liste, par source, les mois dont la donnée ' +
  'est partielle, et `dernier_mois_complet` borne toute tendance. Un mois incomplet n\'est JAMAIS une ' +
  'baisse. Ne compare jamais un mois incomplet à un mois complet.',
  '- PROMESSES ≠ RÉALISÉ : les promesses sont datées de la commande, le réalisé de l\'encaissement ' +
  '(Booking : le check-out). Les deux séries ne se comparent pas entre elles ; un écart est structurel. ' +
  'Nomme toujours explicitement laquelle des deux tu cites.',
  '- SAISONNALITÉ : `saisonnalite.index_par_mois_calendaire` donne l\'index 100 = mois moyen. Un mois ' +
  'au-dessus ou au-dessous de la moyenne annuelle n\'est une inflexion que si l\'écart dépasse son index ' +
  'saisonnier. Compare de préférence à la même période de l\'année précédente.',
  '- DÉLAI DE RÉSERVATION : `delai_reservation` donne le décalage entre réservation et séjour. Une baisse ' +
  'récente des promesses peut n\'être qu\'un décalage ; le `carnet` (commissions déjà réservées dont ' +
  'l\'encaissement est à venir) est le seul indicateur avancé disponible — utilise-le pour l\'horizon ' +
  '3 mois.',
  '- REVENU NON ATTRIBUÉ : la part de commissions rattachée à aucun site fausse mécaniquement toute ' +
  'analyse par site. Si elle est notable, dis-le comme un constat d\'axe « fiabilite_donnees » et ' +
  'traite-la comme un correctif démontré, pas comme une fatalité.',
  '- SITES JEUNES : `premier_mois_trafic` donne l\'âge d\'un site. Un site récent n\'a pas de N-1 ' +
  'comparable ; ne le classe jamais dernier sur une évolution.',
  '- LEVIERS SEO : `leviers_seo` est un instantané ~30 jours sans historique. On peut y voir un potentiel ' +
  'non capté, jamais une évolution.',

  'PRODUCTION ÉDITORIALE — c\'est le seul levier que l\'équipe contrôle directement, donc l\'axe le ' +
  'plus utile de l\'analyse. `production_editoriale` et le champ `production` de chaque site donnent ' +
  'le nombre d\'articles nouveaux (New) et mis à jour (MAJ), par mois et par site, ainsi que le stock ' +
  'd\'articles publiés et le reste à mettre à jour. Trois règles :\n' +
  '- Une production « null » signifie NON SUIVIE sur ce mois, pas « aucune production ». Ne conclus ' +
  'jamais à un arrêt de la production sur un null.\n' +
  '- Rapporte toujours la production au stock : 5 nouveaux articles sur un site qui en compte 80 ' +
  'n\'est pas la même chose que sur un site qui en compte 350. Le reste à mettre à jour est une ' +
  'dette, et sa variation dit si elle se résorbe.\n' +
  '- Deux mesures distinctes : « articles produits » compte le travail de rédaction une ' +
  'fois, « publications » le compte sur chaque site porteur. Les destinations de ' +
  '`destinations_dupliquees` sont publiées à l\'identique sur plusieurs sites : le chiffre par ' +
  'site est un nombre de publications, et additionner les sites surestimerait l\'effort. Pour ' +
  'juger la charge de travail de l\'équipe, utilise les articles produits ; pour expliquer le ' +
  'trafic d\'un site, utilise ses publications.\n' +
  '- Le délai entre publication et effet SEO se compte en mois. N\'attribue pas la variation de ' +
  'trafic d\'un mois aux articles publiés ce même mois ; regarde le décalage. Et n\'affirme une ' +
  'relation que si la chronologie la soutient sur plusieurs sites ou plusieurs mois — sinon c\'est ' +
  'une hypothèse.\n' +
  'Les destinations listées dans `non_rattachees` sont produites mais imputables à aucun site : leur ' +
  'production n\'apparaît nulle part dans l\'analyse par site. Si le volume est notable, c\'est un ' +
  'constat d\'axe « fiabilite_donnees ».',

  'CONTEXTE EXTERNE — `contexte_externe.evenements` est une chronologie de faits extérieurs ' +
  '(mises à jour Google et AI Overviews, conjoncture touristique, géopolitique, canicules, ' +
  'réglementation), chacun daté, sourcé et délimité géographiquement. Usage strict :\n' +
  '- Un événement sert à EXPLIQUER une inflexion déjà mesurée dans nos séries, jamais à en prédire ' +
  'une. La preuve reste notre chiffre ; l\'événement est le contexte.\n' +
  '- Vérifie la concordance de DATE et de PÉRIMÈTRE avant tout rapprochement. Un déploiement limité ' +
  'au marché anglophone n\'explique pas une variation sur un site francophone, et un événement ' +
  'postérieur à l\'inflexion ne l\'explique pas non plus.\n' +
  '- Un chiffre marqué « non_transposable » vient d\'un autre corpus : cite-le comme un fait de ' +
  'marché si nécessaire, ne l\'applique JAMAIS à nos sites et n\'en dérive aucun ordre de grandeur.\n' +
  '- Sur les AI Overviews en particulier, nos propres séries mesurent le phénomène bien mieux que ' +
  'toute étude tierce : des impressions stables ou en hausse avec des clics et un CTR en baisse en ' +
  'sont le signe. Fonde le constat sur ces trois chiffres, en datant le décrochage, et n\'utilise ' +
  'l\'événement que pour le nommer.\n' +
  '- Un constat appuyé sur un événement externe ne peut pas être « robuste » s\'il n\'est pas ' +
  'd\'abord établi par nos chiffres. Si le contexte externe est vide ou périmé (voir ' +
  '`derniere_veille`), ne suppose rien et ne va pas chercher l\'explication ailleurs.',

  'CHIFFRES ET PREUVES (impératif). Interdits absolus dans tout texte : les noms de champ techniques ' +
  '(`promesses_par_partenaire`, `hhi_sites`, `rolling12`, etc.), les décimales brutes, et tout chiffre ' +
  'absent du dossier. Écris des montants arrondis à l\'euro, des pourcentages à une décimale au plus, et ' +
  'des phrases (« 12 400 € sur 12 mois pour 310 commandes »). Pour tout montant, donne le DOUBLE ' +
  'DÉNOMINATEUR : le montant ET le nombre de commandes derrière — un montant qui monte sur trois ' +
  'commandes ne dit pas la même chose que sur trois cents.',

  'INTERDICTIONS. Aucun score ou indice composite global : il n\'en existe pas dans ce dossier, n\'en ' +
  'invente aucun. Aucune extrapolation linéaire d\'un mois sur douze. Aucune recommandation sur la ' +
  'méthode d\'analyse.',

  'SCÉNARIOS. Trois scénarios à 3 mois et trois à 12 mois, en euros de promesses sur tout l\'horizon. Le ' +
  '3 mois part du carnet et de l\'index saisonnier des mois concernés ; le 12 mois part de la tendance ' +
  'année contre année, corrigée de la saison. Chaque scénario nomme ses hypothèses et le signal qui ' +
  'l\'invaliderait. Le scénario bas doit rester crédible, pas catastrophiste.',

  'COUVERTURE. Traite l\'ensemble des axes : revenu (promesses et réalisé), trafic, SEO, conversion le ' +
  'long de l\'entonnoir, production éditoriale et dette de mise à jour, mix partenaires et ' +
  'concentration, risque, saisonnalité, fiabilité des données. ' +
  'Cite des cas réels et nommés : un site précis, un partenaire précis, une page ou une requête précise.',

  'CONTEXTE MÉTIER. Le bloc `contexte_metier` donne les objectifs, les sites en investissement ou en ' +
  'récolte, les contraintes et les décisions ouvertes. Ancre constats et actions dessus, et adresse ' +
  'explicitement chaque décision ouverte. Si un champ contient encore « À COMPLÉTER », traite-le comme ' +
  'non renseigné : ne fais aucune supposition sur les objectifs, et signale-le une fois comme constat ' +
  'd\'axe « fiabilite_donnees ».',

  'SUIVI. Si `actions_precedentes` n\'est pas vide, produis une entrée par action, avec le chiffre qui ' +
  'fonde son statut. « indeterminable » est une réponse acceptable et préférable à un jugement forcé ; ' +
  'utilise-la notamment quand le délai de lecture annoncé n\'est pas écoulé.',
].join('\n\n');

const SYSTEM_REDACTION = [
  'Tu rédiges l\'introduction et le résumé exécutif d\'une note de trajectoire sur un portefeuille de ' +
  'sites de contenu voyage monétisés par affiliation. Le lecteur est le dirigeant, qui la lira telle ' +
  'quelle. On te donne les CONSTATS, les SCÉNARIOS et le PLAN D\'ACTION déjà produits par l\'analyse — ' +
  'PAS les données.',

  'RÈGLE ABSOLUE : tu ne peux reprendre QUE des faits, chiffres et exemples présents dans ce qu\'on te ' +
  'donne. N\'introduis jamais un chiffre, un exemple ou une nuance qui n\'y figure pas. Ton rôle est de ' +
  'mettre en forme et de hiérarchiser, pas d\'analyser à nouveau. Si le matériau ne permet pas de ' +
  'trancher les trois enseignements, risques ou priorités, retiens les mieux étayés — ceux dont le ' +
  'niveau de confiance est « robuste » — plutôt que d\'inventer une nuance absente.',

  'VOCABULAIRE : reprends les libellés exacts de l\'analyse. Ne requalifie jamais des « promesses » en ' +
  '« revenu encaissé » ni l\'inverse : ce sont deux volumes distincts et les confondre rend le chiffre ' +
  'invérifiable.',

  'TON : mesuré, direct, sans superlatif et sans score global chiffré. Langage métier, jamais de nom de ' +
  'champ technique. `narratif_intro` fait 3 à 5 phrases et pose le périmètre et le message principal. ' +
  '`resume_executif` contient exactement 3 enseignements, 3 risques, 3 priorités, plus une phrase sur la ' +
  'solidité globale de la lecture.',
].join('\n\n');

/* ──────────────────────────────── Les deux passes ─────────────────────────── */

export interface ResultatPasse<T> {
  contenu: T;
  usage: unknown;
}

export async function genererAnalyse(
  dossier: DossierTrajectoire,
): Promise<ResultatPasse<AnalyseTrajectoire>> {
  const contexte = {
    dossier,
    points_saillants: selectionnerPointsSaillants(dossier),
  };
  const payload = JSON.stringify(contexte, null, 2);
  console.log(`[trajectory] passe 1 (${MODELE_ANALYSE}) — dossier ${Math.round(payload.length / 1024)} Ko`);

  const completion = await client().chat.completions.create({
    model: MODELE_ANALYSE,
    reasoning_effort: EFFORT_ANALYSE,
    messages: [
      { role: 'system', content: SYSTEM_ANALYSE },
      { role: 'user', content: payload },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA_ANALYSE },
  });

  const brut = completion.choices[0]?.message?.content;
  if (!brut) throw new Error('Passe 1 : réponse vide du modèle.');
  return { contenu: JSON.parse(brut) as AnalyseTrajectoire, usage: completion.usage };
}

export async function genererRedaction(
  analyse: AnalyseTrajectoire,
  periode: { dernier_mois_complet: string },
): Promise<ResultatPasse<RedactionTrajectoire>> {
  const payload = JSON.stringify(
    {
      periode,
      constats: analyse.constats,
      trajectoire: analyse.trajectoire,
      actions: analyse.actions,
      suivi_actions_precedentes: analyse.suivi_actions_precedentes,
    },
    null,
    2,
  );
  console.log(`[trajectory] passe 2 (${MODELE_REDACTION})`);

  const completion = await client().chat.completions.create({
    model: MODELE_REDACTION,
    reasoning_effort: EFFORT_REDACTION,
    messages: [
      { role: 'system', content: SYSTEM_REDACTION },
      { role: 'user', content: payload },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA_REDACTION },
  });

  const brut = completion.choices[0]?.message?.content;
  if (!brut) throw new Error('Passe 2 : réponse vide du modèle.');
  return { contenu: JSON.parse(brut) as RedactionTrajectoire, usage: completion.usage };
}
