"""Couche d'acces a Supabase.

Le bot utilise la cle `service_role` : elle contourne le RLS mis en place
dans supabase_schema.sql. Ne JAMAIS l'exposer dans un salon ou un bot public.
"""

import logging
from typing import Any

from supabase import Client, create_client

import config

log = logging.getLogger("hoovers.db")

_client: Client | None = None


def get() -> Client:
    """Retourne le client Supabase, en le creant au premier appel."""
    global _client
    if _client is None:
        if not config.SUPABASE_URL or not config.SUPABASE_KEY:
            raise RuntimeError(
                "SUPABASE_URL ou SUPABASE_KEY manquant dans le .env"
            )
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
    return _client


# ---------------------------------------------------------------- ranks

def get_ranks(guild_id: int) -> list[dict[str, Any]]:
    """Grades du gang, du plus bas au plus haut."""
    res = (
        get()
        .table("ranks")
        .select("*")
        .eq("guild_id", guild_id)
        .order("position", desc=True)
        .execute()
    )
    return res.data or []


def create_rank(guild_id: int, name: str, position: int, color: str,
                discord_role_id: int | None) -> dict[str, Any]:
    res = (
        get()
        .table("ranks")
        .insert({
            "guild_id": guild_id,
            "name": name,
            "position": position,
            "color": color,
            "discord_role_id": discord_role_id,
        })
        .execute()
    )
    return res.data[0]


def update_rank(rank_id: str, **fields: Any) -> dict[str, Any]:
    res = get().table("ranks").update(fields).eq("id", rank_id).execute()
    return res.data[0] if res.data else {}


def delete_rank(rank_id: str) -> None:
    get().table("ranks").delete().eq("id", rank_id).execute()


# -------------------------------------------------------------- members

def get_member(guild_id: int, user_id: int) -> dict[str, Any] | None:
    res = (
        get()
        .table("members")
        .select("*")
        .eq("guild_id", guild_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def upsert_member(guild_id: int, user_id: int, **fields: Any) -> dict[str, Any]:
    payload = {"guild_id": guild_id, "user_id": user_id, **fields}
    res = (
        get()
        .table("members")
        .upsert(payload, on_conflict="guild_id,user_id")
        .execute()
    )
    return res.data[0]


def list_members(guild_id: int) -> list[dict[str, Any]]:
    res = get().table("members").select("*").eq("guild_id", guild_id).execute()
    return res.data or []


# ------------------------------------------------------------ sanctions

def add_sanction(guild_id: int, user_id: int, moderator_id: int, type_: str,
                 reason: str, duration_minutes: int | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "guild_id": guild_id,
        "user_id": user_id,
        "moderator_id": moderator_id,
        "type": type_,
        "reason": reason,
    }
    if duration_minutes:
        payload["duration_minutes"] = duration_minutes

    from datetime import datetime, timedelta, timezone
    if duration_minutes:
        expires = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)
        payload["expires_at"] = expires.isoformat()

    res = get().table("sanctions").insert(payload).execute()
    return res.data[0]


def active_sanctions(guild_id: int, user_id: int) -> list[dict[str, Any]]:
    return (
        get()
        .table("sanctions")
        .select("*")
        .eq("guild_id", guild_id)
        .eq("user_id", user_id)
        .eq("active", True)
        .execute()
    ).data or []


def count_sanctions(guild_id: int, user_id: int, type_: str) -> int:
    rows = (
        get()
        .table("sanctions")
        .select("id")
        .eq("guild_id", guild_id)
        .eq("user_id", user_id)
        .eq("type", type_)
        .execute()
    )
    return len(rows.data or [])


def revoke_sanction(sanction_id: str) -> None:
    get().table("sanctions").update({"active": False}).eq("id", sanction_id).execute()


def get_sanction(sanction_id: str) -> dict[str, Any] | None:
    res = get().table("sanctions").select("*").eq("id", sanction_id).limit(1).execute()
    return res.data[0] if res.data else None


# -------------------------------------------------------- applications

def create_application(guild_id: int, user_id: int, answers: dict) -> dict[str, Any]:
    res = (
        get()
        .table("applications")
        .insert({"guild_id": guild_id, "user_id": user_id, "answers": answers})
        .execute()
    )
    return res.data[0]


def get_application(app_id: str) -> dict[str, Any] | None:
    res = get().table("applications").select("*").eq("id", app_id).limit(1).execute()
    return res.data[0] if res.data else None


def set_application_status(app_id: str, status: str, reviewed_by: int,
                            note: str | None = None) -> None:
    get().table("applications").update({
        "status": status,
        "reviewed_by": reviewed_by,
        "review_note": note,
    }).eq("id", app_id).execute()


def pending_applications(guild_id: int) -> list[dict[str, Any]]:
    return (
        get()
        .table("applications")
        .select("*")
        .eq("guild_id", guild_id)
        .eq("status", "pending")
        .execute()
    ).data or []


# ------------------------------------------------------------- tickets

def create_ticket(guild_id: int, user_id: int, channel_id: int,
                  category_id: int, subject: str) -> dict[str, Any]:
    res = get().table("tickets").insert({
        "guild_id": guild_id,
        "user_id": user_id,
        "channel_id": channel_id,
        "category_id": category_id,
        "subject": subject,
    }).execute()
    return res.data[0]


def get_ticket_by_channel(guild_id: int, channel_id: int) -> dict[str, Any] | None:
    res = (
        get()
        .table("tickets")
        .select("*")
        .eq("guild_id", guild_id)
        .eq("channel_id", channel_id)
        .eq("status", "open")
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def close_ticket(guild_id: int, channel_id: int, closed_by: int) -> None:
    from datetime import datetime, timezone
    get().table("tickets").update({
        "status": "closed",
        "closed_by": closed_by,
        "closed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("guild_id", guild_id).eq("channel_id", channel_id).execute()


# ------------------------------------------------------------ settings

def get_settings(guild_id: int) -> dict[str, Any]:
    """Config persistante du bot pour un serveur."""
    res = (
        get()
        .table("settings")
        .select("*")
        .eq("guild_id", guild_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else {}


def set_setting(guild_id: int, **fields: Any) -> dict[str, Any]:
    """Ecrit la config en PartialUpdate (ne touche pas aux autres colonnes)."""
    res = (
        get()
        .table("settings")
        .upsert({"guild_id": guild_id, **fields}, on_conflict="guild_id")
        .execute()
    )
    return res.data[0]


# ------------------------------------------------------------- audit

def log_action(guild_id: int, actor_id: int, action: str,
               target_id: int | None = None, **details: Any) -> None:
    """Journalise une action. N'echoue jamais le flux principal."""
    try:
        get().table("audit_log").insert({
            "guild_id": guild_id,
            "actor_id": actor_id,
            "action": action,
            "target_id": target_id,
            "details": details,
        }).execute()
    except Exception:
        log.exception("Echec de l'ecriture dans audit_log (%s)", action)


def recent_audit(guild_id: int, limit: int = 10) -> list[dict[str, Any]]:
    return (
        get()
        .table("audit_log")
        .select("*")
        .eq("guild_id", guild_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    ).data or []
