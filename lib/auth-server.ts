/**
 * Émission et vérification des jetons de session, côté serveur.
 *
 * Même schéma que les autres applications Region Lovers (auditor, visior) :
 * `api-prod.regionlovers.ai/auth/login` ne sert qu'à VÉRIFIER LE MOT DE PASSE, puis
 * chaque application émet son PROPRE jeton, signé HS256 avec son propre `JWT_SECRET`,
 * et le vérifie avec ce même secret. Le dashboard ne dépend donc d'aucun secret
 * extérieur, et faire tourner le sien ne déconnecte que le dashboard.
 *
 * Trois niveaux de contrôle, du plus fort au plus faible selon la configuration :
 *
 *   1. `alg` refusé si absent ou « none » — TOUJOURS. C'est la forgerie la plus triviale
 *      (un jeton non signé avec une date d'expiration lointaine) et elle est fermée sans
 *      condition.
 *   2. Signature HMAC-SHA256 vérifiée si `JWT_SECRET` est défini. C'est le seul
 *      niveau qui rend un jeton infalsifiable. Tant que la variable est absente, le
 *      serveur le journalise plutôt que de laisser croire que la protection est complète.
 *   3. Structure et date d'expiration, dans tous les cas.
 *
 * Le secret partagé (`CRON_SECRET`) est accepté comme identifiant alternatif : c'est ce
 * que Vercel Cron envoie, et ce que les routes cron utilisent pour appeler les routes
 * d'ingestion du même déploiement.
 *
 * Tout ici doit rester compatible avec le runtime du proxy : uniquement Web Crypto et
 * `atob`, aucune dépendance Node.
 */

export type ResultatAuth =
  | { ok: true; source: 'jwt' | 'secret_partage'; email?: string }
  | { ok: false; raison: string };

interface ChargeJwt {
  exp?: number;
  email?: string;
  sub?: string;
  role?: string;
}

/** Durée de session, alignée sur visior. */
const DUREE_SESSION_HEURES = 24;

let avertissementSecretEmis = false;

function base64UrlVersTexte(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const complete = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(complete);
}

function base64UrlVersOctets(segment: string): Uint8Array {
  const texte = base64UrlVersTexte(segment);
  const octets = new Uint8Array(texte.length);
  for (let i = 0; i < texte.length; i++) octets[i] = texte.charCodeAt(i);
  return octets;
}

function octetsVersBase64Url(octets: Uint8Array): string {
  let binaire = '';
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function texteVersBase64Url(texte: string): string {
  return octetsVersBase64Url(new TextEncoder().encode(texte));
}

export interface Session {
  email: string;
  name?: string;
  role: string;
}

/**
 * Émet un jeton de session signé HS256. Utilisé par /api/auth/login une fois le mot de
 * passe validé par api-prod : c'est ce jeton, et lui seul, que le dashboard sait vérifier.
 */
export async function signerJeton(session: Session): Promise<string> {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'JWT_SECRET non définie : impossible d\'émettre un jeton de session. Définir une chaîne ' +
      'aléatoire de 64 caractères dans les variables d\'environnement.',
    );
  }

  const entete = texteVersBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const charge = texteVersBase64Url(JSON.stringify({
    email: session.email,
    sub: session.email,
    name: session.name,
    role: session.role,
    exp: Math.floor(Date.now() / 1000) + DUREE_SESSION_HEURES * 3600,
    iat: Math.floor(Date.now() / 1000),
  }));

  const cle = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cle,
    new TextEncoder().encode(`${entete}.${charge}`) as unknown as ArrayBuffer,
  );

  return `${entete}.${charge}.${octetsVersBase64Url(new Uint8Array(signature))}`;
}

/** Liste ADMIN_EMAILS, même convention que auditor et visior. */
export function estAdmin(email: string): boolean {
  const brut = process.env.ADMIN_EMAILS?.trim();
  if (!brut) return false;
  return brut.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    .includes(email.trim().toLowerCase());
}

/** Vérifie une signature HS256. Retourne false sur tout jeton malformé. */
async function signatureValide(token: string, secret: string): Promise<boolean> {
  const parties = token.split('.');
  if (parties.length !== 3) return false;
  try {
    const cle = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'HMAC',
      cle,
      base64UrlVersOctets(parties[2]) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${parties[0]}.${parties[1]}`) as unknown as ArrayBuffer,
    );
  } catch {
    return false;
  }
}

export async function verifierJeton(token: string): Promise<ResultatAuth> {
  const parties = token.split('.');
  if (parties.length !== 3) return { ok: false, raison: 'Jeton malformé' };

  let entete: { alg?: string };
  let charge: ChargeJwt;
  try {
    entete = JSON.parse(base64UrlVersTexte(parties[0])) as { alg?: string };
    charge = JSON.parse(base64UrlVersTexte(parties[1])) as ChargeJwt;
  } catch {
    return { ok: false, raison: 'Jeton illisible' };
  }

  const alg = (entete.alg ?? '').toUpperCase();
  // Un jeton « non signé » est une signature vide : refus inconditionnel.
  if (!alg || alg === 'NONE') return { ok: false, raison: 'Jeton non signé' };

  if (typeof charge.exp !== 'number') return { ok: false, raison: 'Jeton sans date d\'expiration' };
  if (Date.now() >= charge.exp * 1000) return { ok: false, raison: 'Jeton expiré' };

  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    if (alg !== 'HS256') {
      return { ok: false, raison: `Algorithme ${alg} non pris en charge (HS256 attendu)` };
    }
    if (!(await signatureValide(token, secret))) {
      return { ok: false, raison: 'Signature invalide' };
    }
  } else if (!avertissementSecretEmis) {
    avertissementSecretEmis = true;
    console.warn(
      '[AUTH] JWT_SECRET non définie : les jetons sont contrôlés sur leur structure et leur ' +
      'expiration, mais leur signature n\'est PAS vérifiée, et /api/auth/login ne peut pas en ' +
      'émettre. Définir une chaîne aléatoire de 64 caractères, propre à ce dashboard.',
    );
  }

  return { ok: true, source: 'jwt', email: charge.email ?? charge.sub };
}

/** Comparaison à durée constante, pour ne rien apprendre de la durée d'un refus. */
function egalConstant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Contrôle une requête entrante : jeton porteur, cookie de session, ou secret partagé
 * des tâches planifiées.
 */
export async function verifierRequete(request: Request & { cookies?: unknown }): Promise<ResultatAuth> {
  const entete = request.headers.get('authorization') ?? '';
  const porteur = entete.startsWith('Bearer ') ? entete.slice(7).trim() : '';

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (porteur && cronSecret && egalConstant(porteur, cronSecret)) {
    return { ok: true, source: 'secret_partage' };
  }

  if (porteur) return verifierJeton(porteur);

  const cookies = (request as { cookies?: { get?: (n: string) => { value: string } | undefined } }).cookies;
  const cookie = cookies?.get?.('accessToken')?.value;
  if (cookie) return verifierJeton(cookie);

  return { ok: false, raison: 'Aucun jeton fourni' };
}
