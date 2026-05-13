import { createPrivateKey } from 'crypto';
import { JWT } from 'google-auth-library';

/**
 * Remet une PEM de compte de service au format PKCS#8 reconnu par OpenSSL 3 (Node 17+).
 * Sur Vercel, une clé `BEGIN RSA PRIVATE KEY` ou des retours chariot incorrects peut provoquer
 * `error:1E08010C:DECODER routines::unsupported` sans cette étape.
 */
function normalizeServiceAccountPrivateKey(raw: string): string {
  let key = raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).replace(/\\n/g, '\n').trim();
  }
  if (!key.includes('BEGIN') || !key.includes('PRIVATE KEY')) {
    return key;
  }
  try {
    const pk = createPrivateKey({ key, format: 'pem' });
    return pk.export({ format: 'pem', type: 'pkcs8' }) as string;
  } catch {
    return key;
  }
}

/**
 * Retourne un Bearer token valide pour les APIs Google.
 * Utilise les variables d'environnement GOOGLE_SERVICE_ACCOUNT_EMAIL et GOOGLE_PRIVATE_KEY.
 */
export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const key = rawKey ? normalizeServiceAccountPrivateKey(rawKey) : undefined;

  if (!email || !key) {
    throw new Error(
      'Variables d\'environnement Google manquantes : GOOGLE_SERVICE_ACCOUNT_EMAIL et/ou GOOGLE_PRIVATE_KEY'
    );
  }

  const auth = new JWT({ email, key, scopes });
  const tokenResponse = await auth.getAccessToken();

  if (!tokenResponse.token) {
    throw new Error('Impossible d\'obtenir un token Google');
  }

  return tokenResponse.token;
}
