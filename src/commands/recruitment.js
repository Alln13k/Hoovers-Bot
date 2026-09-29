// Recrutement : bouton Postuler, formulaire modal, panel de validation.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as store from '../db.js';
import { logAction } from '../audit.js';
import { embed, info, ko, ok } from '../helpers.js';

export const QUESTIONS = [
  { id: 'pseudo', label: 'Quel est ton pseudo en jeu ?', max: 32, style: TextInputStyle.Short },
  { id: 'age', label: 'Ton age ?', max: 3, style: TextInputStyle.Short },
  { id: 'dispo', label: 'Tes disponibilites (jours/heures) ?', max: 100, style: TextInputStyle.Short },
  { id: 'experience', label: 'Ton experience RP / autres gangs ?', max: 500, style: TextInputStyle.Paragraph },
  { id: 'motivation', label: 'Pourquoi Hoovers ?', max: 500, style: TextInputStyle.Paragraph },
];

export const commands = [
  new SlashCommandBuilder()
    .setName('setup-recrutement')
    .setDescription('Definit le salon de recrutement')
    .addChannelOption((o) =>
      o.setName('salon').setDescription('Salon du bouton Postuler').setRequired(true).addChannelTypes(0),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('postuler-bouton')
    .setDescription('Renvoie le bouton Postuler dans le salon configure')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('candidatures')
    .setDescription('Liste des candidatures en attente')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
];

/** Le bouton d'ouverture du formulaire. */
export function applyButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('recruit:apply')
      .setLabel('Postuler')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📋'),
  );
}

/** Construit le modal du formulaire. */
export function applicationModal() {
  const modal = new ModalBuilder().setCustomId('recruit:form').setTitle('Recrutement Hoovers');
  for (const q of QUESTIONS) {
    modal.addComponents(
      new TextInputBuilder()
        .setCustomId(q.id)
        .setLabel(q.label)
        .setMaxLength(q.max)
        .setStyle(q.style)
        .setRequired(q.id !== 'age'),
    );
  }
  return modal;
}

export async function postApplyButton(channel) {
  await channel.send({
    embeds: [
      embed({
        title: 'Recrutement ouvert',
        description:
          'Tu veux rejoindre les **Hoovers** ?\n\n' +
          'Clique sur le bouton ci-dessous pour envoyer ta candidature. ' +
          'Un membre du staff la traitera sous peu.',
      }),
    ],
    components: [applyButton()],
  });
}

/** Panel de validation d'une candidature. */
export function reviewRow(appId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`review:accept:${appId}`).setLabel('Accepter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`review:reject:${appId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`review:profile:${appId}`).setLabel('Profil').setStyle(ButtonStyle.Secondary),
  );
}

export function rejectModal() {
  return new ModalBuilder()
    .setCustomId('recruit:reject')
    .setTitle('Refus de candidature')
    .addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Motif du refus')
        .setMaxLength(500)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true),
    );
}

export async function handle(interaction) {
  const { commandName } = interaction;
  const guild = interaction.guild;

  if (commandName === 'setup-recrutement') {
    const salon = interaction.options.getChannel('salon');
    await store.setSetting(guild.id, { recruit_channel_id: salon.id });
    await postApplyButton(salon);
    await interaction.reply({
      embeds: [ok(`Recrutement configure dans ${salon}. Bouton envoye.`)],
      ephemeral: true,
    });
    await logAction(guild, 'recruit', interaction.user, null, { salon: salon.name });
    return;
  }

  if (commandName === 'postuler-bouton') {
    const settings = await store.getSettings(guild.id);
    const channel = settings.recruit_channel_id
      ? guild.channels.cache.get(settings.recruit_channel_id)
      : null;
    if (!channel) {
      return interaction.reply({
        embeds: [ko('Aucun salon configure. Lance `/setup-recrutement` d\'abord.')],
        ephemeral: true,
      });
    }
    await postApplyButton(channel);
    await interaction.reply({ embeds: [ok(`Bouton renvoye dans ${channel}.`)], ephemeral: true });
    return;
  }

  if (commandName === 'candidatures') {
    const rows = await store.pendingApplications(guild.id);
    if (!rows.length) {
      return interaction.reply({ embeds: [info('Aucune candidature en attente.')] });
    }
    const lines = rows.map((r) => {
      const member = guild.members.cache.get(r.user_id);
      const who = member ? `<@${member.id}>` : `\`${r.user_id}\``;
      return `\`${r.id.slice(0, 8)}\` ${who} — ${r.answers?.pseudo ?? '?'}`;
    });
    return interaction.reply({
      embeds: [
        embed({
          title: `Candidatures en attente (${rows.length})`,
          description: lines.join('\n'),
          color: 0x3a3a3c,
        }),
      ],
      ephemeral: true,
    });
  }
}

export { StringSelectMenuBuilder };
