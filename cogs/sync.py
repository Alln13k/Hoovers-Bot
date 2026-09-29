"""Synchronisation manuelle des commandes slash."""

import discord
from discord import app_commands as ac
from discord.ext import commands

import config
from utils import helpers


def is_owner() -> type:
    """Reserve a l'identite du proprietaire du bot (OWNER_IDS)."""
    return ac.check(lambda i: i.user.id in config.BOT_OWNER_IDS)


class Sync(commands.Cog):
    """Commandes de synchronisation."""

    @ac.command(
        name="sync", description="Force la resynchronisation des commandes"
    )
    @is_owner()
    @ac.describe(guilde="Resync uniquement ce serveur (instantane)")
    async def sync(
        self,
        ctx: discord.Interaction,
        guilde: bool = True,
    ) -> None:
        if guilde and ctx.guild:
            synced = await ctx.bot.tree.sync(guild=ctx.guild)
            await ctx.send(embed=helpers.ok(
                f"**{len(synced)}** commandes synchronisees sur **{ctx.guild.name}**."
            ))
        else:
            synced = await ctx.bot.tree.sync()
            await ctx.send(embed=helpers.ok(
                f"**{len(synced)}** commandes synchronisees globalement.\n"
                "*Discord peut mettre jusqu'a 1h a propager.*"
            ))

    @ac.command(
        name="commandes", description="Liste les commandes du bot"
    )
    async def list_commands(self, ctx: discord.Interaction) -> None:
        guild = ctx.guild
        lines = []
        for cmd in sorted(ctx.bot.tree.get_commands(), key=lambda c: c.name):
            members = [m for m in cmd.qualified_name.split() if m]
            lines.append(f"• `/{' '.join(members)}` — {cmd.description or '—'}")

        await ctx.send(embed=helpers.embed(
            f"Commandes disponibles ({len(lines)})",
            "\n".join(lines) or "Aucune commande enregistree.",
            color=helpers.COLOR_MAIN,
            footer=f"{len(ctx.bot.cogs)} modules charges"
            + (f" | {guild.name}" if guild else ""),
        ))


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Sync(bot))
