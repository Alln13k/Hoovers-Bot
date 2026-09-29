"""Configuration centrale du bot, lue depuis le fichier .env."""

import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str) -> int | None:
    """Lit un ID Discord depuis le .env. Vide = None."""
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else None


DISCORD_TOKEN: str = os.getenv("DISCORD_TOKEN", "")
CLIENT_ID: int | None = _int("CLIENT_ID")
GUILD_ID: int | None = _int("GUILD_ID")

BOT_OWNER_IDS: list[int] = [
    int(x) for x in os.getenv("OWNER_IDS", "").split(",") if x.strip()
]

SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")

# Salons de log
LOG_SANCTIONS: int | None = _int("LOG_SANCTIONS_CHANNEL_ID")
LOG_AUDIT: int | None = _int("LOG_AUDIT_CHANNEL_ID")
LOG_TICKETS: int | None = _int("LOG_TICKETS_CHANNEL_ID")

TICKETS_CATEGORY: int | None = _int("TICKETS_CATEGORY_ID")

PING_TIMEOUT: float = 60.0


def validate() -> list[str]:
    """Retourne la liste des variables manquantes ou invalides."""
    problems: list[str] = []
    if not DISCORD_TOKEN:
        problems.append("DISCORD_TOKEN est vide")
    if not SUPABASE_URL:
        problems.append("SUPABASE_URL est vide")
    if not SUPABASE_KEY:
        problems.append("SUPABASE_KEY est vide")
    return problems
