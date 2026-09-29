# Hoovers — Bot Discord

Bot de gestion de gang pour ton serveur FiveM. Pilote grades, sanctions,
recrutement, tickets et fiches membres. 100% côté Discord, zéro bridge FiveM.

## Stack
- Python 3.11+ / `discord.py` 2.4+
- Supabase (Postgres) avec RLS activé, accès via `service_role`
- Commandes slash via `discord.app_commands` (pas de préfixe)

> **Note sur discord.py** : cette installation n'expose pas
> `commands.slash_command` / `commands.SlashOption`. Tout le code utilise donc
> `discord.app_commands` (`@app_command`, `app_commands.describe`,
> `app_commands.choices`, `app_commands.Range`), ainsi que `app_commands.check`
> pour les permissions — `commands.check` n'est pas accroché aux app commands
> dans cette build et laisserait les commandes ouvertes à tous.

## Setup

### 1. Base de données
Ouvre **Supabase → SQL Editor → New query**, colle le contenu de
`supabase_schema.sql` et clique **Run**. Ça crée les 6 tables
(`ranks`, `members`, `sanctions`, `applications`, `tickets`, `audit_log`).

Vérifie avec :
```bash
python test_db.py
```

### 2. Créer le bot sur Discord
1. https://discord.com/developers/applications → **New Application**
2. Menu **Bot** → **Reset Token** → copie-le
3. **Bot Permissions** → coche :
   - `Manage Roles`, `Manage Nicknames`, `Manage Server`
   - `Kick Members`, `Ban Members`, `Moderate Members`
   - `Read Message History`, `Send Messages`, `Embed Links`
   - `Attach Files`, `Use External Emojis`
4. **Bot → Privileged Gateway Intents** → active **Server Members Intent**
   (obligatoire pour `/roster` et le panel des grades)
5. **OAuth2 → URL Generator** → coche `bot` + les permissions ci-dessus
   → ouvre l'URL générée pour inviter le bot sur ton serveur

