"""Tickets : canal prive par demandeur, fermable par le staff."""

from __future__ import annotations

import discord
from discord import app_commands as ac
from discord.ext import commands

import config
import db
from cogs.audit import Audit
from utils import helpers


class TicketPanel(discord.ui.View):
    """Bouton d'ouverture d'un ticket."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Ouvrir un ticket", style=discord.ButtonStyle.primary,
                       custom_id="ticket_open", emoji="🎫")
    async def open_ticket(self, interaction: discord.Interaction,
                          button: discord.ui.Button):
        cog: Tickets | None = interaction.client.get_cog("Tickets")
        if cog:
            await cog.create_ticket(interaction)


class CloseView(discord.ui.View):
    """Bouton de fermeture affiche dans le ticket."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Fermer le ticket", style=discord.ButtonStyle.danger,
                       custom_id="ticket_close", emoji="🔒")
    async def close(self, interaction: discord.Interaction,
                    button: discord.ui.Button):
        if not interaction.user.guild_permissions.manage_channels:
            await interaction.response.send_message(
                embed=helpers.ko("Reserve au staff."), ephemeral=True)
            return

        await interaction.response.defer()
        db.close_ticket(interaction.guild.id, interaction.channel.id,
                        interaction.user.id)

        audit: Audit = interaction.client.get_cog("Audit")
        if audit:
            await audit.log(interaction.guild, "ticket", interaction.user,
                            action_detail="Fermeture",
                            salon=str(interaction.channel.name))

        await interaction.followup.send(embed=helpers.ok(
            "Ticket clos par le staff. Suppression du salon dans 10s."
        ))
        await interaction.channel.delete(delay=10)


class Tickets(commands.Cog):
    """Systeme de tickets."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.audit: Audit = bot.get_cog("Audit")

    # ------------------------------------------------------------- setup

    @ac.command(
        name="setup-tickets", description="Envoie le panneau de tickets dans un salon"
    )
    @helpers.is_admin()
    @ac.describe(salon="Salon ou afficher le bouton d'ouverture de ticket")
    async def setup_tickets(
        self,
        ctx: discord.Interaction,
        salon: discord.TextChannel,
    ) -> None:
        await salon.send(
            embed=helpers.embed(
                "Tickets Hoovers",
                "Besoin d'aide ou tu as une question ? Ouvre un ticket.",
                color=helpers.COLOR_MAIN,
            ),
            view=TicketPanel(),
        )
        await ctx.send(embed=helpers.ok(f"Panneau de tickets envoye dans {salon.mention}."))
        await self.audit.log(ctx.guild, "ticket", ctx.author, action_detail="Setup")

    # ------------------------------------------------------- creation

    async def create_ticket(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        # Un seul ticket ouvert a la fois par personne
        existing = (db.get().table("tickets")
                    .select("*")
                    .eq("guild_id", interaction.guild.id)
                    .eq("user_id", interaction.user.id)
                    .eq("status", "open")
                    .execute())
        if existing.data:
            channel = interaction.guild.get_channel(existing.data[0]["channel_id"])
            await interaction.followup.send(embed=helpers.info(
                f"Tu as deja un ticket ouvert : {channel.mention if channel else 'introuvable'}"
            ), ephemeral=True)
            return

        category = (interaction.guild.get_channel(config.TICKETS_CATEGORY)
                    if config.TICKETS_CATEGORY else None)
        if not category or not hasattr(category, "create_text_channel"):
            category = interaction.guild.default_channel

        # Permissions : l'equipe herite, le demandeur aussi
        overwrites = {
            interaction.guild.default_role: discord.PermissionOverwrite(
                view_channel=False),
            interaction.guild.me: discord.PermissionOverwrite(
                view_channel=True, send_messages=True, manage_channels=True),
            interaction.user: discord.PermissionOverwrite(
                view_channel=True, send_messages=True),
        }
        for member in interaction.guild.members:
            if member.guild_permissions.manage_channels:
                overwrites[member] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True)

        try:
            channel = await category.create_text_channel(
                name=f"ticket-{interaction.user.display_name}"[:100],
                overwrites=overwrites,
                reason=f"Ticket de {interaction.user}",
            )
        except discord.Forbidden:
            await interaction.followup.send(embed=helpers.ko(
                "J'ai pas les permissions de creer un salon. Verifie la categorie "
                "**TICKETS_CATEGORY_ID** dans le .env."
            ), ephemeral=True)
            return

        db.create_ticket(interaction.guild.id, interaction.user.id, channel.id,
                         category.id, "Ticket")

        await channel.send(
            embed=helpers.embed(
                "Ton ticket est ouvert",
                f"Salut **{interaction.user.display_name}**.\n"
                "Decris ton probleme ici, un membre du staff te repondra bientot.",
                color=helpers.COLOR_MAIN,
            ),
            view=CloseView(),
        )
        await interaction.followup.send(embed=helpers.ok(
            f"Ticket cree : {channel.mention}"
        ), ephemeral=True)
        await self.audit.log(interaction.guild, "ticket", interaction.user,
                             action_detail="Ouverture", salon=channel.name)

    # --------------------------------------------------------- historique

    @ac.command(
        name="tickets", description="Historique des tickets"
    )
    @helpers.is_staff()
    async def list_tickets(
        self,
        ctx: discord.Interaction,
        user: discord.User | None = None,
    ) -> None:
        query = (db.get().table("tickets").select("*")
                 .eq("guild_id", ctx.guild.id))
        if user:
            query = query.eq("user_id", user.id)
        rows = query.order("created_at", desc=True).limit(20).execute().data or []

        if not rows:
            await ctx.send(embed=helpers.info("Aucun ticket trouve."))
            return

        from datetime import datetime
        lines = []
        for r in rows:
            member = ctx.guild.get_member(r["user_id"])
            who = member.display_name if member else str(r["user_id"])
            when = datetime.fromisoformat(r["created_at"]).strftime("%d/%m %H:%M")
            status = "🟢" if r["status"] == "open" else "🔴"
            lines.append(f"{status} `{when}` — **{who}**")

        await ctx.send(embed=helpers.embed(
            f"Tickets{f' — {user.display_name}' if user else ''} ({len(rows)})",
            "\n".join(lines), color=helpers.COLOR_NEUTRAL
        ))


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Tickets(bot))
    # Vue persistante, sinon le bouton "Ouvrir un ticket" meurt au reboot
    bot.add_view(TicketPanel())
