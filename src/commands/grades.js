// Grades : hierarchie + panel d'administration.
// Pas de reaction roles : l'admin pilote tout via /panel.

import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import * as store from '../db.js';
import { logAction } from '../audit.js';
import { embed, ko, ok, info } from '../helpers.js';

export const DEFAULT_RANKS = [
  { name: 'Boss', position: 100, color: '#E8B54D' },
  { name: 'Lieutenant', position: 80, color: '#C0C0C0' },
  { name: 'Soldat', position: 60, color: '#8B8B8B' },
  { name: 'Recrue', position: 20, color: '#6B7280' },
  { name: 'Prospect', position: 0, color: '#4B5563' },
];

/** Applique le role Discord du grade et retire les anciens roles gang. */
export async function applyRank(guild, member, rank) {
  if (!rank?.discord_role_id) return false;
  const ranks = await store.getRanks(guild.id);
  const gangRoleIds = new Set(ranks.map((r) => r.discord_role_id).filter(Boolean));
  const newRole = guild.roles.cache.get(rank.discord_role_id);
  if (!newRole) return false;

  try {
    for (const role of member.roles.cache.values()) {
      if (gangRoleIds.has(role.id) && role.id !== newRole.id) {
        await member.roles.remove(role, 'Changement de grade');
      }
    }
    if (!member.roles.cache.has(newRole.id)) {
      await member.roles.add(newRole, `Grade: ${rank.name}`);
    }
    return true;
  } catch (e) {
    console.error('[grades] application impossible:', e.message);
    return false;
  }
}

function rankLine(guild, rank) {
  const role = rank.discord_role_id ? guild.roles.cache.get(rank.discord_role_id) : null;
  return `\`${String(rank.position).padStart(3)}\` **${rank.name}** ${role ? `<@&${role.id}>` : '*(pas de role)*'}`;
}

