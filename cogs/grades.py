"""Grades du gang : hierarchie + panel d'administration.

Pas de reaction roles. C'est l'admin qui pilote tout via le panel :
creer, renommer, reordonner, assigner, supprimer.
"""

from __future__ import annotations

import discord
from discord import app_commands as ac
from discord.ext import commands

import db
from cogs.audit import Audit
from utils import helpers

# Grades par defaut au premier lancement
DEFAULT_RANKS = [
    ("Boss", 100, "#E8B54D"),
    ("Lieutenant", 80, "#C0C0C0"),
    ("Soldat", 60, "#8B8B8B"),
    ("Recrue", 20, "#6B7280"),
    ("Prospect", 0, "#4B5563"),
]


def hex_to_discord(hex_color: str) -> discord.Colour:
    try:
        return discord.Colour(int(hex_color.lstrip("#"), 16))
    except (ValueError, AttributeError):
        return discord.Colour(0x9CA3AF)


async def apply_rank(guild: discord.Guild, member: discord.Member,
                     rank: dict) -> bool:
    """Applique le role Discord du grade. Retire les anciens roles gang."""
    if not rank:
        return False

    new_role_id = rank.get("discord_role_id")
    if not new_role_id:
        return False

    gang_role_ids = {
        r["discord_role_id"] for r in db.get_ranks(guild.id)
        if r.get("discord_role_id")
    }

    try:
        for role in member.roles:
            if role.id in gang_role_ids and role.id != new_role_id:
                await member.remove_roles(role, reason="Changement de grade")
        new_role = guild.get_role(new_role_id)
        if new_role and new_role not in member.roles:
            await member.add_roles(new_role, reason=f"Grade: {rank['name']}")
        return True
    except discord.Forbidden:
        return False


class GradeSelect(discord.ui.Select):
    """Selecteur de membre pour l'assignation de grade."""

    def __init__(self, ranks: list[dict], placeholder: str = "Choisir un membre..."):
        self.ranks = ranks
        options = [discord.SelectOption(label=r["name"],
                                        description=f"Position {r['position']}")
                   for r in ranks]
        super().__init__(placeholder=placeholder, options=options[:25],
                         min_values=1, max_values=1)

    async def callback(self, interaction: discord.Interaction):
        await RankPanelView.update_member_rank(interaction, self.values[0])


