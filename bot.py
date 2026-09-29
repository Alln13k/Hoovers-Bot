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

if not config.DISCORD_TOKEN:
    sys.exit("DISCORD_TOKEN manquant dans le .env")

if not config.SUPABASE_URL or not config.SUPABASE_KEY:
    sys.exit("SUPABASE_URL / SUPABASE_KEY manquants dans le .env")

intents = discord.Intents.default()
intents.members = True      # necessaire pour /roster et le panel
intents.message_content = True

bot = commands.Bot(
    command_prefix=commands.when_mentioned,  # le bot ne repond qu'aux @mentions
    intents=intents,
    help_command=None,
)


@bot.event
async def on_ready() -> None:
    log.info("Connecte en tant que %s (%d guilds)",
             bot.user, len(bot.guilds))
    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.watching, name="les Hoovers 👀")
    )


async def main() -> None:
    async with bot:
        # Audit en premier : les autres cogs dependent de son cog
        await add_cog(__import__("cogs.audit", fromlist=["Audit"]).Audit(bot))
        for name in ("moderation", "grades", "members", "recruitment", "tickets"):
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
