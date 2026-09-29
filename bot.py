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


async def sync_commands() -> None:
    """Pousse les commandes slash sur le serveur.

    Le sync est cible sur le guild : il est immediat et supprime vraiment
    les commandes qui n'existent plus dans le code. Un sync global peut
    mettre jusqu'a une heure a se propager.
    """
    local = bot.tree.get_commands()
    guild = bot.get_guild(config.GUILD_ID) if config.GUILD_ID else None

    log.info("Sync: %d commande(s) en local, %d cog(s) [%s]",
             len(local), len(bot.cogs), ", ".join(bot.cogs) or "aucun")
    log.info("Env: python %s / discord.py %s / guild %s",
             sys.version.split()[0], discord.__version__,
             guild.name if guild else "INTROUVABLE")

    if not local:
        log.error("Aucune commande enregistree, sync ignore")
        return

    try:
        if guild:
            synced = await bot.tree.sync(guild=guild)
            log.info("Commandes synchronisees sur '%s' : %d / %d",
                     guild.name, len(synced), len(local))
        else:
            synced = await bot.tree.sync()
            log.info("Commandes synchronisees globalement : %d / %d",
                     len(synced), len(local))
    except discord.HTTPException:
        log.exception("Echec de la synchronisation des commandes")


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
