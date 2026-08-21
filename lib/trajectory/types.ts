import type { AffiliationPartner } from '../models/revenue';

/* ───────────────────────────── Dossier de trajectoire ─────────────────────────
 * Tout est calculé par `build-dossier.ts`. Le modèle ne calcule RIEN : il ne voit
 * que ces chiffres déjà arrondis et déjà nommés en langage métier.
 * Les montants sont en euros, les taux en pourcentage (déjà multipliés par 100).
 * ──────────────────────────────────────────────────────────────────────────── */

export type SourceDonnee = 'trafic' | 'seo' | 'revenus';

export interface FiabiliteDossier {
  derniere_donnee: {
    trafic_ga4: string | null;
    seo_gsc: string | null;
    revenus_par_partenaire: Array<{
      partenaire: AffiliationPartner;
      dernier_jour_commande: string | null;
      dernier_import: string | null;
      commandes_en_base: number;
    }>;
  };
  /** Dernier mois complet sur TOUTES les sources — borne de toute lecture de tendance. */
  dernier_mois_complet: string;
  mois_incomplets: Record<SourceDonnee, string[]>;
  revenu_non_attribue: {
    montant: number;
    commandes: number;
    part_du_revenu_pct: number | null;
  };
  cles_affiliation_non_mappees: Array<{
    partenaire: AffiliationPartner;
    cle: string;
    montant: number;
    commandes: number;
  }>;
  avertissements: string[];
}

export interface MoisGroupe {
  mois: string;
  /** Promesses = commission à la date de commande (Booking : date de réservation). */
  promesses: number;
  promesses_par_partenaire: Partial<Record<AffiliationPartner, number>>;
  commandes: number;
  /** Réalisé = commission à la date d'encaissement (Booking : date de check-out). */
  realise: number;
  sessions: number;
  clics_sortants: number;
  clics_seo: number;
  impressions: number;
  ctr_seo_pct: number | null;
  position_seo: number | null;
  rpm: number | null;
  /** Sources dont ce mois est incomplet — ne pas y lire de tendance. */
  incomplet: SourceDonnee[];
}

export interface MoisSite {
  site: string;
  mois: string;
  /** null = pas de suivi éditorial pour ce mois (le tableau ne remonte pas si loin), 0 = rien produit. */
  articles_nouveaux: number | null;
  articles_maj: number | null;
  sessions: number;
  clics_sortants: number;
  clics_seo: number;
  impressions: number;
  position_seo: number | null;
  promesses: number;
  commandes: number;
}

export interface KpisPeriode {
  libelle: string;
  debut: string;
  fin: string;
  sessions: number;
  clics_sortants: number;
  clics_seo: number;
  impressions: number;
  ctr_seo_pct: number | null;
  position_seo: number | null;
  promesses: number;
  realise: number;
  commandes: number;
  rpm: number | null;
  commission_moyenne_par_commande: number | null;
}

export interface EtapesEntonnoir {
  impressions: number;
  clics_seo: number;
  sessions: number;
  clics_sortants: number;
  commandes: number;
  promesses: number;
}

export interface TauxEntonnoir {
  ctr_seo_pct: number | null;
  /** Sessions par clic SEO — > 1 signifie du trafic hors Search (direct, social, Pinterest…). */
  sessions_par_clic_seo: number | null;
  clics_sortants_pour_100_sessions: number | null;
  commandes_pour_100_clics_sortants: number | null;
  rpm: number | null;
  commission_moyenne_par_commande: number | null;
}

export interface EntonnoirSite {
  site: string;
  actif: boolean;
  premier_mois_trafic: string | null;
  courant: EtapesEntonnoir;
  n1: EtapesEntonnoir;
  taux: TauxEntonnoir;
  taux_n1: TauxEntonnoir;
  evolution_pct: {
    sessions: number | null;
    clics_seo: number | null;
    impressions: number | null;
    promesses: number | null;
  };
  /** Partenaires dont le code d'affiliation n'est pas renseigné sur la fiche site. */
  codes_affiliation_manquants: string[];
  /**
   * Production éditoriale sur la même fenêtre, en NOMBRE DE PUBLICATIONS sur ce site
   * (un article ZigZag publié sur ZZ FR et ZZ EN compte pour chacun des deux).
   * null = hors période couverte par le suivi.
   */
  production: {
    articles_nouveaux: number | null;
    articles_maj: number | null;
    articles_publies: number | null;
    reste_a_maj: number | null;
  };
}

export interface CarnetCommandes {
  a_date: string;
  /** Commissions déjà réservées dont l'encaissement (check-out) est à venir. */
  total: number;
  commandes: number;
  par_mois_encaissement: Array<{ mois: string; montant: number; commandes: number }>;
  /** Même mesure exactement un an plus tôt, à date comparable. */
  total_n1: number;
  commandes_n1: number;
  evolution_pct: number | null;
}

export interface DelaiReservation {
  partenaire: AffiliationPartner;
  commandes: number;
  jours_moyen: number | null;
  distribution: Record<string, number>;
}

export interface Annulations {
  partenaire: AffiliationPartner;
  commandes_totales: number;
  commandes_annulees: number;
  taux_pct: number | null;
  montant_perdu: number;
  taux_pct_n1: number | null;
}

export interface Concentration {
  par_site: Array<{ site: string; montant: number; part_pct: number | null }>;
  par_partenaire: Array<{ partenaire: AffiliationPartner; montant: number; part_pct: number | null }>;
  part_top1_site_pct: number | null;
  part_top3_sites_pct: number | null;
  part_top1_partenaire_pct: number | null;
  /** Herfindahl 0–10 000 : > 2 500 = concentration forte. */
  hhi_sites: number | null;
  hhi_partenaires: number | null;
}

