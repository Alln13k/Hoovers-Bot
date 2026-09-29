// Point d'entree du bot Hoovers.
//
// Les commandes slash sont enregistrees PAR SERVEUR (guild) au demarrage :
// c'est immediat et supprime reellement celles qui n'existent plus.
// Le sync global peut mettre jusqu'a 1h a se propager.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Collection,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import { config, validate } from './config.js';
import * as store from './db.js';
import { logAction } from './audit.js';
import { embed, ko, ok, info, isAdmin, isOwner } from './helpers.js';

import * as audit from './commands/audit.js';
import * as moderation from './commands/moderation.js';
import * as grades from './commands/grades.js';
import * as members from './commands/members.js';
import * as recruitment from './commands/recruitment.js';
import * as tickets from './commands/tickets.js';

const MODULES = { audit, moderation, grades, members, recruitment, tickets };

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

client.commands = new Collection();

/** Charge les SlashCommandBuilder de tous les modules. */
function loadCommands() {
  client.commands.clear();
  for (const [name, mod] of Object.entries(MODULES)) {
    for (const builder of mod.commands) {
      client.commands.set(builder.name, builder);
    }
  }
  return client.commands;
}

/** Enregistre les commandes sur le serveur. Instantané. */
async function registerCommands() {
  const guild = client.guilds.cache.get(config.guildId);
  const body = [...client.commands.values()].map((c) => c.toJSON());
  const target = guild ? guild.id : client.user?.id;

  if (!target) {
    console.error('[sync] ni serveur ni application, sync impossible');
    return;
  }

  try {
    if (guild) {
      await client.applicationCommands.set(target, body);
      console.log(`[sync] ${body.length} commandes enregistrees sur '${guild.name}'`);
    } else {
      await client.applicationCommands.set(target, body, { guildId: config.guildId });
      console.log(`[sync] ${body.length} commandes enregistrees (global)`);
    }
  } catch (e) {
    console.error('[sync] echec :', e.message);
  }
}

client.once('ready', async () => {
  console.log(`[ready] ${client.user.tag} sur ${client.guilds.cache.size} serveur(s)`);
  await registerCommands();
  client.user.setActivity('les Hoovers 👀', { type: 3 });

  // Nettoyage des sanctions de mute expirees toutes les 5 min
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const n = await moderation.sweepExpiredMutes(guild);
        if (n) console.log(`[mute] ${n} sanction(s) expiree(s) close(s) sur ${guild.name}`);
      } catch (e) {
        console.error('[mute] sweep impossible:', e.message);
      }
    }
  }, 5 * 60_000);
});

client.on('error', (e) => console.error('[discord]', e));
client.loginError = (e) => console.error('[login]', e.message);

// ---------------------------------------------------------- interactions

