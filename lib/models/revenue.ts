export type AffiliationPartner = 'getyourguide' | 'booking' | 'tiqets' | 'discovercars' | 'sendowl';

export interface AffiliationRevenue {
  _id?: string;
  siteId?: string;
  siteName?: string;
  partner: AffiliationPartner;
  date: Date;
  dateStr: string;            // YYYY-MM-DD  (= check-in date pour Booking)
  bookingDateStr?: string;    // Booking : date à laquelle la réservation a été faite
  checkOutDateStr?: string;   // Booking : date de check-out (commission réalisée)
  /** Booking date / reservation location (si disponible dans l'export) */
  reservationCity?: string;
  /** Booking date / reservation location (si disponible dans l'export) */
  reservationCountry?: string;
  orderId: string;
  affiliateId?: string;       // Identifiant affilié brut (Booking: Affiliate ID, GYG: campaign, DC: channel)
  productName?: string;
  /** Commission en euros — c'est ce champ que toutes les agrégations somment. */
  commissionActual: number;
  commissionN1?: number;      // Booking : taux tier N-1 appliqué
  commissionMin?: number;     // Booking : base 25%

  /* ── Conversion de devise (DiscoverCars règle en dollars) ─────────────────
   * Le montant d'origine et le taux appliqué sont conservés : sans eux, un montant
   * converti n'est ni vérifiable ni corrigeable une fois le fichier source perdu. */
  /** Montant tel que publié par le partenaire, avant conversion. */
  commissionSource?: number;
  /** Devise du montant source (ex. « USD »). Absent = déjà en euros. */
  deviseSource?: string;
  /** Taux appliqué (source → EUR), au 1er du mois de la commande. */
  tauxChange?: number;
  /** Vrai si le mois n'était pas dans la table et qu'on a repris le taux le plus récent. */
  tauxApproxime?: boolean;

  /* ── Attribution estimée ─────────────────────────────────────────────────
   * Séparée de `siteName`, qui reste réservé à l'attribution MESURÉE. Une estimation
   * ne doit jamais entrer dans un arbitrage entre sites sans être identifiée comme
   * telle : elle repose sur le pays de l'utilisateur, donc elle favorise
   * structurellement les sites généralistes. */
  /** shortName déduit faute de code d'affiliation. Jamais fusionné avec `siteName`. */
  siteNameEstime?: string;
  /** Comment l'estimation a été faite, pour pouvoir la contester ligne à ligne. */
  methodeEstimation?: string;
  /** Domaine référent tiers : le revenu vient d'un sous-affilié, d'aucun de nos sites. */
  sousAffilieDomaine?: string;
  /** Lieu de location tel que publié (DiscoverCars). */
  lieuLocation?: string;

  status?: string;
  importedAt: Date;
}

export interface RevenueStats {
  totalRevenue: number;
  byPartner: Record<AffiliationPartner, number>;
  bySite: Array<{ siteName: string; revenue: number; sessions?: number; rpm?: number }>;
  rpm?: number;
}

export interface RevenueChartPoint {
  month: string;   // YYYY-MM
  getyourguide: number;
  booking: number;
  tiqets: number;
  discovercars: number;
  sendowl: number;
  total: number;
}
