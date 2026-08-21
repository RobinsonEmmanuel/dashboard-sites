/**
 * Points saillants — sélection DÉTERMINISTE (aucun LLM) de ce qui mérite d'être
 * regardé, calculée à partir du dossier déjà produit. Même rôle que la sélection
 * d'exemples de l'audit IA : ancrer l'analyse sur des cas précis plutôt que de
 * laisser le modèle parcourir 300 lignes de séries et choisir au hasard.
 */

import type { DossierTrajectoire, EntonnoirSite } from './types';

export interface PointsSaillants {
  meilleure_progression_revenu: EntonnoirSite | null;
  plus_fort_recul_revenu: EntonnoirSite | null;
  meilleur_rpm: EntonnoirSite | null;
  plus_faible_rpm_parmi_les_gros_trafics: EntonnoirSite | null;
  plus_fort_recul_seo: EntonnoirSite | null;
  sites_trafic_sans_revenu: string[];
  sites_codes_affiliation_manquants: Array<{ site: string; manquants: string[] }>;
  mois_recents_hors_saison: Array<{ mois: string; promesses: number; index_saisonnier: number | null }>;
  /** Sites les plus et les moins produits sur 12 mois, rapportés à leur stock d'articles. */
  production_la_plus_forte: EntonnoirSite | null;
  production_la_plus_faible: EntonnoirSite | null;
  /** Là où la dette de mise à jour est la plus lourde en proportion du stock. */
  dette_maj_la_plus_lourde: Array<{ site: string; reste_a_maj: number; publies: number; part_pct: number }>;
}

/** Sites significatifs : au moins 5 000 sessions sur 12 mois — sinon tout ratio est du bruit. */
const SEUIL_SESSIONS = 5000;

export function selectionnerPointsSaillants(dossier: DossierTrajectoire): PointsSaillants {
  const sites = dossier.entonnoir_par_site;
  const significatifs = sites.filter((s) => s.courant.sessions >= SEUIL_SESSIONS);

  const minPar = <T>(arr: T[], val: (x: T) => number | null): T | null =>
    arr.reduce<T | null>((best, x) => {
      const v = val(x);
      if (v === null) return best;
      if (!best) return x;
      const bv = val(best);
      return bv === null || v < bv ? x : best;
    }, null);

  const maxPar = <T>(arr: T[], val: (x: T) => number | null): T | null =>
    arr.reduce<T | null>((best, x) => {
      const v = val(x);
      if (v === null) return best;
      if (!best) return x;
      const bv = val(best);
      return bv === null || v > bv ? x : best;
    }, null);

  // Comparaison d'évolution seulement là où N-1 existe : sinon un site neuf gagne toujours.
  const avecN1 = significatifs.filter((s) => s.n1.promesses > 0);

  const indexSaisonnier = new Map(
    dossier.saisonnalite.index_par_mois_calendaire.map((i) => [i.mois_calendaire, i.index]),
  );

  const moisRecents = dossier.serie_mensuelle_groupe
    .filter((m) => !m.incomplet.includes('revenus'))
    .slice(-6)
    .map((m) => ({
      mois: m.mois,
      promesses: m.promesses,
      index_saisonnier: indexSaisonnier.get(Number(m.mois.slice(5, 7))) ?? null,
    }));

  const avecProduction = significatifs.filter((s) => s.production.articles_nouveaux !== null);
  const partDette = (s: EntonnoirSite) =>
    s.production.reste_a_maj !== null && s.production.articles_publies
      ? Math.round((s.production.reste_a_maj / s.production.articles_publies) * 1000) / 10
      : null;

  return {
    production_la_plus_forte: maxPar(avecProduction, (s) => s.production.articles_nouveaux),
    production_la_plus_faible: minPar(avecProduction, (s) => s.production.articles_nouveaux),
    dette_maj_la_plus_lourde: sites
      .map((s) => ({ site: s.site, part: partDette(s), s }))
      .filter((x): x is { site: string; part: number; s: EntonnoirSite } => x.part !== null)
      .sort((a, b) => b.part - a.part)
      .slice(0, 5)
      .map((x) => ({
        site: x.site,
        reste_a_maj: x.s.production.reste_a_maj as number,
        publies: x.s.production.articles_publies as number,
        part_pct: x.part,
      })),
    meilleure_progression_revenu: maxPar(avecN1, (s) => s.evolution_pct.promesses),
    plus_fort_recul_revenu: minPar(avecN1, (s) => s.evolution_pct.promesses),
    meilleur_rpm: maxPar(significatifs, (s) => s.taux.rpm),
    plus_faible_rpm_parmi_les_gros_trafics: minPar(significatifs, (s) => s.taux.rpm),
    plus_fort_recul_seo: minPar(
      significatifs.filter((s) => s.n1.clics_seo > 0),
      (s) => s.evolution_pct.clics_seo,
    ),
    sites_trafic_sans_revenu: significatifs
      .filter((s) => s.courant.promesses === 0)
      .map((s) => s.site),
    sites_codes_affiliation_manquants: sites
      .filter((s) => s.actif && s.codes_affiliation_manquants.length > 0)
      .map((s) => ({ site: s.site, manquants: s.codes_affiliation_manquants })),
    mois_recents_hors_saison: moisRecents,
  };
}
