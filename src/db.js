// Couche d'acces Supabase. Toute requete passe par guild_id : c'est ce qui
// garantit qu'un serveur ne voit jamais les donnees d'un autre.

import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

let client = null;

export function db() {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

const fail = (label) => (error) => {
  throw new Error(`${label}: ${error.message}`);
};

// ------------------------------------------------------------- guilds

/**
 * Enregistre ou met a jour un serveur.
 * Accepte soit un objet discord.js, soit { id, name, ownerId, iconHash }.
 */
export async function upsertGuild(guild) {
  const id = guild.id;
  const name = guild.name;
  const ownerId = guild.ownerId ?? guild.owner_id;
  const iconHash = guild.iconHash ?? guild.iconHash ?? null;

  const { data, error } = await db()
    .from('guilds')
    .upsert(
      {
        guild_id: id,
        name,
        owner_id: ownerId ?? null,
        icon_hash: iconHash,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' },
    )
    .select()
    .single();
  if (error) fail('upsertGuild')(error);
  return data;
}

export async function touchGuild(guildId) {
  const { error } = await db()
    .from('guilds')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('guild_id', guildId);
  if (error) console.error('[db] touchGuild:', error.message);
}

export async function deleteGuild(guildId) {
  for (const table of ['guild_config', 'guild_admins', 'tickets', 'guilds']) {
    const { error } = await db().from(table).delete().eq('guild_id', guildId);
    if (error) console.error(`[db] deleteGuild/${table}:`, error.message);
  }
}

export async function getGuildsForUser(userId) {
  const { data, error } = await db().from('guilds').select('*');
  if (error) fail('getGuildsForUser')(error);
  const owned = (data ?? []).filter((g) => g.owner_id === userId);
  const { data: adminRows, error: err2 } = await db()
    .from('guild_admins')
    .select('guild_id')
    .eq('user_id', userId);
  if (err2) fail('getGuildsForUser/admins')(err2);
  const adminIds = new Set((adminRows ?? []).map((r) => r.guild_id));
  return (data ?? []).filter((g) => g.owner_id === userId || adminIds.has(g.guild_id));
}

// ------------------------------------------------------------- admins

export async function isGuildAdmin(guildId, userId) {
  const { data, error } = await db()
    .from('guild_admins')
    .select('user_id')
    .eq('guild_id', guildId)
    .eq('user_id', userId);
  if (error) {
    console.error('[db] isGuildAdmin:', error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

export async function addGuildAdmin(guildId, userId, roleId = null) {
  const { error } = await db()
    .from('guild_admins')
    .upsert({ guild_id: guildId, user_id: userId, role_id: roleId }, { onConflict: 'guild_id,user_id' });
  if (error) fail('addGuildAdmin')(error);
}

export async function removeGuildAdmin(guildId, userId) {
  const { error } = await db()
    .from('guild_admins')
    .delete()
    .eq('guild_id', guildId)
    .eq('user_id', userId);
  if (error) fail('removeGuildAdmin')(error);
}

export async function listGuildAdmins(guildId) {
  const { data, error } = await db()
    .from('guild_admins')
    .select('*')
    .eq('guild_id', guildId);
  if (error) fail('listGuildAdmins')(error);
  return data ?? [];
}

// ------------------------------------------------------------- config

export const DEFAULT_CONFIG = {
  welcome_channel: null,
  welcome_message: null,
  leave_channel: null,
  leave_message: null,
  log_channel: null,
  tickets_category: null,
  tickets_enabled: false,
  tickets_message: null,
  tickets_count: 1,
  autorole_enabled: false,
  autorole_id: null,
  automod_enabled: false,
};

/** Seules les colonnes de config modifiables depuis le site. */
const CONFIG_FIELDS = Object.keys(DEFAULT_CONFIG);

export async function getConfig(guildId) {
  const { data, error } = await db()
    .from('guild_config')
    .select('*')
    .eq('guild_id', guildId)
    .limit(1)
    .maybeSingle();
  if (error) fail('getConfig')(error);
  if (!data) return { guild_id: guildId, ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...data };
}

/** Ecrit la config. Filtre les champs inconnus et valide les types. */
export async function saveConfig(guildId, patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!CONFIG_FIELDS.includes(key)) continue;
    clean[key] = normalise(key, value);
  }
  if (!Object.keys(clean).length) return getConfig(guildId);

  const { data, error } = await db()
    .from('guild_config')
    .upsert(
      { guild_id: guildId, ...clean, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )
    .select()
    .single();
  if (error) fail('saveConfig')(error);
  return { ...DEFAULT_CONFIG, ...data };
}

/** Normalise une valeur de config selon son type attendu. */
function normalise(key, value) {
  if (key === 'tickets_count') {
    const n = Number(value);
    return Math.min(5, Math.max(1, Number.isFinite(n) ? Math.trunc(n) : 1));
  }
  if (typeof DEFAULT_CONFIG[key] === 'boolean') return Boolean(value);
  if (key.endsWith('_channel') || key.endsWith('_category') || key === 'autorole_id') {
    if (value === null || value === '' || value === undefined) return null;
    const digits = String(value).replace(/[<#@&>]/g, '').trim();
    return /^\d+$/.test(digits) ? digits : null;
  }
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 2000);
}

// ------------------------------------------------------------ tickets

export async function createTicket(guildId, channelId, userId, subject, answers) {
  const { data, error } = await db()
    .from('tickets')
    .insert({
      guild_id: guildId,
      channel_id: channelId,
      user_id: userId,
      subject: subject ?? null,
      answers: answers ?? {},
    })
    .select()
    .single();
  if (error) fail('createTicket')(error);
  return data;
}

export async function getOpenTicket(guildId, userId) {
  const { data, error } = await db()
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();
  if (error) fail('getOpenTicket')(error);
  return data ?? null;
}

export async function getTicketByChannel(channelId) {
  const { data, error } = await db()
    .from('tickets')
    .select('*')
    .eq('channel_id', channelId)
    .limit(1)
    .maybeSingle();
  if (error) fail('getTicketByChannel')(error);
  return data ?? null;
}

export async function closeTicket(ticketId, closedBy) {
  const { error } = await db()
    .from('tickets')
    .update({ status: 'closed', closed_by: closedBy, closed_at: new Date().toISOString() })
    .eq('id', ticketId);
  if (error) fail('closeTicket')(error);
}

export async function listTickets(guildId, limit = 20) {
  const { data, error } = await db()
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail('listTickets')(error);
  return data ?? [];
}

// ---------------------------------------------------------- sessions

export async function createSession(token, userId, ttlMs) {
  const { error } = await db().from('web_sessions').insert({
    token,
    user_id: userId,
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
  });
  if (error) fail('createSession')(error);
}

export async function getSession(token) {
  const { data, error } = await db()
    .from('web_sessions')
    .select('*')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (error) fail('getSession')(error);
  return data ?? null;
}

export async function deleteSession(token) {
  const { error } = await db().from('web_sessions').delete().eq('token', token);
  if (error) fail('deleteSession')(error);
}
