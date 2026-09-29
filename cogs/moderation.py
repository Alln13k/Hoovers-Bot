"""Sanctions : warn, mute, kick, ban + retrait de sanction."""

from __future__ import annotations

import asyncio

import discord
from discord import app_commands as ac
from discord.ext import commands, tasks

import config
import db
from cogs.audit import Audit
from utils import helpers

SANCTION_LABELS = {
    "warn": "Warn",
    "mute": "Mute",
    "kick": "Kick",
    "ban": "Ban",
}

SANCTION_COLORS = {
    "warn": 0xF1C40F,
    "mute": 0x9B59B6,
    "kick": 0xE67E22,
    "ban": 0xC0392B,
}


async def unmute_member(guild: discord.Guild, user_id: int) -> None:
    """Retire le role Muted, quelle que soit sa forme."""
    member = guild.get_member(user_id)
    if not member:
        return
    for role in member.roles:
        if role.name.lower() in ("muted", "mute"):
            try:
                await member.remove_roles(role, reason="Fin de sanction")
            except discord.Forbidden:
                pass


class Moderation(commands.Cog):
    """Commandes de sanction."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.audit: Audit = bot.get_cog("Audit")

    async def cog_load(self) -> None:
        """Demarre la tache d'auto-unmute une fois le cog charge."""
        self._watch_expired.start()

    def cog_unload(self) -> None:
        self._watch_expired.cancel()

    # ------------------------------------------------------------- warn

    @ac.command(name="warn", description="Donne un warn a un membre")
    @helpers.is_staff()
    @ac.describe(raison="Motif du warn", duree="Duree de l'infraction (ex: 7j)")
    async def warn(
        self,
        ctx: discord.Interaction,
        member: discord.Member,
        raison: str,
        duree: str | None = None,
    ) -> None:
        minutes = helpers.parse_duration(duree) if duree else None
        if duree and minutes is None:
            await ctx.send(embed=helpers.ko(
                "Duree invalide. Formats acceptes : `30m`, `2h`, `7j`, `perm`."
            ))
            return

        row = db.add_sanction(
            ctx.guild.id, member.id, ctx.user.id, "warn", raison, minutes
        )
        total = db.count_sanctions(ctx.guild.id, member.id, "warn")

        await ctx.send(embed=helpers.embed(
            "Warn donne",
            f"**{member.mention}** a recu un warn.\n"
            f"**Raison :** {raison}\n"
            f"**Total warns :** {total}",
            color=SANCTION_COLORS["warn"],
        ))
        await self.audit.log(ctx.guild, "sanction", ctx.user, member,
                             type="warn", reason=raison, total=total)
        self._dm(ctx.guild, member, "Warn", raison, total)

    # ------------------------------------------------------------- mute

    @ac.command(name="mute", description="Coupe les ecritures d'un membre")
    @helpers.is_staff()
    @ac.describe(raison="Motif du mute", duree="Duree: 30m, 2h, 7j ou perm")
    async def mute(
        self,
        ctx: discord.Interaction,
        member: discord.Member,
        raison: str,
        duree: str = "2h",
    ) -> None:
        minutes = helpers.parse_duration(duree)
        if minutes is None and duree not in ("perm", "inf"):
            await ctx.send(embed=helpers.ko(
                "Duree invalide. Formats acceptes : `30m`, `2h`, `7j`, `perm`."
            ))
            return

        role = discord.utils.get(ctx.guild.roles, name="Muted")
        if not role:
            await ctx.send(embed=helpers.ko(
                "Role `Muted` introuvable. Cree-le sur le serveur d'abord."
            ))
            return

        try:
            await member.add_roles(role, reason=f"Mute par {ctx.user}")
        except discord.Forbidden:
            await ctx.send(embed=helpers.ko(
                "J'ai pas les permissions pour muter ce membre."
            ))
            return

        await db.add_sanction(ctx.guild.id, member.id, ctx.user.id, "mute", raison,
                              minutes)
        label = "definitif" if minutes is None else helpers.fmt_duration(minutes)

        await ctx.send(embed=helpers.embed(
            "Mute applique",
            f"**{member.mention}** est mute ({label}).\n**Raison :** {raison}",
            color=SANCTION_COLORS["mute"],
        ))
        await self.audit.log(ctx.guild, "sanction", ctx.user, member,
                             type="mute", reason=raison, duration=label)
        self._dm(ctx.guild, member, "Mute", raison, label)

    # ------------------------------------------------------------- kick

    @ac.command(name="kick", description="Expulse un membre du serveur")
    @helpers.is_staff()
    @ac.describe(raison="Motif du kick")
    async def kick(
        self,
        ctx: discord.Interaction,
        member: discord.Member,
        raison: str,
    ) -> None:
        await db.add_sanction(ctx.guild.id, member.id, ctx.user.id, "kick", raison, None)
        try:
            await member.send(
                f"Tu as ete **expulse** du serveur Hoovers.\n**Raison :** {raison}"
            )
        except discord.Forbidden:
            pass

        try:
            await member.kick(reason=f"{ctx.user}: {raison}")
        except discord.Forbidden:
            await ctx.send(embed=helpers.ko("J'ai pas les permissions pour le kick."))
            return

        await ctx.send(embed=helpers.embed(
            "Kick applique",
            f"**{member.display_name}** a ete expulse.\n**Raison :** {raison}",
            color=SANCTION_COLORS["kick"],
        ))
        await self.audit.log(ctx.guild, "sanction", ctx.user, member,
                             type="kick", reason=raison)

    # -------------------------------------------------------------- ban

    @ac.command(name="ban", description="Bannit un membre du serveur")
    @helpers.is_staff()
    @ac.describe(raison="Motif du ban", duree="Duree: 7j ou perm")
    async def ban(
        self,
        ctx: discord.Interaction,
        user: discord.User,
        raison: str,
        duree: str = "perm",
    ) -> None:
        minutes = helpers.parse_duration(duree)
        if minutes is None and duree not in ("perm", "inf"):
            await ctx.send(embed=helpers.ko(
                "Duree invalide. Formats acceptes : `7j`, `perm`."
            ))
            return

        await db.add_sanction(ctx.guild.id, user.id, ctx.user.id, "ban", raison, minutes)

        # Duree de suppression des messages : 0 si ban permanent
        delete_days = 0 if minutes is None else min(7, max(1, minutes // 1440))
        try:
            await user.send(
                f"Tu as ete **banni** du serveur Hoovers.\n**Raison :** {raison}"
            )
        except discord.Forbidden:
            pass

        try:
            await ctx.guild.ban(user, reason=f"{ctx.user}: {raison}",
                                delete_message_seconds=delete_days * 86400)
        except discord.Forbidden:
            await ctx.send(embed=helpers.ko("J'ai pas les permissions pour le ban."))
            return

        await ctx.send(embed=helpers.embed(
            "Ban applique",
            f"**{user}** a ete banni.\n**Raison :** {raison}",
            color=SANCTION_COLORS["ban"],
        ))
        await self.audit.log(ctx.guild, "sanction", ctx.user, user,
                             type="ban", reason=raison, duration=duree)

    # ----------------------------------------------------- retirer sanction

    @ac.command(
        name="unwarn", description="Retire un warn (par ID ou tout l'historique)"
    )
    @helpers.is_staff()
    @ac.describe(sanction_id="ID court d'un warn a retirer (ex: a1b2c3d4)")
    async def unwarn(
        self,
        ctx: discord.Interaction,
        membre: discord.Member,
        sanction_id: str | None = None,
    ) -> None:
        rows = db.active_sanctions(ctx.guild.id, membre.id)
        warns = [r for r in rows if r["type"] == "warn"]
        if not warns:
            await ctx.send(embed=helpers.info(f"**{membre.mention}** n'a aucun warn actif."))
            return

        if sanction_id:
            row = next((r for r in warns if r["id"].startswith(sanction_id)), None)
            if not row:
                await ctx.send(embed=helpers.ko("Sanction introuvable pour ce membre."))
                return
            db.revoke_sanction(row["id"])
            count = 1
        else:
            for r in warns:
                db.revoke_sanction(r["id"])
            count = len(warns)

        await ctx.send(embed=helpers.ok(
            f"{count} warn(s) retire(s) pour **{membre.mention}**."
        ))
        await self.audit.log(ctx.guild, "unsanction", ctx.user, membre,
                             removed=count, type="warn")

    @ac.command(
        name="unmute", description="Retire le mute d'un membre avant l'echeance"
    )
    @helpers.is_staff()
    async def unmute(
        self,
        ctx: discord.Interaction,
        membre: discord.Member,
    ) -> None:
        await unmute_member(ctx.guild, membre.id)
        for row in db.active_sanctions(ctx.guild.id, membre.id):
            if row["type"] == "mute":
                db.revoke_sanction(row["id"])

        await ctx.send(embed=helpers.ok(f"**{membre.mention}** n'est plus mute."))
        await self.audit.log(ctx.guild, "unsanction", ctx.user, membre, type="mute")

    # ------------------------------------------------------ historique

    @ac.command(
        name="sanctions", description="Affiche l'historique de sanctions d'un membre"
    )
    @helpers.is_staff()
    async def sanctions_list(
        self,
        ctx: discord.Interaction,
        membre: discord.Member,
    ) -> None:
        rows = db.active_sanctions(ctx.guild.id, membre.id)
        if not rows:
            await ctx.send(embed=helpers.info(
                f"**{membre.mention}** n'a aucune sanction active."
            ))
            return

        counts = {}
        for r in rows:
            counts[r["type"]] = counts.get(r["type"], 0) + 1

        summary = "  |  ".join(
            f"{SANCTION_LABELS.get(k, k)}: **{v}**" for k, v in counts.items()
        )
        lines = []
        for r in rows[:10]:
            mod = ctx.guild.get_member(r["moderator_id"])
            who = mod.mention if mod else f"`{r['moderator_id']}`"
            lines.append(
                f"`{r['id'][:8]}` **{SANCTION_LABELS.get(r['type'], r['type'])}** "
                f"par {who} — {r['reason']}"
            )

        await ctx.send(embed=helpers.embed(
            f"Sanctions de {membre.display_name}",
            f"**Total :** {summary}\n\n" + "\n".join(lines),
            color=helpers.COLOR_MAIN,
            thumbnail=member.display_avatar.url,
        ))

    # ------------------------------------------------- auto-unmute expire

    @tasks.loop(minutes=2)
    async def _watch_expired(self) -> None:
        """Retire automatiquement les mutes expires."""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()

        for guild in self.bot.guilds:
            # Requete large : on recupere les mutes actifs et on filtre ici
            try:
                res = (db.get()
                       .table("sanctions")
                       .select("*")
                       .eq("guild_id", guild.id)
                       .eq("type", "mute")
                       .eq("active", True)
                       .lte("expires_at", now)
                       .execute())
            except Exception:
                continue

            for row in res.data or []:
                await unmute_member(guild, row["user_id"])
                db.revoke_sanction(row["id"])
                if config.LOG_SANCTIONS:
                    channel = guild.get_channel(config.LOG_SANCTIONS)
                    if channel:
                        user = guild.get_member(row["user_id"])
                        await channel.send(embed=helpers.ok(
                            f"Le mute de **{user or row['user_id']}** est termine."
                        ))

    @_watch_expired.before_loop
    async def _before_watch(self) -> None:
        try:
            await self.bot.wait_until_ready()
        except RuntimeError:
            # Client pas initialise (tests, arret en cours) : on ne boucle pas
            raise asyncio.CancelledError()

    # ------------------------------------------------------------ helpers

    def _dm(self, guild: discord.Guild, member: discord.Member, label: str,
            reason: str, extra: object) -> None:
        """Tente un DM, ignore silencieusement si les DM sont fermes."""

        async def send() -> None:
            try:
                await member.send(
                    f"**{label}** sur **{guild.name}**\n**Raison :** {reason}\n"
                    f"**Detail :** {extra}",
                    embed=helpers.embed(label, f"Raison : {reason}",
                                        SANCTION_COLORS.get(label.lower(), 0x99AABB)),
                )
            except discord.Forbidden:
                pass

        self.bot.loop.create_task(send())


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Moderation(bot))
