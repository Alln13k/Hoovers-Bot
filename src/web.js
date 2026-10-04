// Point d'entree du dashboard web (processus distinct du bot).
//
// Lancement : npm run web
// Au demarrage, synchronise la liste des serveurs ou le bot est present,
// pour que le dashboard affiche les bons noms et icones.

import { REST, Routes } from 'discord.js';
import { config, validate } from './config.js';
import * as store from './db.js';
import { startDashboard } from './web/server.js';

const problems = validate();
if (problems.length) {
  console.error('Configuration incomplete :\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

/** Recupere les serveurs du bot depuis l'API Discord. */
async function syncGuilds() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const guilds = await rest.get(Routes.userGuilds(config.clientId));

  for (const g of guilds) {
    await store.upsertGuild({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      iconHash: g.icon,
    });
  }
  console.log(`[sync] ${guilds.length} serveur(s) synchronise(s)`);
  return guilds.length;
}

async function main() {
  try {
    await syncGuilds();
    // Resync toutes les 6h : un serveur peut etre renomme
    setInterval(() => syncGuilds().catch((e) => console.error('[sync]', e.message)), 6 * 60 * 60_000);
  } catch (e) {
    // Le dashboard peut tourner meme si Discord est momentanement injoignable
    console.error('[sync] echec, le dashboard demarre quand meme :', e.message);
  }

  startDashboard();
}

main();
