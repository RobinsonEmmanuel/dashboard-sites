import { NextRequest, NextResponse } from 'next/server';
import { estAdmin, signerJeton } from '@/lib/auth-server';

/**
 * POST /api/auth/login
 *
 * Même schéma que auditor et visior : `api-prod.regionlovers.ai` VÉRIFIE LE MOT DE PASSE,
 * puis le dashboard émet SON PROPRE jeton de session, signé HS256 avec son `JWT_SECRET`.
 *
 * Auparavant, cette route relayait tel quel le jeton d'api-prod. Le dashboard ne
 * possédant pas le secret de signature d'api-prod, il ne pouvait pas vérifier ce jeton :
 * la protection des pages et des routes API se réduisait à lire une date d'expiration
 * dans une charge utile non authentifiée. En émettant son propre jeton, le dashboard
 * contrôle le secret et la vérification devient réelle.
 *
 * Les jetons d'api-prod sont conservés dans `rlTokens` : ils restent nécessaires pour
 * appeler api-prod au nom de l'utilisateur (changement de mot de passe, par exemple).
 */

const API_URL = 'https://api-prod.regionlovers.ai';
const API_KEY = process.env.API_REGION_LOVERS;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 });
    }

    if (!API_KEY) {
      console.error('[AUTH] API_REGION_LOVERS non configurée');
      return NextResponse.json({ error: 'Configuration serveur manquante' }, { status: 500 });
    }

    if (!process.env.JWT_SECRET?.trim()) {
      console.error('[AUTH] JWT_SECRET non configurée — impossible d\'émettre une session');
      return NextResponse.json(
        { error: 'Configuration serveur manquante (JWT_SECRET)' },
        { status: 500 },
      );
    }

    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        accept: '*/*',
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText || 'Échec de la connexion' },
        { status: response.status },
      );
    }

    const data = await response.json();

    const nom =
      data?.user?.name ??
      data?.user?.firstName ??
      undefined;
    const admin = estAdmin(email);

    const accessToken = await signerJeton({
      email,
      name: nom,
      role: admin ? 'admin' : 'user',
    });

    // La forme reste celle attendue par lib/auth.ts (storeTokens) : rien à changer côté client.
    return NextResponse.json({
      accessToken,
      refreshToken: data?.refreshToken ?? data?.refresh_token ?? '',
      user: { email, name: nom, role: admin ? 'admin' : 'user' },
      rlTokens: {
        accessToken: data?.accessToken ?? data?.access_token ?? null,
        refreshToken: data?.refreshToken ?? data?.refresh_token ?? null,
      },
    });
  } catch (error) {
    console.error('[AUTH] Exception:', error);
    return NextResponse.json({ error: 'Erreur lors de la connexion' }, { status: 500 });
  }
}
