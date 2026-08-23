/**
 * Taux de change USD → EUR, au 1er du mois.
 *
 * Source : taux de référence de la Banque centrale européenne, via l'API Frankfurter
 * (https://api.frankfurter.dev, sans clé). Choix du 1er du mois parce que DiscoverCars
 * règle les commissions une fois par mois : le taux du début de mois est l'approximation
 * la plus proche du taux réellement appliqué au virement.
 *
 * La BCE ne cote NI les week-ends NI les jours fériés. Sur les 63 mois de la table,
 * 26 fois le 1er n'était pas un jour de cotation : la valeur retenue est alors la
 * dernière cotation publiée avant cette date. C'est aussi le comportement de l'API sur
 * une date isolée, donc les deux chemins concordent.
 *
 * La table est figée dans le code volontairement : un import ne doit pas dépendre d'un
 * appel réseau, et un montant converti doit rester reproductible à l'identique des mois
 * plus tard. Les mois postérieurs sont complétés à la demande par `chargerTauxManquants`,
 * qui interroge l'API et met en cache — et le taux appliqué est stocké sur chaque ligne
 * de revenu, donc toute correction ultérieure reste vérifiable.
 */

export const TAUX_USD_EUR_1ER_DU_MOIS: Record<string, number> = {
  '2021-06': 0.818,
  '2021-07': 0.84147,
  '2021-08': 0.84097,
  '2021-09': 0.84624,
  '2021-10': 0.86207,
  '2021-11': 0.86371,
  '2021-12': 0.88386,
  '2022-01': 0.88292,
  '2022-02': 0.8881,
  '2022-03': 0.8959,
  '2022-04': 0.90481,
  '2022-05': 0.94877,
  '2022-06': 0.93353,
  '2022-07': 0.95923,
  '2022-08': 0.97723,
  '2022-09': 0.9996,
  '2022-10': 1.0259,
  '2022-11': 1.0053,
  '2022-12': 0.95657,
  '2023-01': 0.93756,
  '2023-02': 0.91794,
  '2023-03': 0.93598,
  '2023-04': 0.91954,
  '2023-05': 0.91066,
  '2023-06': 0.93484,
  '2023-07': 0.9203,
  '2023-08': 0.91158,
  '2023-09': 0.92217,
  '2023-10': 0.94393,
  '2023-11': 0.94904,
  '2023-12': 0.91954,
  '2024-01': 0.90498,
  '2024-02': 0.92473,
  '2024-03': 0.92481,
  '2024-04': 0.92498,
  '2024-05': 0.93301,
  '2024-06': 0.92149,
  '2024-07': 0.93067,
  '2024-08': 0.92687,
  '2024-09': 0.90196,
  '2024-10': 0.90204,
  '2024-11': 0.9187,
  '2024-12': 0.94679,
  '2025-01': 0.96256,
  '2025-02': 0.96219,
  '2025-03': 0.96052,
  '2025-04': 0.92696,
  '2025-05': 0.87928,
  '2025-06': 0.88191,
  '2025-07': 0.84674,
  '2025-08': 0.87689,
  '2025-09': 0.85361,
  '2025-10': 0.85295,
  '2025-11': 0.8655,
  '2025-12': 0.85866,
  '2026-01': 0.85106,
  '2026-02': 0.839,
  '2026-03': 0.8471,
  '2026-04': 0.8617,
  '2026-05': 0.85455,
  '2026-06': 0.85866,
  '2026-07': 0.8785,
  '2026-08': 0.8707,
};

/** Dernier mois couvert par la table figée. */
export const DERNIER_MOIS_CONNU = Object.keys(TAUX_USD_EUR_1ER_DU_MOIS).sort().slice(-1)[0];

export interface TauxApplique {
  taux: number;
  mois: string;
  /** Vrai quand le mois demandé n'est pas dans la table et qu'on a repris le plus récent. */
  approxime: boolean;
}

/**
 * Taux à appliquer pour un mois « YYYY-MM ». Un mois inconnu — typiquement un mois à
 * venir — reprend le dernier taux connu, en le signalant : mieux vaut un montant
 * approché et marqué comme tel qu'un import qui échoue ou un montant en dollars compté
 * comme des euros.
 */
export function tauxUsdEur(
  mois: string,
  supplement?: Record<string, number>,
): TauxApplique {
  const direct = supplement?.[mois] ?? TAUX_USD_EUR_1ER_DU_MOIS[mois];
  if (direct !== undefined) return { taux: direct, mois, approxime: false };

  const connus = { ...TAUX_USD_EUR_1ER_DU_MOIS, ...(supplement ?? {}) };
  const anterieurs = Object.keys(connus).filter((m) => m <= mois).sort();
  const retenu = anterieurs.length
    ? anterieurs[anterieurs.length - 1]
    : Object.keys(connus).sort()[0];
  return { taux: connus[retenu], mois: retenu, approxime: true };
}

/**
 * Complète la table pour les mois absents, en interrogeant la BCE. Utilisé par l'import :
 * un échec réseau n'est pas bloquant, `tauxUsdEur` retombe alors sur le dernier taux connu.
 */
export async function chargerTauxManquants(moisDemandes: string[]): Promise<Record<string, number>> {
  const manquants = [...new Set(moisDemandes)]
    .filter((m) => /^\d{4}-\d{2}$/.test(m) && TAUX_USD_EUR_1ER_DU_MOIS[m] === undefined)
    .sort();
  if (manquants.length === 0) return {};

  const supplement: Record<string, number> = {};
  await Promise.all(manquants.map(async (mois) => {
    try {
      // Sur une date isolée, l'API renvoie la dernière cotation à cette date ou avant.
      const res = await fetch(`https://api.frankfurter.dev/v1/${mois}-01?base=USD&symbols=EUR`);
      if (!res.ok) return;
      const data = (await res.json()) as { rates?: { EUR?: number } };
      const taux = data.rates?.EUR;
      if (typeof taux === 'number' && taux > 0) supplement[mois] = taux;
    } catch {
      // Silencieux : l'appelant retombera sur le dernier taux connu, marqué approximé.
    }
  }));
  return supplement;
}
