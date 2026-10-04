// Point d'entree du bot communautaire.
//
// Les commandes slash sont enregistrees par serveur au demarrage :
// instantane, et supprime reellement celles qui n'existent plus.
// Un sync global mettrait jusqu'a 1h a se propager, ce qui est inacceptable
// pour un bot destine a des centaines de serveurs.

import {
  Client,
  Collection,
  GatewayIntentBits,
  PermissionFlagsBits,
  Partials,
} from 'discord.js';
import { config, validate } from './config.js';
import * as store from './db.js';
import { ko } from './helpers.js';

import * as tickets from './features/tickets.js';
import * as welcome from './features/welcome.js';

const FEATURES = { tickets, welcome };

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

/**
 * Permissions reellement exigees pour executer une commande.
 * `setDefaultMemberPermissions` ne fait que masquer la commande dans l'UI :
 * ca n'empeche personne de l'invoquer. Ce controle est donc obligatoire.
 */
const REQUIRED_PERMISSIONS = {
  'setup-tickets': 'Administrator',
  tickets: 'ManageChannels',
  'setup-welcome': 'Administrator',
  'setup-logs': 'Administrator',
  config: 'ManageGuild',
};

function loadCommands() {
  client.commands.clear();
  for (const mod of Object.values(FEATURES)) {
    for (const builder of mod.commands) {
      client.commands.set(builder.name, builder);
    }
  }
  return client.commands;
}

/** Enregistre les commandes sur chaque serveur. Instantané. */
async function registerCommands() {
  const body = [...client.commands.values()].map((c) => c.toJSON());
  const guilds = client.guilds.cache;

  // Un seul appel REST pour tout le monde
  await client.applicationCommands.bulkPut(client.commands);

  console.log(`[sync] ${body.length} commandes x ${guilds.size} serveur(s)`);
}

// ------------------------------------------------------------- evenements

client.once('ready', async () => {
  console.log(`[ready] ${client.user.tag} sur ${client.guilds.cache.size} serveur(s)`);
  try {
    await registerCommands();
  } catch (e) {
    console.error('[sync] echec:', e.message);
  }
  client.user.setActivity('votre serveur', { type: 3 });

  // Enregistre les nouveaux serveurs pour le dashboard
  for (const guild of client.guilds.cache.values()) {
    store.upsertGuild(guild).catch((e) => console.error('[db] upsertGuild:', e.message));
  }

  // Rafraichit le nom/icone une fois par jour
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await store.touchGuild(guild.id);
    }
  }, 24 * 60 * 60_000);
});

client.on('guildCreate', async (guild) => {
  console.log(`[+] ${guild.name} (${guild.id})`);
  await store.upsertGuild(guild).catch((e) => console.error('[db] guildCreate:', e.message));
  try {
    await guild.commands.set([...client.commands.values()].map((c) => c.toJSON()));
  } catch (e) {
    console.error('[sync] guildCreate:', e.message);
  }
});

client.on('guildDelete', (guild) => {
  console.log(`[-] ${guild.name} (${guild.id})`);
  store.deleteGuild(guild.id).catch((e) => console.error('[db] guildDelete:', e.message));
});

client.on('guildMemberAdd', (member) => {
  welcome.onMemberJoin(member).catch((e) => console.error('[join]', e.message));
});

client.on('guildMemberRemove', (member) => {
  welcome.onMemberLeave(member).catch((e) => console.error('[leave]', e.message));
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const need = REQUIRED_PERMISSIONS[interaction.commandName];
      if (need && !interaction.memberPermissions?.has(need)) {
        return await interaction.reply({
          embeds: [ko("Tu n'as pas la permission necessaire.")],
          ephemeral: true,
        });
      }
      const mod = Object.values(FEATURES).find((m) =>
        m.commands.some((c) => c.name === interaction.commandName),
      );
      if (!mod) return interaction.reply({ embeds: [ko('Commande inconnue.')], ephemeral: true });
      return await mod.handle(interaction);
    }

    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (e) {
    console.error(`[interaction] ${e.stack ?? e.message}`);
    const payload = { embeds: [ko(`Erreur interne : ${e.message}`)], ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

async function handleButton(interaction) {
  const [namespace, action, arg] = interaction.customId.split(':');

  if (namespace === 'ticket' && action === 'open') {
    const config = await store.getConfig(interaction.guildId);
    if (!config.tickets_enabled) {
      return interaction.reply({ embeds: [ko("Les tickets ne sont pas actives sur ce serveur.")], ephemeral: true });
    }
    return interaction.showModal(tickets.ticketModal(config.tickets_count));
  }

  if (namespace === 'ticket' && action === 'close') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ embeds: [ko('Reserve au staff.')], ephemeral: true });
    }
    return tickets.closeTicket(interaction, arg);
  }

  return interaction.reply({ embeds: [ko('Bouton inconnu.')], ephemeral: true });
}

async function handleModal(interaction) {
  const [namespace, action] = interaction.customId.split(':');
  if (namespace === 'ticket' && action === 'form') {
    const answers = {};
    for (const field of interaction.fields.components.map((r) => r.data)) {
      answers[field.custom_id] = interaction.fields.getTextInput(field.custom_id);
    }
    return tickets.createTicket(interaction, answers);
  }
  return interaction.reply({ embeds: [ko('Formulaire inconnu.')], ephemeral: true });
}

client.on('error', (e) => console.error('[discord]', e));
client.on('shardError', (e) => console.error('[shard]', e.message));

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
