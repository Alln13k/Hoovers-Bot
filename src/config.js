// Configuration centrale, lue depuis les variables d'environnement.

import 'dotenv/config';

function id(name) {
  const raw = process.env[name]?.trim();
  return raw || null;
}

function idList(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  // Discord
  token: process.env.DISCORD_TOKEN || '',
  clientId: id('CLIENT_ID'),
  publicGuildId: id('PUBLIC_GUILD_ID'), // serveur de dev/test, vide en prod
  ownerIds: idList('OWNER_IDS'),

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',

  // Site web
  port: Number(process.env.PORT || 3000),
  siteUrl: process.env.SITE_URL || '',
  clientSecret: process.env.CLIENT_SECRET || '',
  sessionSecret: process.env.SESSION_SECRET || '',
};

const REQUIRED = {
  DISCORD_TOKEN: 'token',
  CLIENT_ID: 'clientId',
  SUPABASE_URL: 'supabaseUrl',
  SUPABASE_KEY: 'supabaseKey',
  CLIENT_SECRET: 'clientSecret',
  SESSION_SECRET: 'sessionSecret',
};

/** Retourne la liste des variables manquantes ou invalides. */
export function validate() {
  const problems = [];
  for (const [name, key] of Object.entries(REQUIRED)) {
    if (!config[key]) problems.push(`${name} est vide`);
  }
  if (!config.siteUrl) problems.push('SITE_URL est vide (ex: https://monbot.fr)');
  if (config.token && config.token.split('.').length < 3) {
    problems.push('DISCORD_TOKEN a une forme invalide');
  }
  return problems;
}
