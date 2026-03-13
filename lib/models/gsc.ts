// Agrégation journalière GSC par site
export interface GscDaily {
  _id?: string;
  siteId: string;
  siteName: string;
  shortName: string;
  date: Date;
  dateStr: string; // "YYYY-MM-DD"
  clicks: number;
  impressions: number;
  ctr: number;       // ratio 0-1
  position: number;  // position moyenne
  updatedAt?: Date;
}

// Performance par page (agrégée sur la période de sync)
export interface GscPage {
  _id?: string;
  siteId: string;
  siteName: string;
  shortName: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  periodStart: Date;
  periodEnd: Date;
  updatedAt?: Date;
}

// Top requêtes par site (agrégées sur la période de sync)
export interface GscQuery {
  _id?: string;
  siteId: string;
  siteName: string;
  shortName: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  periodStart: Date;
  periodEnd: Date;
  updatedAt?: Date;
}
