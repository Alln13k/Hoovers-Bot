// Enregistre les commandes slash sur le serveur sans lancer le bot.
// Usage: npm run deploy

import { REST, Routes } from 'discord.js';
import { config, validate } from './config.js';
import * as audit from './commands/audit.js';
import * as moderation from './commands/moderation.js';
import * as grades from './commands/grades.js';
import * as members from './commands/members.js';
import * as recruitment from './commands/recruitment.js';
import * as tickets from './commands/tickets.js';

const problems = validate();
if (problems.length) {
  console.error('Configuration incomplete :\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

const body = [
  ...audit.commands,
  ...moderation.commands,
  ...grades.commands,
  ...members.commands,
  ...recruitment.commands,
  ...tickets.commands,
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);

try {
  console.log(`Enregistrement de ${body.length} commandes sur le serveur ${config.guildId}...`);
  const data = await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  console.log(`OK — ${data.length} commandes enregistrees :`);
  for (const c of data.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  /${c.name}`);
  }
} catch (e) {
  console.error('Echec :', e.message);
  process.exit(1);
}
