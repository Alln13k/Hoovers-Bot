// Tickets : un salon prive par demandeur, fermable par le staff.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import * as store from '../db.js';
import { logAction } from '../audit.js';
import { embed, info, ko, ok, ticketOverwrites } from '../helpers.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('setup-tickets')
    .setDescription('Envoie le panneau de tickets dans un salon')
    .addChannelOption((o) =>
      o.setName('salon').setDescription('Salon du bouton').setRequired(true).addChannelTypes(0),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Historique des tickets')
    .addUserOption((o) => o.setName('membre').setDescription('Filtrer par membre'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
];

export function openButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:open')
      .setLabel('Ouvrir un ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
  );
}

export function closeButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Fermer le ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒'),
  );
}

export async function handle(interaction) {
  const { commandName } = interaction;
  const guild = interaction.guild;

  if (commandName === 'setup-tickets') {
    const salon = interaction.options.getChannel('salon');
    await salon.send({
      embeds: [
        embed({
          title: 'Tickets Hoovers',
          description: "Besoin d'aide ou tu as une question ? Ouvre un ticket.",
        }),
      ],
      components: [openButton()],
    });
    await interaction.reply({
      embeds: [ok(`Panneau de tickets envoye dans ${salon}.`)],
      ephemeral: true,
    });
    await logAction(guild, 'ticket', interaction.user, null, { action_detail: 'Setup' });
    return;
  }

  if (commandName === 'tickets') {
    const target = interaction.options.getUser('membre');
    let query = store.db().from('tickets').select('*').eq('guild_id', guild.id);
    if (target) query = query.eq('user_id', target.id);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    if (!data?.length) return interaction.reply({ embeds: [info('Aucun ticket trouve.')] });

    const lines = data.map((r) => {
      const member = guild.members.cache.get(r.user_id);
      const who = member ? member.displayName : r.user_id;
      const when = new Date(r.created_at).toLocaleString('fr-FR');
      return `${r.status === 'open' ? '🟢' : '🔴'} \`${when}\` — **${who}**`;
    });
    return interaction.reply({
      embeds: [
        embed({
          title: `Tickets${target ? ` — ${target.username}` : ''} (${data.length})`,
          description: lines.join('\n'),
          color: 0x3a3a3c,
        }),
      ],
      ephemeral: true,
    });
  }
}

/** Cree le salon prive du ticket. */
export async function createTicket(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: true });

  const { data: existing } = await store.db()
    .from('tickets')
    .select('*')
    .eq('guild_id', guild.id)
    .eq('user_id', interaction.user.id)
    .eq('status', 'open');
  if (existing?.length) {
    const channel = guild.channels.cache.get(existing[0].channel_id);
    return interaction.editReply({
      embeds: [info(`Tu as deja un ticket ouvert : ${channel ?? 'introuvable'}`)],
    });
  }

  const category =
    (process.env.TICKETS_CATEGORY_ID && guild.channels.cache.get(process.env.TICKETS_CATEGORY_ID)) ||
    guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory) ||
    null;

  try {
    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.displayName}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: category?.id,
      topic: `Ticket de ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: await ticketOverwrites(guild, interaction.member),
      reason: `Ticket de ${interaction.user.tag}`,
    });

    await store.createTicket(guild.id, interaction.user.id, channel.id, category?.id ?? null, 'Ticket');

    await channel.send({
      embeds: [
        embed({
          title: 'Ton ticket est ouvert',
          description:
            `Salut **${interaction.user.displayName}**.\n` +
            "Decris ton probleme ici, un membre du staff te repondra bientot.",
        }),
      ],
      components: [closeButton()],
    });

    await interaction.editReply({ embeds: [ok(`Ticket cree : <#${channel.id}>`)] });
    await logAction(guild, 'ticket', interaction.user, null, { action_detail: 'Ouverture', salon: channel.name });
  } catch (e) {
    await interaction.editReply({
      embeds: [ko(`Ticket impossible : ${e.message}\nVerifie mes permissions de creation de salon.`)],
    });
  }
}

export async function closeTicket(interaction) {
  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: true });

  const row = await store.getTicketByChannel(guild.id, interaction.channelId);
  if (!row) {
    return interaction.editReply({ embeds: [ko("Ce salon n'est pas un ticket ouvert.")] });
  }

  await store.closeTicket(guild.id, interaction.channelId, interaction.user.id);
  await logAction(guild, 'ticket', interaction.user, null, {
    action_detail: 'Fermeture',
    salon: interaction.channel.name,
  });

  await interaction.channel.send({ embeds: [ok('Ticket clos par le staff. Suppression du salon dans 10s.')] });
  await interaction.editReply({ embeds: [ok('Ticket clos.')] });
  setTimeout(() => interaction.channel.delete().catch(() => {}), 10_000);
}
