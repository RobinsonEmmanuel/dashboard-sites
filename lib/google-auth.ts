import { JWT } from 'google-auth-library';

/**
 * Retourne un Bearer token valide pour les APIs Google.
 * Utilise les variables d'environnement GOOGLE_SERVICE_ACCOUNT_EMAIL et GOOGLE_PRIVATE_KEY.
 */
export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

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
