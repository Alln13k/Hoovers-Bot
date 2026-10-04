// Authentification du dashboard : OAuth2 Discord + sessions en base.
//
// Le secret est stocke hashe dans Supabase, jamais en clair.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 jours

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('hex');

/** Comparaison a temps constant, pour les tokens. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** URL d'autorisation Discord. */
export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${config.siteUrl}/auth/callback`,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

/** Echange le code contre un jeton d'acces, puis recupere l'utilisateur. */
export async function exchangeCode(code) {
  const res = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${config.siteUrl}/auth/callback`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Discord a refuse le code (${res.status})`);
  }
  const { access_token: accessToken } = await res.json();

  const meRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) throw new Error('Impossible de recuperer le profil');
  const user = await meRes.json();

  // Les serveurs ou l'utilisateur a Administrator, pour le dashboard
  const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const guilds = guildsRes.ok ? await guildsRes.json() : [];

  return { user, guilds, accessToken };
}

/** Cree une session et renvoie le token (en clair, une seule fois). */
export async function createSession(userId) {
  const { createSession: save } = await import('../db.js');
  const token = newToken();
  await save(hashToken(token), userId, SESSION_TTL);
  return token;
}

/**
 * Resout un cookie de session en utilisateur, ou null.
 * Ne renouvelle PAS le token : le cookie du navigateur devrait etre
 * reecrit a chaque visite, ce qui n'est paspossible ici et forcerait
 * une deconnexion. L'expiration est geree par `expires_at`.
 */
export async function resolveSession(rawToken) {
  if (!rawToken) return null;
  const { getSession } = await import('../db.js');
  const row = await getSession(hashToken(rawToken));
  if (!row) return null;
  return { userId: row.user_id };
}

export async function destroySession(rawToken) {
  if (!rawToken) return;
  const { deleteSession } = await import('../db.js');
  await deleteSession(hashToken(rawToken));
}

/** Verifie qu'un state anti-CSRF correspond au cookie. */
export function checkState(cookieState, queryState) {
  if (!cookieState || !queryState) return false;
  return safeEqual(cookieState, queryState);
}

export { SESSION_TTL, hashToken, newToken };
