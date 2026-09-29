// Helpers d'embed, de permissions et de parsing.

import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

export const COLORS = {
  main: 0xe8b54d,
  error: 0xc0392b,
  success: 0x27ae60,
  neutral: 0x3a3a3c,
};

export const SANCTION_COLORS = {
  warn: 0xf1c40f,
  mute: 0x9b59b6,
  kick: 0xe67e22,
  ban: 0xc0392b,
};

export const SANCTION_LABELS = {
  warn: 'Warn',
  mute: 'Mute',
  kick: 'Kick',
  ban: 'Ban',
};

export function embed({ title, description, color = COLORS.main, footer, thumbnail }) {
  const e = new EmbedBuilder();
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  e.setColor(color);
  if (footer) e.setFooter({ text: footer });
  if (thumbnail) e.setThumbnail(thumbnail);
  return e;
}

export const ok = (description, extra = {}) =>
  embed({ title: 'Succes', description, color: COLORS.success, ...extra });

export const ko = (description, extra = {}) =>
  embed({ title: 'Erreur', description, color: COLORS.error, ...extra });

export const info = (description, extra = {}) =>
  embed({ title: 'Info', description, color: COLORS.neutral, ...extra });

/** Staff = peut gerer les roles. */
export const isStaff = (interaction) =>
  interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles);

export const isAdmin = (interaction) =>
  interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

export const isOwner = (interaction, ownerIds = []) =>
  ownerIds.includes(interaction.user.id);

/**
 * Parse une duree en minutes.
 * Accepte '30m', '2h', '7j', '1j12h', '2h30', '90' (= 90 min).
 * Renvoie null pour 'perm', 'inf' ou une saisie invalide.
 */
export function parseDuration(text) {
  if (text === undefined || text === null) return null;
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
      return null; // caractere parasite
    }
  }
  if (!seenUnit) return null;
  if (current) total += Number(current); // minutes en fin de chaine
  return total;
}

/** Formate des minutes en texte lisible : 90 -> '1h30m'. */
export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return 'definitif';
  const days = Math.floor(minutes / 1440);
  const rem = minutes % 1440;
  const hours = Math.floor(rem / 60);
  const mins = rem % 60;
  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  return parts.join('') || '0m';
}

/** Parse '1501234567890' ou '<#123>' en Snowflake. */
export function parseId(text) {
  if (!text) return null;
  const clean = String(text).replace(/[<#@>]/g, '').trim();
  return /^\d+$/.test(clean) ? clean : null;
}

/** Nom du grade a partir de son id. */
export function rankName(ranks, rankId) {
  if (!rankId) return 'Sans grade';
  const rank = ranks.find((r) => r.id === rankId);
  return rank ? rank.name : 'Grade supprime';
}

/** Couche de permissions d'un salon prive de ticket. */
export async function ticketOverwrites(guild, user) {
  const staff = guild.members.cache.filter((m) => m.permissions.has(PermissionFlagsBits.ManageChannels));
  const overwrites = {
    [guild.roles.everyone.id]: { ViewChannel: false },
    [guild.members.me.id]: { ViewChannel: true, SendMessages: true, ManageChannels: true },
    [user.id]: { ViewChannel: true, SendMessages: true },
  };
  for (const member of staff.values()) {
    overwrites[member.id] = { ViewChannel: true, SendMessages: true };
  }
  return overwrites;
}