export interface LevierSeo {
  site: string;
  cible: string;
  impressions: number;
  clics: number;
  ctr_pct: number | null;
  position: number | null;
}

export interface ProductionEditoriale {
  couverture: {
    premiere_semaine: string | null;
    derniere_semaine: string | null;
    avertissement: string;
  };
  mensuel_groupe: Array<{
    mois: string;
    /** Travail de rédaction, compté une fois même si l'article est publié sur deux sites. */
    articles_produits_nouveaux: number;
    articles_produits_maj: number;
    /** Le même article compte une fois par site porteur. */
    publications_nouveaux: number;
    publications_maj: number;
  }>;
  /** Destinations dont chaque article est publié à l'identique sur plusieurs sites. */
  destinations_dupliquees: string[];
  /** Destinations produites que le dashboard ne sait rattacher à aucun site. */
  non_rattachees: Array<{ destination: string; articles_nouveaux: number; articles_maj: number }>;
  stock_par_site: Array<{
    site: string;
    destination: string;
    date: string;
    publies: number | null;
    reste_a_maj: number | null;
    publies_il_y_a_3_mois: number | null;
    reste_a_maj_il_y_a_3_mois: number | null;
  }>;
}

export interface ContexteExterne {
  derniere_veille: string | null;
  avertissement: string;
  evenements: unknown[];
}

export interface DossierTrajectoire {
  meta: {
    genere_le: string;
    aujourdhui: string;
    dernier_mois_complet: string;
    nb_mois_series_groupe: number;
    nb_mois_series_site: number;
    lecture: string;
  };
  contexte_metier: unknown;
  fiabilite: FiabiliteDossier;
  sites: Array<{
    site: string;
    nom_complet: string;
    actif: boolean;
    premier_mois_trafic: string | null;
    codes_affiliation_renseignes: string[];
    codes_affiliation_manquants: string[];
  }>;
  serie_mensuelle_groupe: MoisGroupe[];
  serie_mensuelle_par_site: MoisSite[];
  comparables: {
    rolling12: KpisPeriode;
    rolling12_n1: KpisPeriode;
    ytd: KpisPeriode;
    ytd_n1: KpisPeriode;
    ytd_n2: KpisPeriode;
    evolutions_pct: {
      rolling12_vs_n1: Record<string, number | null>;
      ytd_vs_n1: Record<string, number | null>;
    };
  };
  entonnoir_par_site: EntonnoirSite[];
  production_editoriale: ProductionEditoriale;
  contexte_externe: ContexteExterne;
  carnet: CarnetCommandes;
  delai_reservation: DelaiReservation[];
  annulations: Annulations[];
  concentration: Concentration;
  saisonnalite: {
    annees_utilisees: number[];
    /** Index 100 = mois moyen. Calculé sur les années civiles complètes disponibles. */
    index_par_mois_calendaire: Array<{ mois_calendaire: number; index: number | null }>;
  };
  leviers_seo: {
    /** gsc_pages / gsc_queries sont un instantané 30 jours, rafraîchi seulement en sync « full ». */
    instantane: { debut: string | null; fin: string | null; avertissement: string };
    pages_fortes_impressions_faible_ctr: LevierSeo[];
    requetes_a_portee: LevierSeo[];
  };
  actions_precedentes: Array<{
    action: string;
    indicateur_succes: string;
    analyse_du: string;
  }>;
}

/* ─────────────────────────── Sortie du modèle (passe 1) ───────────────────── */

export type NiveauConfiance = 'robuste' | 'a_confirmer' | 'hypothese';
export type AxeConstat =
  | 'revenu' | 'trafic' | 'seo' | 'conversion'
  | 'mix_partenaires' | 'risque' | 'saisonnalite' | 'production_editoriale' | 'fiabilite_donnees';

export interface Constat {
  constat: string;
  preuve: string;
  axe: AxeConstat;
  portee: 'groupe' | 'site' | 'partenaire';
  cible: string;
  sens: 'favorable' | 'defavorable' | 'neutre';
  niveau_confiance: NiveauConfiance;
}

export interface Scenario {
  horizon: '3_mois' | '12_mois';
  scenario: 'bas' | 'central' | 'haut';
  promesses_attendues_min: number;
  promesses_attendues_max: number;
  hypotheses: string[];
  ce_qui_invaliderait: string;
}

export interface ActionTrajectoire {
  action: string;
  constat_origine: string;
  niveau_preuve: 'correctif_demontre' | 'optimisation_probable' | 'experimentation' | 'structurel';
  effort: 'faible' | 'moyen' | 'eleve';
  impact: 'faible' | 'moyen' | 'eleve';
  indicateur_succes: string;
  delai_de_lecture: string;
}

export interface SuiviAction {
  action: string;
  statut: 'porte' | 'sans_effet' | 'non_mis_en_oeuvre' | 'indeterminable';
  preuve: string;
}

export interface AnalyseTrajectoire {
  constats: Constat[];
  trajectoire: Scenario[];
  actions: ActionTrajectoire[];
  suivi_actions_precedentes: SuiviAction[];
}

/* ─────────────────────────── Sortie du modèle (passe 2) ───────────────────── */

export interface RedactionTrajectoire {
  narratif_intro: string;
  resume_executif: {
    enseignements: string[];
    risques: string[];
    priorites: string[];
    niveau_confiance: string;
  };
}

/* ────────────────────────────── Document persisté ─────────────────────────── */

export interface AnalyseTrajectoireDoc {
  _id?: string;
  createdAt: Date;
  aujourdhui: string;
  dernier_mois_complet: string;
  dossierHash: string;
  dossier: DossierTrajectoire;
  modele: string;
  analyse: AnalyseTrajectoire;
  redaction: RedactionTrajectoire;
  usage?: { analyse?: unknown; redaction?: unknown };
}
