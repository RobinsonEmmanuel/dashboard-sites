import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifierRequete } from '@/lib/auth-server';

/**
 * Contrôle d'accès unique, pages ET routes API.
 *
 * Les routes `/api/*` étaient auparavant exclues du `matcher` : n'importe qui connaissant
 * une URL pouvait lire les revenus, le trafic et les analyses, et déclencher les
 * traitements coûteux (analyse de trajectoire, veille, imports). Elles passent désormais
 * par le même contrôle que les pages.
 *
 * Un point de contrôle unique plutôt qu'une vérification dans chaque route : une nouvelle
 * route est protégée par défaut, sans qu'on ait à y penser.
 */

/** Seule exception : sans elle, plus personne ne peut se connecter. */
const API_PUBLIQUES = ['/api/auth/login'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (API_PUBLIQUES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.next();
    }
    const resultat = await verifierRequete(request);
    if (!resultat.ok) {
      // Une API répond 401 ; la rediriger vers /login renverrait du HTML à un appel fetch.
      return NextResponse.json(
        { error: `Non autorisé — ${resultat.raison}` },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
      );
    }
    return NextResponse.next();
  }

  const pagesPubliques = ['/login'];
  if (pagesPubliques.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const resultat = await verifierRequete(request);
  if (!resultat.ok) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.ico).*)',
  ],
};
