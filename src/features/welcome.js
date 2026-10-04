// Bienvenue / depart / role automatique, configures depuis le site.

import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as store from '../db.js';
import { embed, ok, render, safeConfig } from '../helpers.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('setup-welcome')
    .setDescription('Configure les messages de bienvenue et de depart')
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Salon des messages')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    )
    .addBooleanOption((o) => o.setName('debut').setDescription('Message de bienvenue'))
    .addBooleanOption((o) => o.setName('depart').setDescription('Message de depart'))
    .addRoleOption((o) => o.setName('role_auto').setDescription('Role donne automatiquement'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setup-logs')
    .setDescription('Configure le salon de logs')
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Salon des logs')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Affiche la configuration actuelle')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

export async function handle(interaction) {
  const { commandName } = interaction;
  const guild = interaction.guild;

  if (commandName === 'setup-welcome') {
    const salon = interaction.options.getChannel('salon');
    const depart = interaction.options.getBoolean('depart');
    const roleAuto = interaction.options.getRole('role_auto');

    const patch = {
      welcome_channel: salon.id,
      welcome_message: interaction.options.getBoolean('debut')
        ? 'Bienvenue {user} sur **{server}** ! Tu es le membre numero **{count}**.'
        : null,
      leave_channel: depart ? salon.id : null,
      leave_message: depart ? '{username} vient de quitter **{server}**. Nous etions **{count}**.' : null,
      autorole_enabled: roleAuto ? true : null,
      autorole_id: roleAuto?.id ?? null,
    };
    // Ne pas ecraser un role deja configure si l'admin ne le precise pas
    if (!roleAuto) {
      delete patch.autorole_enabled;
      delete patch.autorole_id;
    }

    await store.saveConfig(guild.id, patch);
    return interaction.reply({
      embeds: [ok(`Configuration enregistree. Tu peux la modifier finement depuis le site.`)],
      ephemeral: true,
    });
  }

  if (commandName === 'setup-logs') {
    const salon = interaction.options.getChannel('salon');
    await store.saveConfig(guild.id, { log_channel: salon.id });
    return interaction.reply({
      embeds: [ok(`Logs actives dans ${salon}.`)],
      ephemeral: true,
    });
  }

  if (commandName === 'config') {
    const config = await safeConfig(guild.id);
    const line = (label, value) => `**${label} :** ${value ?? '—'}`;
    const count = guild.memberCount;
    return interaction.reply({
      embeds: [
        embed({
          title: `Configuration — ${guild.name}`,
          description: [
            line('Salon bienvenue', config.welcome_channel ? `<#${config.welcome_channel}>` : null),
            line('Message bienvenue', config.welcome_message ? `« ${config.welcome_message} »` : null),
            line('Salon depart', config.leave_channel ? `<#${config.leave_channel}>` : null),
            line('Role automatique', config.autorole_id ? `<@&${config.autorole_id}>` : null),
            line('Salon logs', config.log_channel ? `<#${config.log_channel}>` : null),
            line('Tickets', config.tickets_enabled ? `actifs (${config.tickets_count} question(s))` : 'desactives'),
            line('Anti-spam', config.automod_enabled ? 'actif' : 'inactif'),
            line('Membres', String(count)),
          ].join('\n'),
          color: 0x2b2d31,
        }),
      ],
      ephemeral: true,
    });
  }
}

/** Appele a l'arrivee d'un membre. */
export async function onMemberJoin(member) {
  const config = await safeConfig(member.guild.id);
  if (config.autorole_enabled && config.autorole_id) {
    const role = member.guild.roles.cache.get(config.autorole_id);
    if (role) {
      await member.roles.add(role, 'Role automatique').catch((e) =>
        console.error('[welcome] role auto:', e.message),
      );
    }
  }

  if (!config.welcome_channel || !config.welcome_message) return;
  const channel = member.guild.channels.cache.get(config.welcome_channel);
  if (!channel?.isTextBased()) return;

  await channel
    .send({
      embeds: [
        embed({
          description: render(config.welcome_message, {
            member,
            guild: member.guild,
            count: member.guild.memberCount,
          }),
        }),
      ],
      allowedMentions: { parse: ['users'] },
    })
    .catch((e) => console.error('[welcome] envoi:', e.message));
}

/** Appele au depart d'un membre. */
export async function onMemberLeave(member) {
  const config = await safeConfig(member.guild.id);
  if (!config.leave_channel || !config.leave_message) return;
  const channel = member.guild.channels.cache.get(config.leave_channel);
  if (!channel?.isTextBased()) return;

  await channel
    .send({
      embeds: [
        embed({
          description: render(config.leave_message, {
            member,
            guild: member.guild,
            count: member.guild.memberCount,
          }),
        }),
      ],
    })
    .catch((e) => console.error('[leave] envoi:', e.message));
}
