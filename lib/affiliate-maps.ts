import type { Db } from 'mongodb';

export interface AffiliateMaps {
  booking: Record<string, string>;   // affiliateId → shortName
  gyg: Record<string, string>;       // campaign (cmp=) → shortName
  discovercars: Record<string, string>; // channel → shortName
  tiqets: Record<string, string>;    // campaign → shortName
}

/**
 * Construit les maps affilié→site à partir de la collection `sites` MongoDB.
 * Utilisé par l'import pour que toute modification de site dans l'interface
 * soit immédiatement prise en compte lors du prochain import CSV.
 */
export async function buildAffiliateMaps(db: Db): Promise<AffiliateMaps> {
  const sites = await db
    .collection<{
      shortName: string;
      bookingAffiliateId?: string;
      gygCampaign?: string;
      discoverCarsChan?: string;
      tiqetsCampaign?: string;
    }>('sites')
    .find({}, { projection: { shortName: 1, bookingAffiliateId: 1, gygCampaign: 1, discoverCarsChan: 1, tiqetsCampaign: 1 } })
    .toArray();

  const maps: AffiliateMaps = { booking: {}, gyg: {}, discovercars: {}, tiqets: {} };

  for (const site of sites) {
    const sn = site.shortName;
    if (site.bookingAffiliateId)  maps.booking[site.bookingAffiliateId]   = sn;
    if (site.gygCampaign)         maps.gyg[site.gygCampaign]              = sn;
    if (site.discoverCarsChan)    maps.discovercars[site.discoverCarsChan] = sn;
    if (site.tiqetsCampaign)      maps.tiqets[site.tiqetsCampaign]        = sn;
  }

  return maps;
}