class RankPanelView(discord.ui.View):
    """Panel principal de gestion des grades."""

    def __init__(self, bot: commands.Bot, author: discord.Member):
        super().__init__(timeout=180)
        self.bot = bot
        self.author = author
        self.message: discord.Message | None = None
        self.add_item(GradeSelect(self._ranks()))

    def _ranks(self) -> list[dict]:
        return db.get_ranks(self.author.guild.id)

    # --------------------------------------------------------- helpers

    @staticmethod
    async def update_member_rank(interaction: discord.Interaction, rank_name: str) -> None:
        """Ouvre le selecteur de membres pour le grade choisi."""
        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        ranks = db.get_ranks(guild.id)
        rank = next((r for r in ranks if r["name"] == rank_name), None)
        if not rank:
            await interaction.followup.send(embed=helpers.ko("Grade introuvable."))
            return

        members = [m for m in guild.members
                   if not m.bot and m.top_role < guild.me.top_role][:25]
        if not members:
            await interaction.followup.send(embed=helpers.ko("Aucun membre assignable."))
            return

        options = [discord.SelectOption(
            label=m.display_name[:100], description=f"ID {m.id}") for m in members]
        select = MemberPicker(options, rank)

        view = discord.ui.View(timeout=120)
        view.add_item(select)
        await interaction.followup.send(
            f"Attribuer le grade **{rank['name']}** a quel membre ?",
            view=view, ephemeral=True,
        )

    def refresh(self) -> None:
        """Recharge le select avec les grades a jour."""
        self.remove_item(self.children[0])
        self.add_item(GradeSelect(self._ranks()))

    # --------------------------------------------------------- boutons

    @discord.ui.button(label="Creer un grade", style=discord.ButtonStyle.primary)
    async def btn_create(self, interaction: discord.Interaction,
                         button: discord.ui.Button):
        if interaction.user.id != self.author.id:
            await interaction.response.send_message(
                embed=helpers.ko("Seul l'auteur du panel peut l'utiliser."), ephemeral=True)
            return
        await interaction.response.send_message(
            "Reponds avec : `nom grade | position | couleur hex | @role optionnel`\n"
            "Exemple : `Capo | 70 | #FF6B6B | @Role Capo`",
            ephemeral=True,
        )
        self.message = await interaction.original_response()
        self.bot.dispatch("rank_create_requested", interaction)

    @discord.ui.button(label="Reordonner", style=discord.ButtonStyle.secondary)
    async def btn_reorder(self, interaction: discord.Interaction,
                          button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        ranks = db.get_ranks(interaction.guild.id)
        if not ranks:
            await interaction.followup.send(embed=helpers.ko("Aucun grade a reordonner."))
            return
        listing = "\n".join(
            f"`{r['position']:>3}` **{r['name']}** "
            f"{'<- ' + interaction.guild.get_role(r['discord_role_id']).mention if r.get('discord_role_id') and interaction.guild.get_role(r['discord_role_id']) else ''}"
            for r in ranks
        )
        await interaction.followup.send(
            f"**Grades actuels :**\n{listing}\n\n"
            "Pour changer une position : `/grade position nom:Brabo valeur:50`",
            ephemeral=True,
        )

    @discord.ui.button(label="Supprimer", style=discord.ButtonStyle.danger)
    async def btn_delete(self, interaction: discord.Interaction,
                         button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        ranks = db.get_ranks(interaction.guild.id)
        if not ranks:
            await interaction.followup.send(embed=helpers.ko("Aucun grade."))
            return
        select = DeleteRankSelect(ranks)
        view = discord.ui.View(timeout=120)
        view.add_item(select)
        await interaction.followup.send("Quel grade supprimer ?", view=view,
                                        ephemeral=True)

    @discord.ui.button(label="Fermer", style=discord.ButtonStyle.grey)
    async def btn_close(self, interaction: discord.Interaction,
                        button: discord.ui.Button):
        await interaction.response.edit_message(view=None)
        await interaction.followup.send(embed=helpers.info("Panel fermee."), ephemeral=True)
        self.stop()


class MemberPicker(discord.ui.Select):
    """Choix du membre qui recoit le grade."""

    def __init__(self, options: list[discord.SelectOption], rank: dict):
        self.rank = rank
        super().__init__(placeholder="Membre a promoter...", options=options[:25])

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        member = interaction.guild.get_member(int(self.values[0].description.split()[1]))
        if not member:
            await interaction.followup.send(embed=helpers.ko("Membre introuvable."))
            return

        ok = await apply_rank(interaction.guild, member, self.rank)
        db.upsert_member(interaction.guild.id, member.id,
                         rank_id=self.rank["id"], username=str(member))
        audit: Audit = interaction.client.get_cog("Audit")
        if audit:
            await audit.log(interaction.guild, "promote", interaction.user, member,
                            grade=self.rank["name"], applied=ok)

        await interaction.followup.send(embed=helpers.ok(
            f"**{member.mention}** est now **{self.rank['name']}**."
            + ("" if ok else "\n*(Role Discord non applique — verifie mes perms.)*")
        ))
        self.view.stop()


class DeleteRankSelect(discord.ui.Select):
    """Choix du grade a supprimer."""

    def __init__(self, ranks: list[dict]):
        options = [discord.SelectOption(label=r["name"],
                                        description=f"Position {r['position']}")
                   for r in ranks]
        super().__init__(placeholder="Grade a supprimer...", options=options[:25])

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        rank = next(r for r in db.get_ranks(interaction.guild.id)
                    if r["name"] == self.values[0])
        db.delete_rank(rank["id"])
        audit: Audit = interaction.client.get_cog("Audit")
        if audit:
            await audit.log(interaction.guild, "grade", interaction.user,
                            action_detail=f"Suppression du grade {rank['name']}")
        await interaction.followup.send(embed=helpers.ok(
            f"Grade **{rank['name']}** supprime."
        ))
        self.view.stop()


class Grades(commands.Cog):
    """Commandes de gestion des grades."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.audit: Audit = bot.get_cog("Audit")

    # ------------------------------------------------------------- panel

    @ac.command(
        name="panel", description="Ouvre le panel de gestion des grades"
    )
    @helpers.is_admin()
    async def panel(self, ctx: discord.Interaction):
        ranks = db.get_ranks(ctx.guild.id)
        if not ranks:
            await ctx.send(embed=helpers.ko(
                "Aucun grade configure. Lance `/init` pour creer la hierarchie de base."
            ))
            return

        lines = "\n".join(
            f"`{r['position']:>3}` **{r['name']}** "
            f"{ctx.guild.get_role(r['discord_role_id']).mention if r.get('discord_role_id') and ctx.guild.get_role(r['discord_role_id']) else '*(pas de role)*'}"
            for r in ranks
        )
        view = RankPanelView(self.bot, ctx.author)
        msg = await ctx.send(
            embed=helpers.embed(
                "Panel des grades — Hoovers",
                f"{lines}\n\n**Action :** choisis un grade en dessous pour "
                "l'assigner a un membre.",
                color=helpers.COLOR_MAIN,
                footer="Seul toi peux utiliser ce panel",
            ),
            view=view,
            ephemeral=True,
        )
        view.message = msg

    # ------------------------------------------------------------ grades

    @ac.command(name="grade", description="Cree ou modifie un grade")
    @helpers.is_admin()
    @ac.describe(
        action="Operation a executer sur le grade",
        nom="Nom du grade",
        valeur="Position (0-100) ou couleur (#RRGGBB) selon l'action",
        role="Role Discord a associer au grade",
    )
    @ac.choices(action=[
        ac.Choice(name="creer", value="creer"),
        ac.Choice(name="position", value="position"),
        ac.Choice(name="couleur", value="couleur"),
        ac.Choice(name="supprimer", value="supprimer"),
    ])
    async def grade(
        self,
        ctx: discord.Interaction,
        action: str,
        nom: str,
        valeur: str | None = None,
        role: discord.Role | None = None,
    ) -> None:
        ranks = db.get_ranks(ctx.guild.id)
        existing = next((r for r in ranks if r["name"].lower() == nom.lower()), None)

        if action == "creer":
            if existing:
                await ctx.send(embed=helpers.ko(f"Le grade **{nom}** existe deja."))
                return
            position = 50
            color = "#9CA3AF"
            if valeur:
                if valeur.startswith("#"):
                    color = valeur
                elif valeur.isdigit():
                    position = int(valeur)
            row = db.create_rank(ctx.guild.id, nom, position, color,
                                role.id if role else None)
            await ctx.send(embed=helpers.ok(
                f"Grade **{row['name']}** cree (position {row['position']})."
                + (f"\nRole : {role.mention}" if role else "")
            ))
            await self.audit.log(ctx.guild, "grade", ctx.author,
                                name=nom, action_detail="creation",
                                position=position)

        elif action == "position":
            if not existing:
                await ctx.send(embed=helpers.ko(f"Grade **{nom}** introuvable."))
                return
            if not valeur or not valeur.isdigit():
                await ctx.send(embed=helpers.ko("Valeur invalide. Donne un nombre."))
                return
            db.update_rank(existing["id"], position=int(valeur))
            await ctx.send(embed=helpers.ok(
                f"**{nom}** est maintenant a la position {valeur}."
            ))
            await self.audit.log(ctx.guild, "grade", ctx.author,
                                name=nom, action_detail="position",
                                position=valeur)

        elif action == "couleur":
            if not existing:
                await ctx.send(embed=helpers.ko(f"Grade **{nom}** introuvable."))
                return
            db.update_rank(existing["id"], color=valeur or "#9CA3AF")
            await ctx.send(embed=helpers.ok(f"Couleur de **{nom}** mise a jour."))
            await self.audit.log(ctx.guild, "grade", ctx.author,
                                name=nom, action_detail="couleur", color=valeur)

        elif action == "supprimer":
            if not existing:
                await ctx.send(embed=helpers.ko(f"Grade **{nom}** introuvable."))
                return
            db.delete_rank(existing["id"])
            await ctx.send(embed=helpers.ok(f"Grade **{nom}** supprime."))
            await self.audit.log(ctx.guild, "grade", ctx.author,
                                name=nom, action_detail="suppression")

    # --------------------------------------------------------- assignation

    @ac.command(name="promote", description="Attribue un grade a un membre")
    @helpers.is_staff()
    @ac.describe(grade="Nom exact du grade")
    async def promote(
        self,
        ctx: discord.Interaction,
        membre: discord.Member,
        grade: str,
    ) -> None:
        rank = next((r for r in db.get_ranks(ctx.guild.id)
                     if r["name"].lower() == grade.lower()), None)
        if not rank:
            await ctx.send(embed=helpers.ko(f"Grade **{grade}** introuvable."))
            return

        applied = await apply_rank(ctx.guild, membre, rank)
        db.upsert_member(ctx.guild.id, membre.id, rank_id=rank["id"],
                         username=str(membre))
        await ctx.send(embed=helpers.ok(
            f"**{membre.mention}** est now **{rank['name']}**."
            + ("" if applied else "\n*(Role Discord non applique.)*")
        ))
        await self.audit.log(ctx.guild, "promote", ctx.author, membre,
                             grade=rank["name"], applied=applied)

    @ac.command(name="demote", description="Retire le grade d'un membre")
    @helpers.is_staff()
    async def demote(self, ctx: discord.Interaction, membre: discord.Member):
        gang_role_ids = {r["discord_role_id"] for r in db.get_ranks(ctx.guild.id)
                         if r.get("discord_role_id")}
        removed = 0
        for role in membre.roles:
            if role.id in gang_role_ids:
                try:
                    await membre.remove_roles(role, reason=f"Retrait de grade")
                    removed += 1
                except discord.Forbidden:
                    pass
        db.upsert_member(ctx.guild.id, membre.id, rank_id=None)
        await ctx.send(embed=helpers.ok(
            f"Grade retire de **{membre.mention}** ({removed} role(s))."
        ))
        await self.audit.log(ctx.guild, "demote", ctx.author, membre,
                             roles_removed=removed)

    # ------------------------------------------------------------ listing

    @ac.command(name="grades", description="Affiche la hierarchie")
    async def grades_list(self, ctx: discord.Interaction):
        ranks = db.get_ranks(ctx.guild.id)
        if not ranks:
            await ctx.send(embed=helpers.ko("Aucun grade configure."))
            return

        lines = []
        for i, r in enumerate(ranks, 1):
            role = ctx.guild.get_role(r["discord_role_id"]) if r.get("discord_role_id") else None
            badge = role.mention if role else "—"
            bar = "▬" * max(1, int(r["position"] / 10))
            lines.append(f"`{i}.` {bar} **{r['name']}**\n     {badge}")

        await ctx.send(embed=helpers.embed(
            "Hierarchie des grades", "\n".join(lines),
            color=helpers.COLOR_MAIN, footer="Du plus haut au plus bas"
        ))

    # --------------------------------------------------------------- init

    @ac.command(
        name="init", description="Cree la hierarchie de grades par defaut"
    )
    @helpers.is_admin()
    async def init(self, ctx: discord.Interaction):
        existing = db.get_ranks(ctx.guild.id)
        if existing:
            await ctx.send(embed=helpers.ko(
                f"Ya deja **{len(existing)}** grades. Supprime-les d'abord."
            ))
            return

        for name, position, color in DEFAULT_RANKS:
            role = discord.utils.get(ctx.guild.roles, name=name)
            if not role:
                try:
                    role = await ctx.guild.create_role(
                        name=name, colour=hex_to_discord(color),
                        reason=f"Initialisation Hoovers par {ctx.author}")
                except discord.Forbidden:
                    role = None
            db.create_rank(ctx.guild.id, name, position, color,
                           role.id if role else None)

        await ctx.send(embed=helpers.ok(
            f"**{len(DEFAULT_RANKS)} grades crees** avec les roles Discord.\n"
            "Modifie-les avec `/panel` ou `/grade`."
        ))
        await self.audit.log(ctx.guild, "grade", ctx.author,
                             action_detail="initialisation de la hierarchie")


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Grades(bot))
