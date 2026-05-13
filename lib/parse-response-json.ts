/**
 * Parse le corps d’une réponse fetch en JSON avec un message lisible si le serveur
 * renvoie du HTML ou du texte (ex. page d’erreur Vercel « An error occurred… »).
 */
export async function parseResponseJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    if (!res.ok) {
      throw new Error(`Réponse vide (HTTP ${res.status}).`);
    }
    return {} as T;
  }
  const c = trimmed[0];
  if (c !== '{' && c !== '[') {
    const isHtml = trimmed.startsWith('<') || trimmed.startsWith('<!') || trimmed.toLowerCase().includes('<html');
    const hint = isHtml
      ? 'Le serveur a renvoyé une page HTML (souvent timeout 504 ou erreur 500).'
      : `Réponse non JSON : « ${trimmed.slice(0, 100)}${trimmed.length > 100 ? '…' : ''} »`;
    throw new Error(`HTTP ${res.status} — ${hint}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Corps invalide (HTTP ${res.status}) : « ${trimmed.slice(0, 80)}${trimmed.length > 80 ? '…' : ''} »`,
    );
  }
}
