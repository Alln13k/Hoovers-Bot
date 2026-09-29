"""Journal d'audit : tout ce que le bot fait est trace."""

import discord
from discord import app_commands as ac
from discord.ext import commands

import config
import db
from utils import helpers

# Emojis par type d'action
EMOJIS = {
    "sanction": "🚨",
    "unsanction": "✅",
    "promote": "⬆️",
    "demote": "⬇️",
    "grade": "🎖️",
    "member": "🗂️",
    "recruit": "📋",
    "ticket": "🎫",
}


class Audit(commands.Cog):
    """Ecriture et consultation du journal."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def log(
        self,
        guild: discord.Guild,
        action: str,
        actor: discord.Member | discord.User,
        target: discord.Member | discord.User | None = None,
        **details: object,
    ) -> None:
        """Enregistre l'action en base ET l'affiche dans le salon de log."""
        target_id = target.id if target else None
        db.log_action(guild.id, actor.id, action, target_id, **details)

        channel = guild.get_channel(config.LOG_AUDIT) if config.LOG_AUDIT else None
        if not channel:
            return

        lines = []
        if target:
            lines.append(f"**Cible :** {target.mention} (`{target.id}`)")
        for key, value in details.items():
            lines.append(f"**{key.replace('_', ' ').capitalize()} :** {value}")

        await channel.send(
            embed=helpers.embed(
                f"{EMOJIS.get(action, '📌')} {action.upper().replace('_', ' ')}",
                "\n".join(lines) or "Aucun detail.",
                color=helpers.COLOR_NEUTRAL,
                footer=f"Par {actor}",
            )
        )

    @ac.command(name="log", description="Consulte le journal d'audit")
    @helpers.is_staff()
    @ac.describe(limit="Nombre d'entrees a afficher")
    async def log_command(
        self,
        ctx: discord.Interaction,
        limit: ac.Range[int, 1, 50] = 10,
    ) -> None:
        rows = db.recent_audit(ctx.guild.id, limit)
        if not rows:
            await ctx.send(embed=helpers.info("Le journal est vide."))
            return

        from datetime import datetime, timezone

        lines = []
        for row in rows:
            when = datetime.fromisoformat(row["created_at"]).strftime("%d/%m %H:%M")
            actor = ctx.guild.get_member(row["actor_id"]) or ctx.guild.get_role(
                row["actor_id"]
            )
            who = actor.mention if actor else f"`{row['actor_id']}`"
            lines.append(f"`{when}` {EMOJIS.get(row['action'], '📌')} "
                         f"**{row['action']}** par {who}")

        await ctx.send(embed=helpers.embed(
            "Journal d'audit", "\n".join(lines) or "Vide", footer=f"{limit} entrees"
        ))


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Audit(bot))