export const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Ouvre le panel de gestion des grades')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('grade')
    .setDescription('Cree ou modifie un grade')
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('Operation')
        .setRequired(true)
        .addChoices(
          { name: 'creer', value: 'creer' },
          { name: 'position', value: 'position' },
          { name: 'couleur', value: 'couleur' },
          { name: 'supprimer', value: 'supprimer' },
        ),
    )
    .addStringOption((o) => o.setName('nom').setDescription('Nom du grade').setRequired(true))
    .addStringOption((o) => o.setName('valeur').setDescription('Position (0-100) ou couleur (#RRGGBB)'))
    .addRoleOption((o) => o.setName('role').setDescription('Role Discord a associer'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('init')
    .setDescription('Cree la hierarchie de grades par defaut')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Attribue un grade a un membre')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('grade').setDescription('Nom exact du grade').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('demote')
    .setDescription("Retire le grade d'un membre")
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('grades')
    .setDescription('Affiche la hierarchie'),
];

export async function handle(interaction) {
  const { commandName } = interaction;
  const guild = interaction.guild;

  if (commandName === 'panel') {
    const ranks = await store.getRanks(guild.id);
    if (!ranks.length) {
      return interaction.reply({
        embeds: [ko("Aucun grade configure. Lance `/init` pour creer la hierarchie de base.")],
        ephemeral: true,
      });
    }
    const select = await buildRankSelect(guild);
    const lines = ranks.map((r) => rankLine(guild, r)).join('\n');
    return interaction.reply({
      embeds: [
        embed({
          title: 'Panel des grades — Hoovers',
          description: `${lines}\n\n**Action :** choisis un grade ci-dessous pour l'assigner a un membre.`,
          footer: { text: 'Seul toi peux utiliser ce panel' },
        }),
      ],
      components: [
        select,
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('panel:delete')
            .setLabel('Gerer la suppression')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
      ephemeral: true,
    });
  }

  if (commandName === 'grades') {
    const ranks = await store.getRanks(guild.id);
    if (!ranks.length) {
      return interaction.reply({ embeds: [ko('Aucun grade configure.')] });
    }
    const lines = ranks.map(
      (r, i) => `${i + 1}. ${'▬'.repeat(Math.max(1, Math.floor(r.position / 10)))} **${r.name}**\n     ${
        r.discord_role_id ? `<@&${r.discord_role_id}>` : '—'
      }`,
    );
    return interaction.reply({
      embeds: [
        embed({
          title: 'Hierarchie des grades',
          description: lines.join('\n'),
          footer: { text: 'Du plus haut au plus bas' },
        }),
      ],
    });
  }

  if (commandName === 'init') {
    const existing = await store.getRanks(guild.id);
    if (existing.length) {
      return interaction.reply({
        embeds: [ko(`Ya deja **${existing.length}** grades. Supprime-les d'abord.`)],
        ephemeral: true,
      });
    }
    for (const r of DEFAULT_RANKS) {
      let role = guild.roles.cache.find((x) => x.name === r.name);
      if (!role) {
        role = await guild.roles
          .create({ name: r.name, color: parseInt(r.color.slice(1), 16), reason: 'Initialisation Hoovers' })
          .catch(() => null);
      }
      await store.createRank(guild.id, {
        name: r.name,
        position: r.position,
        color: r.color,
        roleId: role?.id ?? null,
      });
    }
    await interaction.reply({
      embeds: [ok(`**${DEFAULT_RANKS.length}** grades crees avec leurs roles Discord.\nModifie-les via \`/panel\` ou \`/grade\`.`)],
    });
    await logAction(guild, 'grade', interaction.user, null, { action_detail: 'initialisation' });
    return;
  }

  if (commandName === 'grade') {
    const action = interaction.options.getString('action');
    const name = interaction.options.getString('nom');
    const value = interaction.options.getString('valeur');
    const role = interaction.options.getRole('role');
    const ranks = await store.getRanks(guild.id);
    const existing = ranks.find((r) => r.name.toLowerCase() === name.toLowerCase());

    if (action === 'creer') {
      if (existing) {
        return interaction.reply({ embeds: [ko(`Le grade **${name}** existe deja.`)], ephemeral: true });
      }
      let position = 50;
      let color = '#9CA3AF';
      if (value?.startsWith('#')) color = value;
      else if (value && /^\d+$/.test(value)) position = Number(value);
      const row = await store.createRank(guild.id, { name, position, color, roleId: role?.id });
      await interaction.reply({
        embeds: [ok(`Grade **${row.name}** cree (position ${row.position}).${role ? `\nRole : <@&${role.id}>` : ''}`)],
      });
      await logAction(guild, 'grade', interaction.user, null, { nom: name, action_detail: 'creation', position });
      return;
    }

    if (!existing) {
      return interaction.reply({ embeds: [ko(`Grade **${name}** introuvable.`)], ephemeral: true });
    }

    if (action === 'position') {
      if (!value || !/^\d+$/.test(value)) {
        return interaction.reply({ embeds: [ko('Valeur invalide. Donne un nombre.')], ephemeral: true });
      }
      await store.updateRank(existing.id, { position: Number(value) });
      await interaction.reply({ embeds: [ok(`**${name}** est maintenant a la position ${value}.`)] });
      await logAction(guild, 'grade', interaction.user, null, { nom: name, action_detail: 'position', position: value });
      return;
    }

    if (action === 'couleur') {
      await store.updateRank(existing.id, { color: value || '#9CA3AF' });
      await interaction.reply({ embeds: [ok(`Couleur de **${name}** mise a jour.`)] });
      await logAction(guild, 'grade', interaction.user, null, { nom: name, action_detail: 'couleur', color: value });
      return;
    }

    await store.deleteRank(existing.id);
    await interaction.reply({ embeds: [ok(`Grade **${name}** supprime.`)] });
    await logAction(guild, 'grade', interaction.user, null, { nom: name, action_detail: 'suppression' });
    return;
  }

  if (commandName === 'promote') {
    const member = interaction.options.getMember('membre');
    const name = interaction.options.getString('grade');
    const ranks = await store.getRanks(guild.id);
    const rank = ranks.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!rank) {
      return interaction.reply({ embeds: [ko(`Grade **${name}** introuvable.`)], ephemeral: true });
    }
    const applied = await applyRank(guild, member, rank);
    await store.upsertMember(guild.id, member.id, {
      rank_id: rank.id,
      username: member.user.username,
    });
    await interaction.reply({
      embeds: [
        ok(
          `**${member}** est now **${rank.name}**.` +
            (applied ? '' : '\n*(Role Discord non applique — verifie mes perms.)*'),
        ),
      ],
    });
    await logAction(guild, 'promote', interaction.user, member, { grade: rank.name, applied });
    return;
  }

  if (commandName === 'demote') {
    const member = interaction.options.getMember('membre');
    const ranks = await store.getRanks(guild.id);
    const gangRoleIds = new Set(ranks.map((r) => r.discord_role_id).filter(Boolean));
    let removed = 0;
    for (const role of member.roles.cache.values()) {
      if (gangRoleIds.has(role.id)) {
        try {
          await member.roles.remove(role, 'Retrait de grade');
          removed += 1;
        } catch {
          /* ignore */
        }
      }
    }
    await store.upsertMember(guild.id, member.id, { rank_id: null });
    await interaction.reply({ embeds: [ok(`Grade retire de **${member}** (${removed} role(s)).`)] });
    await logAction(guild, 'demote', interaction.user, member, { roles_removed: removed });
  }
}

/** Construit le select de grade du panel. */
export async function buildRankSelect(guild) {
  const ranks = await store.getRanks(guild.id);
  if (!ranks.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:assign')
      .setPlaceholder('Assigner un grade a un membre...')
      .addOptions(
        ranks.slice(0, 25).map((r) => ({
          label: r.name,
          description: `Position ${r.position}`,
          value: r.id,
        })),
      ),
  );
}

export { rankLine, info };
