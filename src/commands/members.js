// Fiches membres : profil, roster, ajout manuel, stats.

import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as store from '../db.js';
import { logAction } from '../audit.js';
import { applyRank } from './grades.js';
import { embed, info, ko, ok, rankName } from '../helpers.js';

const STATUS = {
  active: '🟢 Actif',
  recrue: '🟡 Recrue',
  inactif: '⚪ Inactif',
  parti: '🔴 Parti',
};

export const commands = [
  new SlashCommandBuilder()
    .setName('fiche')
    .setDescription("Affiche la fiche d'un membre")
    .addUserOption((o) => o.setName('membre').setDescription('Le membre')),

  new SlashCommandBuilder()
    .setName('ajouter')
    .setDescription('Cree ou met a jour la fiche d un membre')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('grade').setDescription('Grade a attribuer'))
    .addStringOption((o) =>
      o
        .setName('statut')
        .setDescription('Etat du membre')
        .addChoices(
          { name: 'Actif', value: 'active' },
          { name: 'Recrue', value: 'recrue' },
          { name: 'Inactif', value: 'inactif' },
          { name: 'Parti', value: 'parti' },
        ),
    )
    .addStringOption((o) => o.setName('notes').setDescription('Notes internes staff'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('roster')
    .setDescription('Liste tous les membres du gang'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Statistiques du gang'),
];

export async function handle(interaction) {
  const { commandName } = interaction;
  const guild = interaction.guild;

  if (commandName === 'fiche') {
    const member = interaction.options.getMember('membre') ?? interaction.member;
    const ranks = await store.getRanks(guild.id);
    const row = await store.getMember(guild.id, member.id);

    if (!row) {
      return interaction.reply({
        embeds: [
          info(
            `**${member.displayName}** n'a pas encore de fiche.\nUn admin peut en creer une avec \`/ajouter\`.`,
            { thumbnail: member.user.displayAvatarURL() },
          ),
        ],
      });
    }

    const warnCount = await store.countSanctions(guild.id, member.id, 'warn');
    const active = await store.activeSanctions(guild.id, member.id);
    const joined = new Date(row.joined_at).toLocaleDateString('fr-FR');

    const e = embed({
      title: `Fiche — ${member.displayName}`,
      description:
        `**Grade :** ${rankName(ranks, row.rank_id)}\n` +
        `**Statut :** ${STATUS[row.status] ?? row.status}\n` +
        `**Membre depuis :** ${joined}\n` +
        `**Warns :** ${warnCount}\n` +
        `**Sanctions actives :** ${active.length}\n` +
        `**ID :** \`${member.id}\``,
      thumbnail: member.user.displayAvatarURL(),
      footer: { text: `Demande par ${interaction.user.displayName}` },
    });
    if (row.notes) e.addFields({ name: 'Notes staff', value: String(row.notes).slice(0, 1024) });

    return interaction.reply({ embeds: [e] });
  }

  if (commandName === 'ajouter') {
    const member = interaction.options.getMember('membre');
    const grade = interaction.options.getString('grade');
    const statut = interaction.options.getString('statut') ?? 'active';
    const notes = interaction.options.getString('notes');

    let rankId = null;
    if (grade) {
      const ranks = await store.getRanks(guild.id);
      const rank = ranks.find((r) => r.name.toLowerCase() === grade.toLowerCase());
      if (!rank) {
        return interaction.reply({ embeds: [ko(`Grade **${grade}** introuvable.`)], ephemeral: true });
      }
      rankId = rank.id;
      await applyRank(guild, member, rank);
    }

    await store.upsertMember(guild.id, member.id, {
      rank_id: rankId,
      username: member.user.username,
      status: statut,
      notes,
    });
    await interaction.reply({ embeds: [ok(`Fiche de **${member}** enregistree.`)] });
    await logAction(guild, 'member', interaction.user, member, {
      grade: grade || 'inchange',
      status: statut,
    });
    return;
  }

  if (commandName === 'roster') {
    const rows = await store.listMembers(guild.id);
    if (!rows.length) {
      return interaction.reply({ embeds: [info('Aucune fiche membre enregistree.')] });
    }
    const ranks = await store.getRanks(guild.id);
    const byRank = new Map();
    for (const r of rows) {
      const key = rankName(ranks, r.rank_id);
      if (!byRank.has(key)) byRank.set(key, []);
      byRank.get(key).push(r.username || r.user_id);
    }
    const order = [...byRank.keys()].sort(
      (a, b) =>
        (ranks.find((r) => r.name === b)?.position ?? 0) -
        (ranks.find((r) => r.name === a)?.position ?? 0),
    );
    const lines = order.map((grade) => {
      const members = byRank.get(grade);
      const shown = members.slice(0, 25).map((m) => `  • ${m}`).join('\n');
      const more = members.length > 25 ? `\n  _...et ${members.length - 25} autres_` : '';
      return `**${grade}** (${members.length})\n${shown}${more}`;
    });

    return interaction.reply({
      embeds: [
        embed({
          title: `Roster Hoovers — ${rows.length} membres`,
          description: lines.join('\n\n'),
        }),
      ],
    });
  }

  if (commandName === 'stats') {
    const rows = await store.listMembers(guild.id);
    if (!rows.length) return interaction.reply({ embeds: [info('Aucune donnee.')] });

    const active = rows.filter((r) => r.status === 'active').length;
    const inactifs = rows.filter((r) => ['inactif', 'parti'].includes(r.status)).length;
    let totalWarns = 0;
    for (const r of rows) {
      totalWarns += await store.countSanctions(guild.id, r.user_id, 'warn');
    }

    return interaction.reply({
      embeds: [
        embed({
          title: 'Statistiques Hoovers',
          description:
            `**Membres enregistres :** ${rows.length}\n` +
            `**Actifs :** ${active}\n` +
            `**Inactifs / partis :** ${inactifs}\n` +
            `**Warns cumules :** ${totalWarns}\n` +
            `**Taux d'activite :** ${Math.round((active / rows.length) * 100)}%`,
          color: 0x27ae60,
        }),
      ],
    });
  }
}
