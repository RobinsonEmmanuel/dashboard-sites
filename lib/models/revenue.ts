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
  orderId: string;
  affiliateId?: string;       // Identifiant affilié brut (Booking: Affiliate ID, GYG: campaign, DC: channel)
  productName?: string;
  commissionActual: number;
  commissionN1?: number;      // Booking : taux tier N-1 appliqué
  commissionMin?: number;     // Booking : base 25%
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
