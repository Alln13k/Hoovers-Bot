// Journal d'audit + listing des commandes.

import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import * as store from '../db.js';
import { embed, info } from '../helpers.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('log')
    .setDescription("Consulte le journal d'audit")
    .addIntegerOption((o) =>
      o.setName('limite').setDescription("Nombre d'entrees").setMinValue(1).setMaxValue(50),
    ),

  new SlashCommandBuilder()
    .setName('commandes')
    .setDescription('Liste les commandes du bot'),
];

export async function handle(interaction) {
  const { commandName } = interaction;
  const guild = interaction.guild;

  if (commandName === 'commandes') {
    const list = interaction.client.commands
      ? [...interaction.client.commands.keys()].sort()
      : [];
    const lines = list.map((n) => `• \`/${n}\``);
    return interaction.reply({
      embeds: [
        embed({
          title: `Commandes disponibles (${lines.length})`,
          description: lines.join('\n') || 'Aucune commande enregistree.',
          footer: { text: `${interaction.client.commands?.size ?? 0} commandes` },
        }),
      ],
      ephemeral: true,
    });
  }

  if (!interaction.memberPermissions?.has('ManageRoles')) {
    return interaction.reply({
      embeds: [info('Reserve au staff.')],
      ephemeral: true,
    });
  }

  const limit = interaction.options.getInteger('limite') ?? 10;
  const rows = await store.recentAudit(guild.id, limit);
  if (!rows.length) {
    return interaction.reply({ embeds: [info('Le journal est vide.')], ephemeral: true });
  }

  const lines = rows.map((r) => {
    const when = new Date(r.created_at).toLocaleString('fr-FR');
    return `\`${when}\` **${r.action}** par <@${r.actor_id}>`;
  });
  return interaction.reply({
    embeds: [embed({ title: "Journal d'audit", description: lines.join('\n'), footer: { text: `${rows.length} entrees` } })],
    ephemeral: true,
  });
}

export { config };
