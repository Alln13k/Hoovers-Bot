// Journal d'audit : toute action est ecrite en base ET postee dans le salon de log.

import { EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import * as store from './db.js';
import { COLORS, embed } from './helpers.js';

const EMOJIS = {
  sanction: '🚨',
  unsanction: '✅',
  promote: '⬆️',
  demote: '⬇️',
  grade: '🎖️',
  member: '🗂️',
  recruit: '📋',
  ticket: '🎫',
};

/**
 * Enregistre l'action et la publie dans le salon de log.
 * N'echoue jamais le flux principal.
 */
export async function logAction(guild, action, actor, target, details = {}) {
  const targetId = target?.id ?? null;

  await store.logAction(
    guild.id,
    actor.id,
    action,
    targetId,
    details,
  );

  if (!config.logAudit) return;
  const channel = guild.channels.cache.get(config.logAudit);
  if (!channel?.isTextBased()) return;

  const lines = [];
  if (target) lines.push(`**Cible :** <@${target.id}> (\`${target.id}\`)`);
  for (const [key, value] of Object.entries(details)) {
    const label = key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    lines.push(`**${label} :** ${value}`);
  }

  await channel
    .send({
      embeds: [
        embed({
          title: `${EMOJIS[action] ?? '📌'} ${action.replace(/_/g, ' ').toUpperCase()}`,
          description: lines.join('\n') || 'Aucun detail.',
          color: COLORS.neutral,
          footer: { text: `Par ${actor.tag ?? actor.username}` },
        }),
      ],
    })
    .catch((e) => console.error('[audit] envoi log impossible:', e.message));
}
