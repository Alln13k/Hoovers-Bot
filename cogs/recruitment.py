"""Recrutement : bouton Postuler, formulaire modal, panel de validation."""

from __future__ import annotations

import discord
from discord import app_commands as ac
from discord.ext import commands

import db
from cogs.audit import Audit
from utils import helpers

QUESTIONS = [
    ("pseudo", "Quel est ton pseudo en jeu ?", 32),
    ("age", "Ton age ?", 3),
    ("dispo", "Tes disponibilites (jours/heures) ?", 100),
    ("experience", "Ton experience RP / autres gangs ?", 500),
    ("motivation", "Pourquoi Hoovers ?", 500),
]


class ApplicationModal(discord.ui.Modal, title="Recrutement Hoovers"):
    """Formulaire de candidature."""

    def __init__(self):
        super().__init__(timeout=600)
        for name, label, maxlen in QUESTIONS:
            self.add_item(discord.ui.TextInput(
                label=label, custom_id=name, max_length=maxlen,
                placeholder="Ta reponse...",
                style=discord.TextStyle.paragraph if maxlen > 100
                else discord.TextStyle.short,
            ))

    async def submit(self, interaction: discord.Interaction):
        # Anti-doublon
        cog: Recruitment | None = interaction.client.get_cog("Recruitment")
        if cog and await cog.has_pending(interaction.guild.id, interaction.user.id):
            await interaction.response.send_message(
                embed=helpers.ko("Tu as deja une candidature **en attente**."),
                ephemeral=True)
            return

        answers = {item.custom_id: str(item.value) for item in self.children}
        row = db.create_application(interaction.guild.id, interaction.user.id, answers)

        await interaction.response.send_message(
            embed=helpers.ok("Candidature envoyee. Un membre du staff te repond bientot.",
                             thumbnail=interaction.user.display_avatar.url),
            ephemeral=True,
        )

        if cog:
            await cog.post_panel(interaction, row)


class ApplyButtonView(discord.ui.View):
    """Bouton Postuler.

    Doit etre enregistre via bot.add_view() pour survivre aux redemarrages.
    """

    def __init__(self, guild_id: int | None = None):
        super().__init__(timeout=None)
        self.guild_id = guild_id

    @discord.ui.button(
        label="Postuler", style=discord.ButtonStyle.primary,
        custom_id="apply_button", emoji="📋",
    )
    async def apply(self, interaction: discord.Interaction,
                    button: discord.ui.Button):
        await interaction.response.send_modal(ApplicationModal())


class ReviewView(discord.ui.View):
    """Boutons accepter / refuser sur la candidature."""

    def __init__(self, app_id: str, guild_id: int, user_id: int,
                 applicant: discord.Member | None):
        super().__init__(timeout=None)  # persistant
        self.app_id = app_id
        self.guild_id = guild_id
        self.user_id = user_id
        self.applicant = applicant

    async def _resolve(self, interaction: discord.Interaction) -> None:
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message(
                embed=helpers.ko("Reserve aux administrateurs."), ephemeral=True)
            return

        audit: Audit = interaction.client.get_cog("Audit")

    @discord.ui.button(label="Accepter", style=discord.ButtonStyle.success)
    async def accept(self, interaction: discord.Interaction,
                     button: discord.ui.Button):
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message(
                embed=helpers.ko("Reserve aux administrateurs."), ephemeral=True)
            return

        await interaction.response.defer()
        db.set_application_status(self.app_id, "accepted", interaction.user.id)

        member = interaction.guild.get_member(self.user_id)
        if member:
            try:
                await member.send(embed=helpers.ok(
                    "**Ta candidature aux Hoovers a ete acceptee.**\n"
                    "Un membre du staff te contactera pour la suite."
                ))
            except discord.Forbidden:
                pass

        await interaction.edit_original_response(
            embed=helpers.ok(
                f"Candidature de **{member or self.user_id}** acceptee."
            ), view=None)
        audit: Audit = interaction.client.get_cog("Audit")
        if audit:
            await audit.log(interaction.guild, "recruit", interaction.user,
                            member, action_detail="Candidature acceptee")

    @discord.ui.button(label="Refuser", style=discord.ButtonStyle.danger)
    async def refuse(self, interaction: discord.Interaction,
                     button: discord.ui.Button):
        if not interaction.user.guild_permissions.administrator:
            await interaction.response.send_message(
                embed=helpers.ko("Reserve aux administrateurs."), ephemeral=True)
            return

        modal = RejectModal(self.app_id, self.user_id)
        await interaction.response.send_modal(modal)

    @discord.ui.button(label="Profil", style=discord.ButtonStyle.secondary)
    async def profile(self, interaction: discord.Interaction,
                      button: discord.ui.Button):
        row = db.get_application(self.app_id)
        if not row:
            await interaction.response.send_message(
                embed=helpers.ko("Candidature introuvable."), ephemeral=True)
            return
        answers = "\n".join(f"**{k} :** {v}" for k, v in row["answers"].items())
        await interaction.response.send_message(
            embed=helpers.info(answers), ephemeral=True)


