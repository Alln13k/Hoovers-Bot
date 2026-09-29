// Configuration centrale, lue depuis le .env (variables d'env en priorite).

import 'dotenv/config';

function id(name) {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

function idList(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: id('CLIENT_ID'),
  guildId: id('GUILD_ID'),
  ownerIds: idList('OWNER_IDS'),

  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',

  logSanctions: id('LOG_SANCTIONS_CHANNEL_ID'),
  logAudit: id('LOG_AUDIT_CHANNEL_ID'),
  logTickets: id('LOG_TICKETS_CHANNEL_ID'),
  ticketsCategory: id('TICKETS_CATEGORY_ID'),
};

/** Retourne la liste des variables manquantes. */
export function validate() {
  const problems = [];
  if (!config.token) problems.push('DISCORD_TOKEN est vide');
  if (!config.supabaseUrl) problems.push('SUPABASE_URL est vide');
  if (!config.supabaseKey) problems.push('SUPABASE_KEY est vide');
  if (!config.guildId) problems.push('GUILD_ID est vide');
  if (!config.clientId) problems.push('CLIENT_ID est vide');
  return problems;
}