// Permissions reellement exigees pour executer chaque commande.
// `setDefaultMemberPermissions` ne fait que masquer la commande dans l'UI :
// ca n'empeche personne de l'invoquer. Ce controle est donc obligatoire.
const REQUIRED_PERMISSIONS = {
  log: 'ManageRoles',
  warn: 'ManageRoles',
  mute: 'ModerateMembers',
  kick: 'KickMembers',
  ban: 'BanMembers',
  unwarn: 'ManageRoles',
  unmute: 'ModerateMembers',
  sanctions: 'ManageRoles',
  panel: 'Administrator',
  grade: 'Administrator',
  init: 'Administrator',
  promote: 'ManageRoles',
  demote: 'ManageRoles',
  ajouter: 'ManageRoles',
  'setup-recrutement': 'Administrator',
  'postuler-bouton': 'Administrator',
  candidatures: 'ManageRoles',
  'setup-tickets': 'Administrator',
  tickets: 'ManageRoles',
};

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const need = REQUIRED_PERMISSIONS[interaction.commandName];
      if (need && !interaction.memberPermissions?.has(need)) {
        return await interaction.reply({
          embeds: [ko("Tu n'as pas la permission necessaire pour cette commande.")],
          ephemeral: true,
        });
      }
      const mod = Object.values(MODULES).find((m) =>
        m.commands.some((c) => c.name === interaction.commandName),
      );
      if (!mod) return interaction.reply({ embeds: [ko('Commande inconnue.')], ephemeral: true });
      return await mod.handle(interaction);
    }

    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isStringSelectMenu()) return await handleSelect(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (e) {
    console.error(`[interaction] ${e.stack ?? e.message}`);
    const payload = {
      embeds: [ko(`Erreur interne : ${e.message}`)],
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

async function handleButton(interaction) {
  const [namespace, action, arg] = interaction.customId.split(':');

  if (namespace === 'recruit' && action === 'apply') {
    return interaction.showModal(recruitment.applicationModal());
  }

  if (namespace === 'ticket' && action === 'open') {
    return tickets.createTicket(interaction);
  }

  if (namespace === 'ticket' && action === 'close') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ embeds: [ko('Reserve au staff.')], ephemeral: true });
    }
    return tickets.closeTicket(interaction);
  }

  if (namespace === 'review') {
    return handleReview(interaction, action, arg);
  }

  if (namespace === 'panel' && action === 'delete') {
    return interaction.reply({ embeds: [info('Supprime un grade avec `/grade action:supprimer`.')], ephemeral: true });
  }

  return interaction.reply({ embeds: [ko('Bouton inconnu.')], ephemeral: true });
}

async function handleReview(interaction, action, appId) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ embeds: [ko('Reserve aux administrateurs.')], ephemeral: true });
  }
  const guild = interaction.guild;
  const row = await store.getApplication(appId);
  if (!row) {
    return interaction.reply({ embeds: [ko('Candidature introuvable.')], ephemeral: true });
  }
  const applicant = guild.members.cache.get(row.user_id);

  if (action === 'accept') {
    await interaction.deferReply({ ephemeral: true });
    await store.setApplicationStatus(appId, 'accepted', interaction.user.id);
    if (applicant) {
      await applicant
        .user.send({
          embeds: [ok('**Ta candidature aux Hoovers a ete acceptee.**\nUn membre du staff te contactera.')],
        })
        .catch(() => {});
    }
    await interaction.editReply({ embeds: [ok(`Candidature de ${applicant ?? row.user_id} acceptee.`)], components: [] });
    await logAction(guild, 'recruit', interaction.user, applicant, { action_detail: 'Candidature acceptee' });
    return;
  }

  if (action === 'reject') {
    pendingRejects.set(interaction.user.id, appId);
    return interaction.showModal(recruitment.rejectModal());
  }

  if (action === 'profile') {
    const answers = Object.entries(row.answers ?? {})
      .map(([k, v]) => `**${k} :** ${v}`)
      .join('\n');
    return interaction.reply({ embeds: [info(answers)], ephemeral: true });
  }
}

const pendingRejects = new Map();

