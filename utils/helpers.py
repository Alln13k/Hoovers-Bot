"""Helpers d'embed et de permissions."""

from __future__ import annotations

import discord
from discord import app_commands as ac
from discord.ext import commands

# Couleurs du theme
COLOR_MAIN = 0xE8B54D      # or
COLOR_ERROR = 0xC0392B
COLOR_SUCCESS = 0x27AE60
COLOR_NEUTRAL = 0x3A3A3C


def embed(
    title: str,
    description: str = "",
    color: int = COLOR_MAIN,
    *,
    footer: str | None = None,
    thumbnail: str | None = None,
) -> discord.Embed:
    e = discord.Embed(
        title=title,
        description=description or discord.Embed.Empty,
        color=color,
    )
    e.set_thumbnail(url=thumbnail) if thumbnail else None
    if footer:
        e.set_footer(text=footer)
    return e


def ok(description: str, **kwargs) -> discord.Embed:
    return embed("Succes", description, COLOR_SUCCESS, **kwargs)


def ko(description: str, **kwargs) -> discord.Embed:
    return embed("Erreur", description, COLOR_ERROR, **kwargs)


def info(description: str, **kwargs) -> discord.Embed:
    return embed("Info", description, COLOR_NEUTRAL, **kwargs)


def success_button(label: str) -> discord.Button:
    return discord.ui.Button(
        style=discord.ButtonStyle.success, label=label, custom_id="ok"
    )


def is_staff() -> type:
    """Decorator : reserve aux membres ayant la permission Manage Roles.

    Utilise app_commands.check et NON commands.check : cette build de
    discord.py n'accroche pas les checks `commands` sur les app commands,
    ce qui laisserait la commande ouverte a tout le monde.
    """
    return ac.check(lambda i: bool(i.permissions.manage_roles))


def is_admin() -> type:
    """Decorator : reserve aux administrateurs du serveur."""
    return ac.check(lambda i: bool(i.permissions.administrator))


def fmt_duration(minutes: int) -> str:
    """Formate des minutes en texte lisible : 90 -> '1h30'."""
    if minutes is None:
        return "definitif"
    days, rem = divmod(minutes, 1440)
    hours, mins = divmod(rem, 60)
    parts = []
    if days:
        parts.append(f"{days}j")
    if hours:
        parts.append(f"{hours}h")
    if mins:
        parts.append(f"{mins}m")
    return "".join(parts) or "0m"


def parse_duration(text: str) -> int | None:
    """Parse une duree en minutes.

    Accepte '30m', '2h', '7j', '1j12h', '90' (= 90 minutes) et renvoie None
    pour 'perm', 'inf' ou toute saisie invalide.
    """
    text = text.strip().lower()
    if text in ("perm", "inf", "definitif", ""):
        return None

    # Nombre seul => minutes
    if text.isdigit():
        return int(text)

    units = {"m": 1, "h": 60, "j": 1440, "d": 1440, "w": 10080}
    total, current, seen = 0, "", False
    for ch in text:
        if ch.isdigit():
            current += ch
        elif ch in units and current:
            total += int(current) * units[ch]
            current = ""
            seen = True
        else:
            return None

    if not seen:
        return None
    # Chiffres restants en fin de chaine = minutes ('2h30' -> 150)
    if current:
        total += int(current)
    return total
