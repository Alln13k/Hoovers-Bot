// Couche d'acces Supabase. Le bot utilise la cle service_role, qui contourne
// le RLS pose dans supabase_schema.sql. Ne jamais l'exposer.

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

const throwOr = (label) => (error) => {
  throw new Error(`${label}: ${error.message}`);
};

// ---------------------------------------------------------------- ranks

export async function getRanks(guildId) {
  const { data, error } = await db()
    .from('ranks')
    .select('*')
    .eq('guild_id', guildId)
    .order('position', { ascending: false });
  if (error) throwOr('getRanks')(error);
  return data ?? [];
}

export async function createRank(guildId, { name, position, color, roleId }) {
  const { data, error } = await db()
    .from('ranks')
    .insert({
      guild_id: guildId,
      name,
      position,
      color,
      discord_role_id: roleId ?? null,
    })
    .select()
    .single();
  if (error) throwOr('createRank')(error);
  return data;
}

export async function updateRank(rankId, fields) {
  const { data, error } = await db()
    .from('ranks')
    .update(fields)
    .eq('id', rankId)
    .select()
    .single();
  if (error) throwOr('updateRank')(error);
  return data;
}

export async function deleteRank(rankId) {
  const { error } = await db().from('ranks').delete().eq('id', rankId);
  if (error) throwOr('deleteRank')(error);
}

// -------------------------------------------------------------- members

export async function getMember(guildId, userId) {
  const { data, error } = await db()
    .from('members')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error) throwOr('getMember')(error);
  return data ?? null;
}

export async function upsertMember(guildId, userId, fields = {}) {
  const { data, error } = await db()
    .from('members')
    .upsert(
      { guild_id: guildId, user_id: userId, ...fields },
      { onConflict: 'guild_id,user_id' },
    )
    .select()
    .single();
  if (error) throwOr('upsertMember')(error);
  return data;
}

export async function listMembers(guildId) {
  const { data, error } = await db()
    .from('members')
    .select('*')
    .eq('guild_id', guildId);
  if (error) throwOr('listMembers')(error);
  return data ?? [];
}

// ------------------------------------------------------------ sanctions

export async function addSanction(guildId, userId, moderatorId, type, reason, durationMinutes) {
  const payload = {
    guild_id: guildId,
    user_id: userId,
    moderator_id: moderatorId,
    type,
    reason,
    duration_minutes: durationMinutes ?? null,
  };
  if (durationMinutes) {
    payload.expires_at = new Date(
      Date.now() + durationMinutes * 60_000,
    ).toISOString();
  }
  const { data, error } = await db().from('sanctions').insert(payload).select().single();
  if (error) throwOr('addSanction')(error);
  return data;
}

export async function activeSanctions(guildId, userId) {
  const { data, error } = await db()
    .from('sanctions')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .eq('active', true);
  if (error) throwOr('activeSanctions')(error);
  return data ?? [];
}

export async function countSanctions(guildId, userId, type) {
  const { count, error } = await db()
    .from('sanctions')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .eq('type', type);
  if (error) throwOr('countSanctions')(error);
  return count ?? 0;
}

export async function revokeSanction(sanctionId) {
  const { error } = await db().from('sanctions').update({ active: false }).eq('id', sanctionId);
  if (error) throwOr('revokeSanction')(error);
}

// -------------------------------------------------------- applications

export async function createApplication(guildId, userId, answers) {
  const { data, error } = await db()
    .from('applications')
    .insert({ guild_id: guildId, user_id: userId, answers })
    .select()
    .single();
  if (error) throwOr('createApplication')(error);
  return data;
}

export async function getApplication(appId) {
  const { data, error } = await db()
    .from('applications')
    .select('*')
    .eq('id', appId)
    .limit(1)
    .maybeSingle();
  if (error) throwOr('getApplication')(error);
  return data ?? null;
}

export async function setApplicationStatus(appId, status, reviewedBy, note = null) {
  const { error } = await db()
    .from('applications')
    .update({ status, reviewed_by: reviewedBy, review_note: note })
    .eq('id', appId);
  if (error) throwOr('setApplicationStatus')(error);
}

export async function pendingApplications(guildId) {
  const { data, error } = await db()
    .from('applications')
    .select('*')
    .eq('guild_id', guildId)
    .eq('status', 'pending');
  if (error) throwOr('pendingApplications')(error);
  return data ?? [];
}

// ------------------------------------------------------------- tickets

export async function createTicket(guildId, userId, channelId, categoryId, subject) {
  const { data, error } = await db()
    .from('tickets')
    .insert({
      guild_id: guildId,
      user_id: userId,
      channel_id: channelId,
      category_id: categoryId,
      subject,
    })
    .select()
    .single();
  if (error) throwOr('createTicket')(error);
  return data;
}

export async function getTicketByChannel(guildId, channelId) {
  const { data, error } = await db()
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();
  if (error) throwOr('getTicketByChannel')(error);
  return data ?? null;
}

export async function closeTicket(guildId, channelId, closedBy) {
  const { error } = await db()
    .from('tickets')
    .update({ status: 'closed', closed_by: closedBy, closed_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .eq('channel_id', channelId);
  if (error) throwOr('closeTicket')(error);
}

// ------------------------------------------------------------ settings

export async function getSettings(guildId) {
  const { data, error } = await db()
    .from('settings')
    .select('*')
    .eq('guild_id', guildId)
    .limit(1)
    .maybeSingle();
  if (error) throwOr('getSettings')(error);
  return data ?? {};
}

export async function setSetting(guildId, fields) {
  const { data, error } = await db()
    .from('settings')
    .upsert({ guild_id: guildId, ...fields }, { onConflict: 'guild_id' })
    .select()
    .single();
  if (error) throwOr('setSetting')(error);
  return data;
}

// --------------------------------------------------------------- audit

/** Journalise une action. Ne leve jamais : un echec de log ne doit pas casser l'action. */
export async function logAction(guildId, actorId, action, targetId = null, details = {}) {
  try {
    const { error } = await db().from('audit_log').insert({
      guild_id: guildId,
      actor_id: actorId,
      action,
      target_id: targetId,
      details,
    });
    if (error) console.error('[audit]', action, error.message);
  } catch (e) {
    console.error('[audit]', action, e.message);
  }
}

export async function recentAudit(guildId, limit = 10) {
  const { data, error } = await db()
    .from('audit_log')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throwOr('recentAudit')(error);
  return data ?? [];
}
