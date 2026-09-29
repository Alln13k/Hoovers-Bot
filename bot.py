"""Point d'entree du bot Hoovers."""

import inspect
import logging
import sys

import discord
from discord.ext import commands

import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("hoovers")

if config.validate():
    sys.exit("Configuration incomplete :\n  - " + "\n  - ".join(config.validate()))

intents = discord.Intents.default()
intents.members = True      # necessaire pour /roster et le panel
intents.message_content = True

bot = commands.Bot(
    command_prefix=commands.when_mentioned,  # le bot ne repond qu'aux @mentions
    intents=intents,
    help_command=None,
)


async def sync_commands() -> list:
    """Pousse les commandes slash sur Discord.

    Sync GLOBAL et non par guild : les commandes declarees dans les cogs
    sont enregistrees comme globales. Sur cette version de discord.py le
    `tree.sync(guild=...)` ne lit que `tree._guild_commands[guild.id]`, donc
    il partirait avec un payload VIDE et `bulk_upsert_guild_commands` ecraserait
    toutes les commandes du serveur sans rien inscrire.

    Le desavantage du sync global est le temps de propagation (jusqu'a 1h
    selon Discord), mais c'est le seul qui inscrive reellement les commandes.
    """
    local = bot.tree.get_commands()
    log.info("Sync global : %d commande(s) en local, %d cog(s) [%s]",
             len(local), len(bot.cogs), ", ".join(bot.cogs) or "aucun")

    if not local:
        log.error("Aucune commande enregistree, sync ignore")
        return []

    try:
        synced = await bot.tree.sync()
    except discord.HTTPException:
        log.exception("Echec de la synchronisation des commandes")
        return []

    log.info("Commandes synchronisees : %d / %d (propagation jusqu'a 1h)",
             len(synced), len(local))
    return synced


@bot.event
async def on_ready() -> None:
    log.info("Connecte en tant que %s (%d guilds)",
             bot.user, len(bot.guilds))
    await sync_commands()
    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.watching, name="les Hoovers 👀")
    )


async def main() -> None:
    async with bot:
        # Audit en premier : les autres cogs dependent de son cog
        await add_cog(__import__("cogs.audit", fromlist=["Audit"]).Audit(bot))
        for name in ("moderation", "grades", "members", "recruitment",
                     "tickets", "sync"):
            module = __import__(f"cogs.{name}", fromlist=["setup"])
            await module.setup(bot)
        await bot.start(config.DISCORD_TOKEN)


async def add_cog(cog: object) -> None:
    """`add_cog` est une coroutine sur cette build, une fonction en amont.
    On gere les deux pour que le bot marche partout."""
    result = bot.add_cog(cog)
    if inspect.isawaitable(result):
        await result


if __name__ == "__main__":
    try:
        import asyncio
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Arret du bot.")
