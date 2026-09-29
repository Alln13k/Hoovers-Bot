"""Fiches membres : profil, roster, ajout manuel."""

from __future__ import annotations

import discord
from discord import app_commands as ac
from discord.ext import commands

import db
from cogs.audit import Audit
from utils import helpers


def rank_name(ranks: list[dict], rank_id: str | None) -> str:
    if not rank_id:
        return "Sans grade"
    rank = next((r for r in ranks if r["id"] == rank_id), None)
    return rank["name"] if rank else "Grade supprime"


class Members(commands.Cog):
    """Gestion des fiches membres."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.audit: Audit = bot.get_cog("Audit")

    # ------------------------------------------------------------ profil

    @ac.command(
        name="fiche", description="Affiche la fiche d'un membre"
    )
    async def fiche(
        self,
        ctx: discord.Interaction,
        membre: discord.Member | None = None,
    ) -> None:
        member = membre or ctx.author
        ranks = db.get_ranks(ctx.guild.id)
        row = db.get_member(ctx.guild.id, member.id)

        if not row:
            await ctx.send(embed=helpers.info(
                f"**{member.display_name}** n'a pas encore de fiche.\n"
                "Un admin peut en creer une avec `/ajouter`.",
                thumbnail=member.display_avatar.url,
            ))
            return

        warn_count = db.count_sanctions(ctx.guild.id, member.id, "warn")
        active = db.active_sanctions(ctx.guild.id, member.id)

        from datetime import datetime
        joined = datetime.fromisoformat(row["joined_at"]).strftime("%d/%m/%Y")
        status_emoji = {
            "active": "🟢 Actif", "recrue": "🟡 Recrue",
            "inactif": "⚪ Inactif", "parti": "🔴 Parti",
        }.get(row["status"], row["status"])

        embed = helpers.embed(
            f"Fiche — {member.display_name}",
            f"**Grade :** {rank_name(ranks, row.get('rank_id'))}\n"
            f"**Statut :** {status_emoji}\n"
            f"**Membre depuis :** {joined}\n"
            f"**Warns :** {warn_count}\n"
            f"**Sanctions actives :** {len(active)}\n"
            f"**ID :** `{member.id}`",
            color=helpers.COLOR_MAIN,
            footer=f"Demandé par {ctx.author.display_name}",
            thumbnail=member.display_avatar.url,
        )
        if row.get("notes"):
            embed.add_field(name="Notes staff", value=row["notes"][:1024],
                            inline=False)
        await ctx.send(embed=embed)

    # ------------------------------------------------------- ajout manuel

    @ac.command(
        name="ajouter", description="Cree ou met a jour la fiche d'un membre"
    )
    @helpers.is_staff()
    @ac.describe(grade="Grade a attribuer", statut="Etat du membre",
                 notes="Notes internes visibles du staff")
    @ac.choices(statut=[
        ac.Choice(name="active", value="active"),
        ac.Choice(name="recrue", value="recrue"),
        ac.Choice(name="inactif", value="inactif"),
        ac.Choice(name="parti", value="parti"),
    ])
    async def ajouter(
        self,
        ctx: discord.Interaction,
        membre: discord.Member,
        grade: str | None = None,
        statut: str = "active",
        notes: str | None = None,
    ) -> None:
        ranks = db.get_ranks(ctx.guild.id)
        rank_id = None
        if grade:
            rank = next((r for r in ranks if r["name"].lower() == grade.lower()), None)
            if not rank:
                await ctx.send(embed=helpers.ko(f"Grade **{grade}** introuvable."))
                return
            rank_id = rank["id"]
            from cogs.grades import apply_rank
            await apply_rank(ctx.guild, membre, rank)

        db.upsert_member(ctx.guild.id, membre.id, rank_id=rank_id,
                         username=str(membre), status=statut, notes=notes)
        await ctx.send(embed=helpers.ok(
            f"Fiche de **{membre.mention}** enregistree."
        ))
        await self.audit.log(ctx.guild, "member", ctx.author, membre,
                             grade=grade or "inchange", status=statut)

    # ------------------------------------------------------------ roster

    @ac.command(
        name="roster", description="Liste tous les membres du gang"
    )
    async def roster(self, ctx: discord.Interaction):
        rows = db.list_members(ctx.guild.id)
        if not rows:
            await ctx.send(embed=helpers.info("Aucune fiche membre enregistree."))
            return

        ranks = db.get_ranks(ctx.guild.id)
        by_rank: dict[str, list[str]] = {}
        for r in rows:
            by_rank.setdefault(rank_name(ranks, r.get("rank_id")), []).append(
                r.get("username") or str(r["user_id"])
            )

        lines = []
        for grade in sorted(by_rank, key=lambda g: -(
            next((r["position"] for r in ranks if r["name"] == g), 0))):
            members = by_rank[grade]
            lines.append(f"**{grade}** ({len(members)})\n"
                         + "\n".join(f"  • {m}" for m in members[:25])
                         + (f"\n  _...et {len(members)-25} autres_"
                            if len(members) > 25 else ""))

        await ctx.send(embed=helpers.embed(
            f"Roster Hoovers — {len(rows)} membres",
            "\n\n".join(lines), color=helpers.COLOR_MAIN,
        ))

    # ------------------------------------------------------------ stats

    @ac.command(
        name="stats", description="Statistiques du gang"
    )
    async def stats(self, ctx: discord.Interaction):
        rows = db.list_members(ctx.guild.id)
        if not rows:
            await ctx.send(embed=helpers.info("Aucune donnee."))
            return

        active = sum(1 for r in rows if r["status"] == "active")
        total_warns = sum(db.count_sanctions(ctx.guild.id, r["user_id"], "warn")
                          for r in rows)
        inactifs = sum(1 for r in rows if r["status"] in ("inactif", "parti"))

        await ctx.send(embed=helpers.embed(
            "Statistiques Hoovers",
            f"**Membres enregistres :** {len(rows)}\n"
            f"**Actifs :** {active}\n"
            f"**Inactifs / partis :** {inactifs}\n"
            f"**Warns cumules :** {total_warns}\n"
            f"**Taux d'activite :** {active/len(rows)*100:.0f}%",
            color=helpers.COLOR_SUCCESS,
        ))


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Members(bot))
