// Helpers partages : embeds, permissions, parsing.

import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

export const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  error: 0xed4245,
  neutral: 0x2b2d31,
};

export function embed({ title, description, color = COLORS.primary, footer, thumbnail, color: c2 }) {
  const e = new EmbedBuilder();
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  e.setColor(c2 ?? color);
  if (footer) e.setFooter({ text: footer });
  if (thumbnail) e.setThumbnail(thumbnail);
  return e;
}

export const ok = (description, extra) =>
  embed({ title: '✅ Succes', description, color: COLORS.success, ...extra });

export const ko = (description, extra) =>
  embed({ title: '⚠️ Erreur', description, color: COLORS.error, ...extra });

export const info = (description, extra) =>
  embed({ title: 'ℹ️ Info', description, color: COLORS.neutral, ...extra });

export const isAdmin = (interaction) =>
  interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

export const isModerator = (interaction) =>
  interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
  interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles);

/** Remplace {user}, {username}, {tag}, {server}, {count} dans un texte. */
export function render(template, { member, guild, count } = {}) {
  if (!template) return null;
  return String(template)
    .replaceAll('{user}', member ? `<@${member.id}>` : '')
    .replaceAll('{username}', member?.user?.username ?? '')
    .replaceAll('{tag}', member?.user?.tag ?? '')
    .replaceAll('{server}', guild?.name ?? '')
    .replaceAll('{count}', count ?? '');
}

/** Parse une duree en minutes : '30m', '2h', '7j', '90'. null si invalide. */
export function parseDuration(text) {
  if (text === null || text === undefined) return null;
  const value = String(text).trim().toLowerCase();
  if (['', 'perm', 'inf', 'definitif'].includes(value)) return null;
  if (/^\d+$/.test(value)) return Number(value);

  const units = { m: 1, h: 60, j: 1440, d: 1440, w: 10080 };
  let total = 0;
  let current = '';
  let seenUnit = false;
  for (const ch of value) {
    if (ch >= '0' && ch <= '9') {
      current += ch;
    } else if (units[ch] !== undefined && current !== '') {
      total += Number(current) * units[ch];
      current = '';
      seenUnit = true;
    } else {
      return null;
    }
  }
  if (!seenUnit) return null;
  if (current) total += Number(current);
  return total;
}

/** Charge la config d'un serveur. Un echec ne doit jamais casser une commande. */
export async function safeConfig(guildId) {
  const { getConfig } = await import('./db.js');
  try {
    return await getConfig(guildId);
  } catch (e) {
    console.error('[config] chargement impossible:', e.message);
    return { guild_id: guildId };
  }
}
