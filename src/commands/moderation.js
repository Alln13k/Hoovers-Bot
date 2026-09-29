// Sanctions : warn, mute, kick, ban + retrait de sanction.

import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
} from 'discord.js';
import * as store from '../db.js';
import { logAction } from '../audit.js';
import {
  SANCTION_COLORS,
  SANCTION_LABELS,
  embed,
  fmtDuration,
  ko,
  ok,
  parseDuration,
} from '../helpers.js';

const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000; // 28 jours, plafond Discord

/** Applique un mute. Timeout natif si possible, role Muted sinon. */
async function applyMute(member, minutes) {
  if (minutes !== null && minutes * 60_000 <= MAX_TIMEOUT) {
    await member.timeout(minutes * 60_000, 'Sanction Hoovers');
    return 'timeout';
  }
  const role = member.guild.roles.cache.find((r) => r.name.toLowerCase() === 'muted');
  if (!role) return null;
  await member.roles.add(role, 'Sanction Hoovers');
  return 'role';
}

/** Retire un mute, quelle que soit la forme qu'il a pris. */
async function removeMute(member) {
  const role = member.guild.roles.cache.find((r) => r.name.toLowerCase() === 'muted');
  const results = [];
  if (member.isCommunicationDisabled?.()) {
    await member.timeout(null, 'Fin de sanction');
    results.push('timeout');
  }
  if (role && member.roles.cache.has(role.id)) {
    await member.roles.remove(role, 'Fin de sanction');
    results.push('role');
  }
  return results;
}

async function dm(member, label, reason, extra) {
  try {
    await member.user.send({
      embeds: [
        embed({
          title: label,
          description: `**Raison :** ${reason}\n**Detail :** ${extra}`,
          color: SANCTION_COLORS[label.toLowerCase()] ?? 0x99aabb,
        }),
      ],
    });
  } catch {
    /* DM fermes : ignore */
  }
}

/** Option de duree, en callback comme l'attend discord.js. */
const durOption = (description) => (option) =>
  option.setName('duree').setDescription(description);

