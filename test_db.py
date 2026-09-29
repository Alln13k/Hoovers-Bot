"""Test de connexion a Supabase. Lance avec: python test_db.py"""

import config
import db

print(f"URL      : {config.SUPABASE_URL}")
print(f"GUILD_ID : {config.GUILD_ID}")
print(f"OWNER    : {config.BOT_OWNER_IDS}")
print("-" * 50)

problems = config.validate()
if problems:
    print("Config incomplete :")
    for p in problems:
        print(f"  - {p}")
    raise SystemExit(1)

try:
    client = db.get()
    print("[OK] Connexion Supabase etablie")
except Exception as e:
    print(f"[KO] Connexion impossible : {e}")
    raise SystemExit(1)

# Verifie que le schema existe
tables = ["ranks", "members", "sanctions", "applications", "tickets", "audit_log"]
print("-" * 50)
for table in tables:
    try:
        client.table(table).select("id").limit(1).execute()
        print(f"  [OK] table '{table}' accessible")
    except Exception as e:
        msg = str(e).split("\n")[0][:110]
        print(f"  [KO] table '{table}' : {msg}")

print("-" * 50)
print("Si une table est en KO, execute supabase_schema.sql dans le SQL Editor.")