### 3. Configurer le `.env`
Copie `.env.example` vers `.env` et remplis :
- `DISCORD_TOKEN`, `OWNER_IDS` (ton ID)
- `SUPABASE_URL`, `SUPABASE_KEY` (**`service_role`**, pas `anon`)
- Les IDs de salons (clic droit → *Copier l'identifiant du salon*)

### 4. Lancer
```bash
pip install -r requirements.txt
python bot.py
```

Les slash commands apparaissent automatiquement, pas besoin de `cog load`.

## Premier lancement

```
/init                 crée les grades Boss → Lieuten → Soldat → Recrue → Prospect
                      (+ les rôles Discord correspondants)
```

Puis :
```
/setup-recrutement    envoie le bouton « Postuler » dans un salon
/setup-tickets        envoie le bouton de ticket dans un salon
```

## Commandes

### Grades & rôles
| Commande | Qui | Effet |
|---|---|---|
| `/panel` | Admin | Panel visuel : assigner/créer/réordonner/supprimer un grade |
| `/grade` | Admin | Créer ou modifier un grade (position, couleur, rôle) |
| `/init` | Admin | Hiérarchie par défaut |
| `/grades` | Tous | Affiche la hiérarchie |
| `/promote` | Staff | Attribue un grade + applique le rôle |
| `/demote` | Staff | Retire les rôles gang |

### Sanctions
| Commande | Dureur |
|---|---|
| `/warn membre raison` | — |
| `/mute membre raison duree` | `30m`, `2h`, `7j`, `perm` |
| `/kick membre raison` | — |
| `/ban user raison duree` | `perm` ou `7j` |
| `/unwarn membre [id]` | retire 1 warn ou tout l'historique |
| `/unmute membre` | fin anticipée |
| `/sanctions membre` | historique |

Les mutes expirent tout seuls (task qui tourne toutes les 2 min).
Un rôle Discord nommé `Muted` est requis — crée-le sur le serveur.

### Membres & recrutement
| Commande | Qui | Effet |
|---|---|---|
| `/fiche [membre]` | Tous | Profil : grade, statut, warns, ancienneté |
| `/ajouter membre` | Staff | Crée/met à jour une fiche |
| `/roster` | Tous | Liste complète groupée par grade |
| `/stats` | Tous | Effectifs et warns cumulés |
| `/candidatures` | Staff | Candidatures en attente |

### Tickets
| Commande | Qui |
|---|---|
| `/setup-tickets` | Admin |
| `/tickets [user]` | Staff |

Chaque ticket = un salon privé (le demandeur + le staff), fermable par le staff.

### Audit
| Commande | Qui |
|---|---|
| `/log [limit]` | Staff |
| `/sync` | Propriétaire | Resync immédiat du serveur |
| `/commandes` | Tous | Liste les commandes chargées |

Toutes les actions sont écrites dans `audit_log` **et** postées dans
`LOG_AUDIT_CHANNEL_ID`.

## Sync des commandes

Les commandes slash sont **automatiquement resynchronisées au démarrage**, dans
le `on_ready`. Le sync est **global** et supprime les commandes qui n'existent
plus dans le code.

> **Pourquoi pas de sync par guild ?** Sur cette version de `discord.py`,
> `tree.sync(guild=...)` ne lit que `tree._guild_commands[guild.id]`. Les
> commandes déclarées dans des cogs sont enregistrées comme **globales**, donc
> le payload part **vide** — et `bulk_upsert_guild_commands` avec un tableau
> vide **écrase toutes les commandes du serveur** sans rien inscrire. Symptôme
> observed : `Commandes synchronisees sur '...' : 0 / 25`.
>
> Le sync global a un délai de propagation (jusqu'à 1h selon Discord), mais
> c'est le seul mode qui inscrit réellement les commandes. Pour que ça soit
> visible tout de suite dans un seul serveur, le plus simple reste que le bot
> rejoigne ce seul serveur.

Si tu ajoutes ou renommes une commande en cours de session, `/sync` force la
mise à jour sans redémarrer.

## Tests
```bash
python smoke_test.py   # 23 commandes, permissions, vues, parsing
python test_db.py      # connexion Supabase + presence des tables
```
`smoke_test.py` ne se connecte pas à Discord et ne touche pas à la base.

## Structure
```
bot.py                 point d'entrée, charge les cogs dans l'ordre
config.py              lecture du .env
db.py                  couche d'accès Supabase
cogs/
  audit.py             journal (démarré en premier, les autres en dépendent)
  moderation.py        warn / mute / kick / ban + auto-unmute
  grades.py            hiérarchie + panel d'admin
  members.py           fiches, roster, stats
  recruitment.py       formulaire + validation
  tickets.py           tickets privés
  sync.py              /sync et /commandes
supabase_schema.sql    à exécuter une fois dans Supabase
smoke_test.py          vérifie commandes, permissions, vues, utilitaires
test_db.py             vérifie la connexion et les tables
```

## Déploiement sur Render

Le bot est un **Background Worker**, pas une web app.

1. Render → **New → Blueprint**, pointe sur le repo (le `render.yaml` est fourni)
2. Ou manuellement : **New → Background Worker**, puis :
   - Build Command : `pip install -r requirements.txt`
   - Start Command : `python bot.py`
3. Variables d'environnement (le minimum) :
   ```
   DISCORD_TOKEN=...
   SUPABASE_URL=...
   SUPABASE_KEY=<clé service_role>
   OWNER_IDS=<ton ID>
   GUILD_ID=1554583999647850556
   ```
4. `.python-version` épingle Python 3.13

⚠️ Le plan **gratuit ne supporte pas les Background Workers** — il faut un
`starter` payant. En plan gratuit (web service), le process se met en veille
après 15 min sans traffic et le bot se déconnecte.

## Sécurité

- `.env` est dans `.gitignore`, ne le commit jamais.
- La clé `service_role` contourne le RLS : **jamais** dans un salon Discord,
  **jamais** dans du code client, **jamais** en message.
- Seule la `service_role` parle à la base, aucune policy n'est ouverte.
- Si la clé fuite → Supabase → Project Settings → API → **Reset**.

## Requis côté serveur Discord
- Rôle **`Muted`** : requis par `/mute`, absent le mute échoue proprement.
- Rôle du bot **au-dessus** des rôles gang, sinon `Manage Roles` est refusé
  par Discord (le bot ne peut pas toucher un rôle plus haut que le sien).
- **Server Members Intent** activé, sinon `/roster` et le panel ne voient pas
  la liste des membres.

## Limitations connues
- Un seul ticket ouvert par personne à la fois.
- La commande `/grade` avec l'action `creer` prend la couleur ou la position
  selon le format de `valeur` (`#RRGGBB` = couleur, `70` = position).
- Le panel `/panel` est éphémère : il se ferme au bout de 3 minutes. Les
  boutons de recrutement et de ticket, eux, sont persistants.
- `/roster` se limite à 25 membres par grade dans l'affichage Discord
  (limite de `SelectMenu` et de longueur d'embed).

# Hoovers-Bot