export const commands = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Donne un warn a un membre')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Motif du warn').setRequired(true))
    .addStringOption((o) => o.setName('duree').setDescription("Duree de l'infraction (ex: 7j)"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription("Coupe les ecritures d'un membre")
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Motif du mute').setRequired(true))
    .addStringOption(durOption('Duree : 30m, 2h, 7j, perm'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulse un membre du serveur')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Motif du kick').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannit un membre du serveur')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Motif du ban').setRequired(true))
    .addStringOption(durOption('Duree : 7j ou perm'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription("Retire un warn (par ID ou tout l'historique)")
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('id').setDescription('ID court d un warn (ex: a1b2c3d4)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription("Retire le mute d'un membre avant l'echeance")
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('sanctions')
    .setDescription("Affiche l'historique de sanctions d'un membre")
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
];

export async function handle(interaction) {
  const { commandName } = interaction;
  const guild = interaction.guild;
  const member = interaction.options.getMember('membre');
  const reason = interaction.options.getString('raison');
  const rawDuration = interaction.options.getString('duree');

  if (commandName === 'warn') {
    const minutes = parseDuration(rawDuration);
    if (rawDuration && minutes === null) {
      return interaction.reply({
        embeds: [ko("Duree invalide. Formats acceptes : `30m`, `2h`, `7j`, `perm`.")],
        ephemeral: true,
      });
    }

    await store.addSanction(guild.id, member.id, interaction.user.id, 'warn', reason, minutes);
    const total = await store.countSanctions(guild.id, member.id, 'warn');

    await interaction.reply({
      embeds: [
        embed({
          title: 'Warn donne',
          description:
            `**${member}** a recu un warn.\n` +
            `**Raison :** ${reason}\n` +
            `**Total warns :** ${total}`,
          color: SANCTION_COLORS.warn,
        }),
      ],
    });
    await logAction(guild, 'sanction', interaction.user, member, {
      type: 'warn',
      reason,
      total,
    });
    await dm(member, 'Warn', reason, `${total} warn(s) au total`);
    return;
  }

  if (commandName === 'mute') {
    const minutes = parseDuration(rawDuration ?? '2h');
    if (minutes === null && !['perm', 'inf'].includes(rawDuration ?? '2h')) {
      return interaction.reply({
        embeds: [ko("Duree invalide. Formats acceptes : `30m`, `2h`, `7j`, `perm`.")],
        ephemeral: true,
      });
    }

    const label = minutes === null ? 'definitif' : fmtDuration(minutes);
    let method;
    try {
      method = await applyMute(member, minutes);
    } catch (e) {
      return interaction.reply({
        embeds: [ko(`Mute impossible : ${e.message}`)],
        ephemeral: true,
      });
    }
    if (!method) {
      return interaction.reply({
        embeds: [
          ko(
            "Mute de longue duree impossible : le timeout Discord plafonne a 28 jours " +
              "et aucun role `Muted` n'existe. Cree le role ou utilise une duree < 28j.",
          ),
        ],
        ephemeral: true,
      });
    }

    await store.addSanction(guild.id, member.id, interaction.user.id, 'mute', reason, minutes);
    await interaction.reply({
      embeds: [
        embed({
          title: 'Mute applique',
          description: `**${member}** est mute (${label}).\n**Raison :** ${reason}`,
          color: SANCTION_COLORS.mute,
        }),
      ],
    });
    await logAction(guild, 'sanction', interaction.user, member, {
      type: 'mute',
      reason,
      duration: label,
      method,
    });
    await dm(member, 'Mute', reason, label);
    return;
  }

  if (commandName === 'kick') {
    try {
      await member.user.send(`Tu as ete **expulse** du serveur Hoovers.\n**Raison :** ${reason}`);
    } catch {
      /* ignore */
    }
    try {
      await member.kick(`${interaction.user.tag}: ${reason}`);
    } catch (e) {
      return interaction.reply({
        embeds: [ko(`Kick impossible : ${e.message}`)],
        ephemeral: true,
      });
    }
    await store.addSanction(guild.id, member.id, interaction.user.id, 'kick', reason, null);
    await interaction.reply({
      embeds: [
        embed({
          title: 'Kick applique',
          description: `**${member.displayName}** a ete expulse.\n**Raison :** ${reason}`,
          color: SANCTION_COLORS.kick,
        }),
      ],
    });
    await logAction(guild, 'sanction', interaction.user, member, { type: 'kick', reason });
    return;
  }

  if (commandName === 'ban') {
    const minutes = parseDuration(rawDuration ?? 'perm');
    if (minutes === null && !['perm', 'inf'].includes(rawDuration ?? 'perm')) {
      return interaction.reply({
        embeds: [ko("Duree invalide. Formats acceptes : `7j`, `perm`.")],
        ephemeral: true,
      });
    }

    try {
      await member.user.send(`Tu as ete **banni** du serveur Hoovers.\n**Raison :** ${reason}`);
    } catch {
      /* ignore */
    }
    try {
      await member.ban({
        reason: `${interaction.user.tag}: ${reason}`,
        deleteMessageSeconds: minutes === null ? 0 : Math.min(7, Math.max(1, Math.floor(minutes / 1440))) * 86400,
      });
    } catch (e) {
      return interaction.reply({
        embeds: [ko(`Ban impossible : ${e.message}`)],
        ephemeral: true,
      });
    }

    await store.addSanction(guild.id, member.id, interaction.user.id, 'ban', reason, minutes);
    await interaction.reply({
      embeds: [
        embed({
          title: 'Ban applique',
          description: `**${member.user.tag}** a ete banni.\n**Raison :** ${reason}`,
          color: SANCTION_COLORS.ban,
        }),
      ],
    });
    await logAction(guild, 'sanction', interaction.user, member, {
      type: 'ban',
      reason,
      duration: minutes === null ? 'perm' : fmtDuration(minutes),
    });
    return;
  }

  if (commandName === 'unwarn') {
    const rows = await store.activeSanctions(guild.id, member.id);
    const warns = rows.filter((r) => r.type === 'warn');
    if (!warns.length) {
      return interaction.reply({
        embeds: [info(`**${member}** n'a aucun warn actif.`)],
        ephemeral: true,
      });
    }

    const shortId = interaction.options.getString('id');
    let count;
    if (shortId) {
      const row = warns.find((r) => r.id.startsWith(shortId));
      if (!row) {
        return interaction.reply({
          embeds: [ko('Sanction introuvable pour ce membre.')],
          ephemeral: true,
        });
      }
      await store.revokeSanction(row.id);
      count = 1;
    } else {
      for (const row of warns) await store.revokeSanction(row.id);
      count = warns.length;
    }

    await interaction.reply({
      embeds: [ok(`${count} warn(s) retire(s) pour **${member}**.`)],
    });
    await logAction(guild, 'unsanction', interaction.user, member, { removed: count, type: 'warn' });
    return;
  }

  if (commandName === 'unmute') {
    const removed = await removeMute(member);
    for (const row of await store.activeSanctions(guild.id, member.id)) {
      if (row.type === 'mute') await store.revokeSanction(row.id);
    }
    await interaction.reply({
      embeds: [ok(`**${member}** n'est plus mute${removed.length ? '' : ' (rien a retirer)'}.`)],
    });
    await logAction(guild, 'unsanction', interaction.user, member, { type: 'mute' });
    return;
  }

  if (commandName === 'sanctions') {
    const rows = await store.activeSanctions(guild.id, member.id);
    if (!rows.length) {
      return interaction.reply({
        embeds: [info(`**${member}** n'a aucune sanction active.`)],
        ephemeral: true,
      });
    }

    const counts = rows.reduce((acc, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts)
      .map(([type, n]) => `${SANCTION_LABELS[type] ?? type}: **${n}**`)
      .join('  |  ');
    const lines = rows.slice(0, 10).map((r) => {
      const mod = guild.members.cache.get(r.moderator_id);
      const who = mod ? `<@${mod.id}>` : `\`${r.moderator_id}\``;
      return `\`${r.id.slice(0, 8)}\` **${SANCTION_LABELS[r.type] ?? r.type}** par ${who} — ${r.reason}`;
    });

    await interaction.reply({
      embeds: [
        embed({
          title: `Sanctions de ${member.displayName}`,
          description: `**Total :** ${summary}\n\n${lines.join('\n')}`,
          thumbnail: member.user.displayAvatarURL(),
        }),
      ],
    });
  }
}

/** Nettoie les sanctions de mute expirees (le timeout Discord se leve tout seul). */
export async function sweepExpiredMutes(guild) {
  const now = new Date().toISOString();
  const { data } = await store.db()
    .from('sanctions')
    .select('*')
    .eq('guild_id', guild.id)
    .eq('type', 'mute')
    .eq('active', true)
    .not('expires_at', 'is', null)
    .lte('expires_at', now);
  for (const row of data ?? []) {
    await store.revokeSanction(row.id);
  }
  return (data ?? []).length;
}

export { ChannelType };
