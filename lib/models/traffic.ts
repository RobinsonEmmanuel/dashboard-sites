export interface TrafficDaily {
  _id?: string;
  siteId: string;
  siteName: string;
  shortName: string;
  date: Date;
  dateStr: string; // "YYYY-MM-DD" pour les recherches rapides
  sessions: number;
  outboundClicks: number;
  updatedAt?: Date;
}
