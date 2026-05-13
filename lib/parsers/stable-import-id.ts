import { createHash } from 'node:crypto';

const SEP = '\u001e';

/**
 * Identifiant stable quand le CSV ne fournit pas d’id commande :
 * même ligne → même clé entre deux imports (évite les doublons en base).
 * Ne pas inclure le statut si on veut qu’un passage Pending → Completed écrase la même ligne.
 */
export function stableFallbackOrderId(prefix: string, parts: readonly string[]): string {
  const payload = parts.map((p) => String(p).replaceAll(SEP, ' ')).join(SEP);
  const digest = createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 22);
  return `${prefix}${digest}`;
}