class RejectModal(discord.ui.Modal, title="Refus de candidature"):
    """Saisie du motif de refus."""

    def __init__(self, app_id: str, user_id: int):
        super().__init__(timeout=300)
        self.app_id = app_id
        self.user_id = user_id
        self.add_item(discord.ui.TextInput(
            label="Motif du refus", custom_id="reason",
            placeholder="Ex: pas assez d'experience RP...",
            max_length=500, style=discord.TextStyle.paragraph,
        ))

    async def submit(self, interaction: discord.Interaction):
        reason = str(self.children[0].value)
        db.set_application_status(self.app_id, "rejected", interaction.user.id, reason)

        member = interaction.guild.get_member(self.user_id)
        if member:
            try:
                await member.send(embed=helpers.ko(
                    "**Ta candidature aux Hoovers a ete refusee.**\n"
                    f"**Motif :** {reason}"
                ))
            except discord.Forbidden:
                pass

        await interaction.response.edit_original_response(
            embed=helpers.ko(f"Candidature refusee.\n**Motif :** {reason}"),
            view=None)

        audit: Audit = interaction.client.get_cog("Audit")
        if audit:
            await audit.log(interaction.guild, "recruit", interaction.user,
                            member, action_detail="Candidature refusee", motif=reason)


class Recruitment(commands.Cog):
    """Cog de recrutement."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.audit: Audit = bot.get_cog("Audit")
        self.recruit_channel: int | None = None
        # Recharge la config a chaque reconnexion
        self.bot.add_listener(self._load_settings, "on_connect")
        self._load_settings_sync()

    def _load_settings_sync(self) -> None:
        """Relecture des salons configures, en sécurité au démarrage."""
        import config
        if not config.GUILD_ID:
            return
        try:
            settings = db.get_settings(config.GUILD_ID)
            self.recruit_channel = settings.get("recruit_channel_id")
        except Exception:
            pass  # la base peut etre vide au tout premier lancement

    async def _load_settings(self) -> None:
        self._load_settings_sync()
        if self.recruit_channel:
            self.bot.log.info(
                "Salon de recrutement restaure : %s", self.recruit_channel
            )

    @staticmethod
    async def has_pending(guild_id: int, user_id: int) -> bool:
        """Le demandeur a-t-il deja une candidature en attente ?"""
        import config
        from supabase import create_client
        client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
        res = (client.table("applications")
               .select("id")
               .eq("guild_id", guild_id)
               .eq("user_id", user_id)
               .eq("status", "pending")
               .execute())
        return bool(res.data)

    # --------------------------------------------------------- config

    @ac.command(
        name="setup-recrutement", description="Definit le salon de recrutement"
    )
    @helpers.is_admin()
    @ac.describe(salon="Salon ou le bouton Postuler apparaitra")
    async def setup_recrutement(
        self,
        ctx: discord.Interaction,
        salon: discord.TextChannel,
    ) -> None:
        self.recruit_channel = salon.id
        db.set_setting(ctx.guild.id, recruit_channel_id=salon.id)
        await ctx.send(embed=helpers.ok(
            f"Recrutement configure dans {salon.mention}.\n"
            "Reste a moi d'envoyer le bouton, ci-dessous."
        ))
        await self.post_button(ctx.guild, salon)
        await self.audit.log(ctx.guild, "recruit", ctx.author,
                             salon=str(salon))

    @ac.command(
        name="postuler-bouton",
        description="Renvoie le bouton Postuler dans le salon configure",
    )
    @helpers.is_admin()
    async def postuler_bouton(self, ctx: discord.Interaction):
        channel = (ctx.guild.get_channel(self.recruit_channel)
                   if self.recruit_channel else None)
        if not channel:
            await ctx.send(embed=helpers.ko(
                "Aucun salon configure. Lance `/setup-recrutement` d'abord."
            ))
            return
        await self.post_button(ctx.guild, channel)
        await ctx.send(embed=helpers.ok(f"Bouton renvoye dans {channel.mention}."))

    async def post_button(self, guild: discord.Guild, channel: discord.TextChannel):
        await channel.send(
            embed=helpers.embed(
                "Recrutement ouvert",
                "Tu veux rejoindre les **Hoovers** ?\n\n"
                "Clique sur le bouton ci-dessous pour envoyer ta candidature. "
                "Un membre du staff la traitera sous peu.",
                color=helpers.COLOR_MAIN,
            ),
            view=ApplyButtonView(guild.id),
        )

    async def post_panel(self, interaction: discord.Interaction, row: dict):
        """Envoie la candidature dans le salon de validation."""
        guild = interaction.guild
        channel = self.recruit_channel and guild.get_channel(self.recruit_channel)
        if not channel:
            return

        applicant = guild.get_member(row["user_id"])
        answers = "\n".join(f"**{k} :** {v}" for k, v in row["answers"].items())
        view = ReviewView(row["id"], guild.id, row["user_id"], applicant)

        await channel.send(
            embed=helpers.embed(
                "Nouvelle candidature",
                f"**{applicant or row['user_id']}** a postule.\n\n{answers}",
                color=helpers.COLOR_MAIN,
                thumbnail=applicant.display_avatar.url if applicant else None,
            ),
            view=view,
        )

    # ------------------------------------------------------------ liste

    @ac.command(
        name="candidatures", description="Liste des candidatures en attente"
    )
    @helpers.is_staff()
    async def candidatures(self, ctx: discord.Interaction):
        rows = db.pending_applications(ctx.guild.id)
        if not rows:
            await ctx.send(embed=helpers.info("Aucune candidature en attente."))
            return

        lines = []
        for r in rows:
            member = ctx.guild.get_member(r["user_id"])
            who = member.mention if member else f"`{r['user_id']}`"
            lines.append(f"`{r['id'][:8]}` {who} — {r['answers'].get('pseudo', '?')}")

        await ctx.send(embed=helpers.embed(
            f"Candidatures en attente ({len(rows)})",
            "\n".join(lines), color=helpers.COLOR_NEUTRAL
        ))


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Recruitment(bot))
    # Enregistre la vue persistante, sinon le bouton "Postuler" meurt au reboot
    bot.add_view(ApplyButtonView())
