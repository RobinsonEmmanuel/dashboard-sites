export interface Site {
  _id?: string;
  name: string;
  shortName: string;
  ga4PropertyId: string;
  gscSiteUrl: string;
  gscType: 'url' | 'domain';
  linkEvent: string;
  active: boolean;
  // Codes affiliation partenaires
  bookingAffiliateId?: string;
  discoverCarsChan?: string;
  gygCampaign?: string;
  tiqetsCampaign?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DEFAULT_SITES: Omit<Site, '_id' | 'createdAt' | 'updatedAt'>[] = [
  { name: 'Zigzag on Earth',   shortName: 'ZZ EN',      ga4PropertyId: '312103123', gscSiteUrl: 'https://www.zigzagonearth.com', gscType: 'url',    linkEvent: 'click',            active: true },
  { name: 'Zigzag Voyages',    shortName: 'ZZ FR',      ga4PropertyId: '312147973', gscSiteUrl: 'https://zigzagvoyages.fr',      gscType: 'url',    linkEvent: 'click',            active: true },
  { name: 'Zigzag Reisen',     shortName: 'ZZ R',       ga4PropertyId: '312134130', gscSiteUrl: 'https://zigzagreisen.de',       gscType: 'url',    linkEvent: 'click',            active: true },
  { name: 'Zigzag Viajes',     shortName: 'ZZ ES',      ga4PropertyId: '322303644', gscSiteUrl: 'zigzagviajes.com',              gscType: 'domain', linkEvent: 'click',            active: true },
  { name: 'Normandie Lovers',  shortName: 'Normandie',  ga4PropertyId: '334290963', gscSiteUrl: 'normandielovers.fr',            gscType: 'domain', linkEvent: 'clic_affiliation', active: true },
  { name: 'Loire Lovers',      shortName: 'Loire',      ga4PropertyId: '334246061', gscSiteUrl: 'loirelovers.fr',                gscType: 'domain', linkEvent: 'click',            active: true },
  { name: 'Corsica Lovers',    shortName: 'Corse',      ga4PropertyId: '342031980', gscSiteUrl: 'corsicalovers.fr',              gscType: 'domain', linkEvent: 'clic_affiliation', active: true },
  { name: 'Provence Lovers',   shortName: 'Provence',   ga4PropertyId: '342046857', gscSiteUrl: 'provencelovers.fr',             gscType: 'domain', linkEvent: 'click',            active: true },
  { name: 'Canarias Lovers',   shortName: 'Canarias',   ga4PropertyId: '396965985', gscSiteUrl: 'canariaslovers.com',            gscType: 'domain', linkEvent: 'clic_affiliation', active: true },
  { name: 'Alsace Lovers',     shortName: 'Alsace',     ga4PropertyId: '342044368', gscSiteUrl: 'alsacelovers.com',              gscType: 'domain', linkEvent: 'clic_affiliation', active: true },
  { name: 'Madeira Lovers',    shortName: 'Madeira',    ga4PropertyId: '424178754', gscSiteUrl: 'madeiralovers.com',             gscType: 'domain', linkEvent: 'click',            active: true },
  { name: 'Canarias-Lovers',   shortName: 'Canarias 2', ga4PropertyId: '450006267', gscSiteUrl: 'canarias-lovers.com',           gscType: 'domain', linkEvent: 'click',            active: true },
  { name: 'Andalucia Lovers',  shortName: 'Andalucia',  ga4PropertyId: '450012505', gscSiteUrl: 'andalucialovers.com',           gscType: 'domain', linkEvent: 'clic_affiliation', active: true },
  { name: 'Iceland Lovers',    shortName: 'Iceland',    ga4PropertyId: '447781751', gscSiteUrl: 'iceland-lovers.com',            gscType: 'domain', linkEvent: 'click',            active: true },
];
