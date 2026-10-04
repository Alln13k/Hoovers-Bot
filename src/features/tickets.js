// Tickets : un salon prive par demandeur, formulaire configurable depuis le site.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as store from '../db.js';
import { COLORS, embed, ko, ok, render } from '../helpers.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('setup-tickets')
    .setDescription('Active les tickets dans ce salon')
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Salon ou envoyer le bouton')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tickets')
    .setDescription("Etat des tickets du serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
];

export function openButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:open')
      .setLabel('Ouvrir un ticket')
      .setStyle(ButtonStyle.Primary),
  );
}

export function closeButton(ticketId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticketId}`)
      .setLabel('Fermer')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket:take:${ticketId}`)
      .setLabel('Prendre en charge')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Modal du formulaire, avec le nombre de questions configure sur le site. */
export function ticketModal(count = 1) {
  const modal = new ModalBuilder().setCustomId('ticket:form').setTitle('Ouvrir un ticket');
  modal.addComponents(
    new TextInputBuilder()
      .setCustomId('subject')
      .setLabel('Sujet')
      .setMaxLength(100)
      .setStyle(TextInputStyle.Short)
      .setRequired(true),
  );
  for (let i = 2; i <= Math.min(5, count); i += 1) {
    modal.addComponents(
      new TextInputBuilder()
        .setCustomId(`q${i}`)
        .setLabel(`Detail ${i - 1}`)
        .setMaxLength(500)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false),
    );
  }
  return modal;
}

export async function handle(interaction) {
  const { commandName } = interaction;
  const guild = interaction.guild;

  if (commandName === 'setup-tickets') {
    const salon = interaction.options.getChannel('salon');
    const parent = salon.parent?.id ?? null;

    await store.saveConfig(guild.id, { tickets_category: parent, tickets_enabled: true });
    await salon.send({
      embeds: [
        embed({
          title: 'Support',
          description:
            'Besoin d\'aide ? Clique sur le bouton ci-dessous pour ouvrir un ticket.\n' +
            'Un membre du staff te repondra des que possible.',
        }),
      ],
      components: [openButton()],
    });
    return interaction.reply({
      embeds: [ok(`Tickets actives. Panneau envoye dans ${salon}.`)],
      ephemeral: true,
    });
  }

  if (commandName === 'tickets') {
    const rows = await store.listTickets(guild.id, 10);
    const open = rows.filter((r) => r.status === 'open').length;
    if (!rows.length) {
      return interaction.reply({ embeds: [embed({ title: 'Tickets', description: 'Aucun ticket pour le moment.', color: COLORS.neutral })], ephemeral: true });
    }
    const lines = rows.map((r) => {
      const status = r.status === 'open' ? '🟢' : '⚪';
      const when = new Date(r.created_at).toLocaleString('fr-FR');
      return `${status} \`${when}\` — <@${r.user_id}> — ${r.subject ?? 'sans sujet'}`;
    });
    return interaction.reply({
      embeds: [
        embed({
          title: `Tickets (${open} ouvert(s))`,
          description: lines.join('\n'),
          color: COLORS.neutral,
        }),
      ],
      ephemeral: true,
    });
  }
}

/** Cree le salon prive. Appele depuis le bouton ou le modal. */
export async function createTicket(interaction, answers = {}) {
  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: true });

  const existing = await store.getOpenTicket(guild.id, interaction.user.id);
  if (existing) {
    const channel = guild.channels.cache.get(existing.channel_id);
    return interaction.editReply({
      embeds: [embed({ title: 'Ticket deja ouvert', description: `Tu as deja un ticket : <#${existing.channel_id}>${channel ? '' : ' (supprime)'}`, color: COLORS.neutral })],
    });
  }

  const config = await store.getConfig(guild.id);
  const category = config.tickets_category
    ? guild.channels.cache.get(config.tickets_category)
    : null;

  const staff = guild.members.cache.filter((m) => m.permissions.has(PermissionFlagsBits.ManageChannels));
  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
    },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
    },
    ...staff.map((m) => ({
      id: m.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
    })),
  ];

  try {
    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.displayName}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
      topic: `Ticket de ${interaction.user.tag} — ${interaction.user.id}`,
      permissionOverwrites,
      reason: `Ticket de ${interaction.user.tag}`,
    });

    const subject = answers.subject ?? 'Sans sujet';
    const row = await store.createTicket(guild.id, channel.id, interaction.user.id, subject, answers);

    const detailLines = Object.entries(answers)
      .filter(([k]) => k !== 'subject')
      .map(([k, v]) => `**${k} :** ${v}`)
      .join('\n');

    await channel.send({
      embeds: [
        embed({
          title: `Ticket — ${subject}`,
          description:
            `Salut **${interaction.user.displayName}**, merci d'avoir ouvert un ticket.\n` +
            `Un membre du staff te repondra ici.` +
            (detailLines ? `\n\n${detailLines}` : ''),
          footer: { text: `Ref ${row.id.slice(0, 8)}` },
        }),
      ],
      components: [closeButton(row.id)],
    });

    await interaction.editReply({ embeds: [ok(`Ticket ouvert : <#${channel.id}>`)] });
  } catch (e) {
    await interaction.editReply({
      embeds: [ko(`Impossible de creer le ticket : ${e.message}`)],
    });
  }
}

/** Ferme le ticket et supprime le salon. */
export async function closeTicket(interaction, ticketId) {
  await interaction.deferReply({ ephemeral: true });
  const row = await store.getTicketByChannel(interaction.channelId);
  if (!row) {
    return interaction.editReply({ embeds: [ko("Ce salon n'est pas un ticket.")] });
  }

  const opener = interaction.guild.members.cache.get(row.user_id);
  await interaction.channel.send({
    embeds: [ok(`Ticket clos par ${interaction.user.tag}. Suppression dans 5 secondes.`)],
  });
  if (opener) {
    await opener
      .user.send({ embeds: [embed({ title: 'Ticket ferme', description: `Ton ticket a ete clos par ${interaction.user.tag}.`, color: COLORS.neutral })] })
      .catch(() => {});
  }

  await store.closeTicket(row.id, interaction.user.id);
  await interaction.editReply({ embeds: [ok('Ticket clos.')] });
  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

export { render };
