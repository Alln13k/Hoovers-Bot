"""Test de fumee : verifie que tout s'importe et que les commandes s'enregistrent.
Ne se connecte pas a Discord. Lance avec: python smoke_test.py
"""

import asyncio
import inspect
import sys

import discord
from discord import app_commands as ac
from discord.ext import commands

import config

print("=" * 55)
print("  HOOVERS - Test de fumee")
print("=" * 55)

# --- 1. Config ---
print("\n[1] Configuration")
problems = config.validate()
if problems:
    print("    [KO] " + ", ".join(problems))
    sys.exit(1)
print(f"    [OK] CLIENT_ID  = {config.CLIENT_ID}")
print(f"    [OK] GUILD_ID   = {config.GUILD_ID}")
print(f"    [OK] OWNER_IDS  = {config.BOT_OWNER_IDS}")

# --- 2. API discord.py disponible ---
print("\n[2] API discord.py")
if not hasattr(ac, "command"):
    print("    [KO] discord.app_commands.command absent - version incompatible")
    sys.exit(1)
print(f"    [OK] discord.py {discord.__version__}")
print("    [OK] app_commands.command disponible")

# --- 3. Cogs ---
print("\n[3] Chargement des cogs")
COGS = ["audit", "moderation", "grades", "members", "recruitment", "tickets",
        "sync"]
for name in COGS:
    try:
        module = __import__(f"cogs.{name}", fromlist=["setup"])
        assert hasattr(module, "setup"), "setup() manquant"
        assert inspect.iscoroutinefunction(module.setup), "setup() doit etre async"
        print(f"    [OK] cogs.{name}")
    except Exception as e:
        print(f"    [KO] cogs.{name} : {type(e).__name__}: {e}")
        sys.exit(1)

# --- 4. Enregistrement reel sur un bot ---
print("\n[4] Enregistrement des commandes sur un bot")


async def register() -> list:
    intents = discord.Intents.default()
    b = commands.Bot(command_prefix=commands.when_mentioned, intents=intents)

    audit_mod = __import__("cogs.audit", fromlist=["Audit"])
    await b.add_cog(audit_mod.Audit(b))
    for name in COGS[1:]:
        module = __import__(f"cogs.{name}", fromlist=["setup"])
        await module.setup(b)

    cmds = b.tree.get_commands()

    # Arrete les taches de fond : le client n'est pas connecte dans ce test
    for cog in list(b.cogs.values()):
        if hasattr(cog, "_watch_expired"):
            cog._watch_expired.cancel()
    await asyncio.sleep(0)
    await b.close()
    return cmds


try:
    cmds = asyncio.run(register())
except Exception as e:
    print(f"    [KO] enregistrement : {type(e).__name__}: {e}")
    sys.exit(1)

names = {c.name for c in cmds}
print(f"    [OK] {len(cmds)} commandes enregistrees")

EXPECTED = {
    "log", "warn", "mute", "kick", "ban", "unwarn", "unmute", "sanctions",
    "panel", "grade", "promote", "demote", "grades", "init",
    "fiche", "ajouter", "roster", "stats",
    "setup-recrutement", "postuler-bouton", "candidatures",
    "setup-tickets", "tickets", "sync", "commandes",
}
missing = sorted(EXPECTED - names)
if missing:
    print(f"    [KO] commandes manquantes : {missing}")
    sys.exit(1)
print(f"    [OK] les {len(EXPECTED)} commandes attendues sont la")

# --- 5. Permissions reellement attachees ---
print("\n[5] Verification des permissions")
PROTECTED = {"log", "warn", "mute", "kick", "ban", "unwarn", "unmute",
             "sanctions", "panel", "grade", "promote", "demote", "init",
             "ajouter", "candidatures", "setup-tickets", "tickets",
             "setup-recrutement", "postuler-bouton", "sync"}
unchecked = [c.name for c in cmds if c.name in PROTECTED and not c.checks]
if unchecked:
    print(f"    [KO] commandes SANS check de permission : {unchecked}")
    print("         -> elles seraient accessibles a tout le monde")
    sys.exit(1)
print(f"    [OK] les {len(PROTECTED)} commandes protegees ont bien un check")

# --- 6. Vues ---
print("\n[6] Vues persistantes")
VIEWS = {
    "ApplyButtonView": "cogs.recruitment",
    "TicketPanel": "cogs.tickets",
    "CloseView": "cogs.tickets",
    "RankPanelView": "cogs.grades",
}
for cls_name, mod_name in VIEWS.items():
    try:
        mod = __import__(mod_name, fromlist=[cls_name])
        getattr(mod, cls_name)
        print(f"    [OK] {cls_name}")
    except Exception as e:
        print(f"    [KO] {cls_name} : {type(e).__name__}: {e}")
        sys.exit(1)

# --- 7. Utilitaires ---
print("\n[7] Utilitaires")
from utils import helpers

CASES = [("30m", 30), ("2h", 120), ("7j", 10080), ("1j12h", 2160),
         ("90", 90), ("2h30", 150)]
for text, expected in CASES:
    got = helpers.parse_duration(text)
    if got != expected:
        print(f"    [KO] parse_duration('{text}') = {got}, attendu {expected}")
        sys.exit(1)
    print(f"    [OK] parse_duration('{text}') = {got}")

for text in ("", "perm", "inf", "abc", "5x"):
    got = helpers.parse_duration(text)
    if got is not None:
        print(f"    [KO] parse_duration('{text}') = {got}, attendu None")
        sys.exit(1)
    print(f"    [OK] parse_duration('{text}') = None")

assert helpers.fmt_duration(90) == "1h30m", helpers.fmt_duration(90)
assert helpers.fmt_duration(1440) == "1j", helpers.fmt_duration(1440)
assert helpers.fmt_duration(45) == "45m", helpers.fmt_duration(45)
assert helpers.fmt_duration(None) == "definitif", helpers.fmt_duration(None)
print("    [OK] fmt_duration")

print("\n" + "=" * 55)
print(f"  TOUT PASSE - {len(cmds)} commandes, {len(PROTECTED)} protegees")
print("  Prochaine etape : executer supabase_schema.sql dans Supabase")
print("=" * 55)
