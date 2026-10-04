// Serveur web du dashboard. HTTP natif, sans framework.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import * as store from '../db.js';
import * as auth from './auth.js';
import { esc, errorPage, guildConfigPage, guildListPage, loginPage } from './views.js';

const COOKIE = 'session';
const STATE_COOKIE = 'state';

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf('=');
        return i === -1 ? [c, ''] : [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
      }),
  );
}

const cookie = (name, value, { maxAge, httpOnly = true } = {}) =>
  `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}` +
  (maxAge !== undefined ? `; Max-Age=${Math.floor(maxAge / 1000)}` : '');

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function send(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/** Lit le corps d'un formulaire (application/x-www-form-urlencoded). */
async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Corps trop volumineux');
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

export function createDashboardServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, config.siteUrl || 'http://localhost');
    const cookies = parseCookies(req.headers.cookie);
    const path = url.pathname;

    try {
      // ---- OAuth -------------------------------------------------------
      if (path === '/' || path === '/login') {
        const existing = await auth.resolveSession(cookies[COOKIE]);
        return existing ? redirect(res, '/guilds') : send(res, 200, loginPage());
      }

      if (path === '/auth/login') {
        const state = randomBytes(16).toString('hex');
        res.writeHead(302, {
          Location: auth.authorizeUrl(state),
          'Set-Cookie': cookie(STATE_COOKIE, state, { maxAge: 600 * 1000, httpOnly: false }),
        });
        return res.end();
      }

      if (path === '/auth/callback') {
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        if (!auth.checkState(cookies[STATE_COOKIE], state)) {
          return send(res, 400, errorPage('Requete invalide (state incorrect).'));
        }
        const { user, guilds } = await auth.exchangeCode(code);
        const token = await auth.createSession(user.id);

        const admins = guilds.filter((g) => g.permissions?.includes('8')); // Administrator
        res.writeHead(302, {
          Location: `/guilds?u=${encodeURIComponent(user.username)}&n=${admins.length}`,
          'Set-Cookie': [
            cookie(COOKIE, token, { maxAge: auth.SESSION_TTL }),
            `${STATE_COOKIE}=; Path=/; Max-Age=0`,
          ],
        });
        return res.end();
      }

      if (path === '/logout' && req.method === 'POST') {
        await auth.destroySession(cookies[COOKIE]);
        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0`,
        });
        return res.end();
      }

      // ---- Garde-fou : tout le reste exige une session -----------------
      const session = await auth.resolveSession(cookies[COOKIE]);
      if (!session) return redirect(res, '/');

      // ---- Invitation d'un serveur ------------------------------------
      if (path.startsWith('/invite/')) {
        const guildId = path.split('/')[2];
        const perms = '8'; // Administrator
        return redirect(
          res,
          `https://discord.com/oauth2/authorize?client_id=${config.clientId}` +
            `&permissions=${perms}&scope=bot%20applications.commands&guild_id=${encodeURIComponent(guildId)}`,
        );
      }

      // ---- Liste des serveurs -----------------------------------------
      if (path === '/guilds') {
        const rows = await store.getGuildsForUser(session.userId);
        const visible = rows.map((g) => ({ ...g, iconHash: g.icon_hash }));
        return send(res, 200, guildListPage(visible, {
          kind: 'ok',
          message: `${visible.length} serveur(s) configure(s).`,
        }));
      }

      // ---- Config d'un serveur ----------------------------------------
      const match = path.match(/^\/guild\/(\d+)(\/leave)?$/);
      if (match) {
        const guildId = match[1];

        if (!(await store.isGuildAdmin(guildId, session.userId))) {
          return send(res, 403, errorPage("Tu n'es pas admin de ce serveur."));
        }

        if (match[2] && req.method === 'POST') {
          await store.deleteGuild(guildId);
          return redirect(res, '/guilds');
        }

        if (req.method === 'POST') {
          const form = await readForm(req);
          await store.saveConfig(guildId, {
            welcome_channel: form.welcome_channel,
            welcome_message: form.welcome_message,
            leave_channel: form.leave_channel,
            leave_message: form.leave_message,
            tickets_category: form.tickets_category,
            tickets_enabled: form.tickets_enabled === 'true',
            tickets_count: form.tickets_count,
            autorole_id: form.autorole_id,
            autorole_enabled: form.autorole_enabled === 'true',
            log_channel: form.log_channel,
          });
          return send(
            res,
            200,
            guildConfigPage(
              { guild_id: guildId, name: guildId },
              await store.getConfig(guildId),
              { kind: 'ok', message: 'Configuration enregistree.' },
            ),
          );
        }

        const config = await store.getConfig(guildId);
        const row = await store.db()
          .from('guilds')
          .select('name')
          .eq('guild_id', guildId)
          .limit(1)
          .maybeSingle();
        return send(
          res,
          200,
          guildConfigPage({ guild_id: guildId, name: row?.name ?? guildId }, config, null),
        );
      }

      return send(res, 404, errorPage('Page introuvable.'));
    } catch (e) {
      console.error('[web]', e.stack ?? e.message);
      return send(res, 500, errorPage('Erreur interne du serveur.'));
    }
  });
}

/** Demarre le dashboard. */
export function startDashboard() {
  const server = createDashboardServer();
  server.listen(config.port, () => {
    console.log(`[web] dashboard sur http://localhost:${config.port}`);
  });
  return server;
}

export { esc };