async function handleSelect(interaction) {
  const [namespace, action] = interaction.customId.split(':');

  if (namespace === 'panel' && action === 'assign') {
    const guild = interaction.guild;
    const rankId = interaction.values[0];
    const ranks = await store.getRanks(guild.id);
    const rank = ranks.find((r) => r.id === rankId);
    if (!rank) {
      return interaction.reply({ embeds: [ko('Grade introuvable.')], ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const candidates = [...guild.members.cache.values()]
      .filter((m) => !m.user.bot && m.id !== client.user.id)
      .slice(0, 25);
    if (!candidates.length) {
      return interaction.editReply({ embeds: [ko('Aucun membre assignable.')] });
    }

    return interaction.editReply({
      content: `Attribuer le grade **${rank.name}** a quel membre ?`,
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`assign:${rankId}`)
            .setPlaceholder('Membre a promoter...')
            .addOptions(
              candidates.map((m) => ({
                label: m.displayName.slice(0, 100),
                description: `ID ${m.id}`,
                value: m.id,
              })),
            ),
        ),
      ],
    });
  }

  if (namespace === 'assign') {
    const rankId = interaction.customId.split(':')[1];
    const member = interaction.guild.members.cache.get(interaction.values[0]);
    if (!member) {
      return interaction.reply({ embeds: [ko('Membre introuvable.')], ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const ranks = await store.getRanks(interaction.guild.id);
    const rank = ranks.find((r) => r.id === rankId);
    const applied = rank ? await grades.applyRank(interaction.guild, member, rank) : false;
    if (rank) {
      await store.upsertMember(interaction.guild.id, member.id, {
        rank_id: rank.id,
        username: member.user.username,
      });
    }
    await interaction.editReply({
      content: null,
      embeds: [
        ok(
          `**${member}** est now **${rank?.name ?? '?'}**.` +
            (applied || !rank ? '' : '\n*(Role Discord non applique.)*'),
        ),
      ],
      components: [],
    });
    await logAction(interaction.guild, 'promote', interaction.user, member, {
      grade: rank?.name ?? '?',
      applied,
    });
  }
}

async function handleModal(interaction) {
  const [namespace, action] = interaction.customId.split(':');

  if (namespace === 'recruit' && action === 'form') {
    const guild = interaction.guild;
    const { data: pending } = await store.db()
      .from('applications')
      .select('id')
      .eq('guild_id', guild.id)
      .eq('user_id', interaction.user.id)
      .eq('status', 'pending');
    if (pending?.length) {
      return interaction.reply({
        embeds: [ko('Tu as deja une candidature **en attente**.')],
        ephemeral: true,
      });
    }

    const answers = {};
    for (const field of interaction.fields.components.map((r) => r.data)) {
      answers[field.custom_id] = interaction.fields.getTextInput(field.custom_id);
    }
    await interaction.reply({
      embeds: [ok('Candidature envoyee. Un membre du staff te repond bientot.', {
        thumbnail: interaction.user.displayAvatarURL(),
      })],
      ephemeral: true,
    });

    const row = await store.createApplication(guild.id, interaction.user.id, answers);
    const settings = await store.getSettings(guild.id);
    const channel = settings.recruit_channel_id
      ? guild.channels.cache.get(settings.recruit_channel_id)
      : null;
    if (channel) {
      const lines = Object.entries(answers)
        .map(([k, v]) => `**${k} :** ${v}`)
        .join('\n');
      await channel.send({
        embeds: [
          embed({
            title: 'Nouvelle candidature',
            description: `**${interaction.user}** a postule.\n\n${lines}`,
            thumbnail: interaction.user.displayAvatarURL(),
          }),
        ],
        components: [recruitment.reviewRow(row.id)],
      });
    }
    return;
  }

  if (namespace === 'recruit' && action === 'reject') {
    const appId = pendingRejects.get(interaction.user.id);
    if (!appId) {
      return interaction.reply({ embeds: [ko('Session de refus expiree, ressaisis le bouton.')], ephemeral: true });
    }
    pendingRejects.delete(interaction.user.id);
    const reason = interaction.fields.getTextInput('reason');
    await interaction.deferReply({ ephemeral: true });
    await store.setApplicationStatus(appId, 'rejected', interaction.user.id, reason);

    const row = await store.getApplication(appId);
    const applicant = interaction.guild.members.cache.get(row?.user_id);
    if (applicant) {
      await applicant
        .user.send({
          embeds: [ko(`**Ta candidature a ete refusee.**\n**Motif :** ${reason}`)],
        })
        .catch(() => {});
    }
    await interaction.editReply({ embeds: [ko(`Candidature refusee.\n**Motif :** ${reason}`)] });
    await logAction(interaction.guild, 'recruit', interaction.user, applicant, {
      action_detail: 'Candidature refusee',
      motif: reason,
    });
  }
}

// ------------------------------------------------------------------ boot

const problems = validate();
if (problems.length) {
  console.error('Configuration incomplete :\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

loadCommands();
console.log(`[boot] ${client.commands.size} commandes chargees`);

client.login(config.token).catch((e) => {
  console.error('[login] impossible :', e.message);
  process.exit(1);
});
