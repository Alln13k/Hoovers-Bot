# Hoovers — Bot Discord

Bot de gestion de gang pour ton serveur FiveM. Pilote grades, sanctions,
recrutement, tickets et fiches membres. 100% côté Discord, zéro bridge FiveM.

## Stack
- Node.js 22+ / `discord.js` 14
- Supabase (Postgres) avec RLS activé, accès via `service_role`
- Commandes slash enregistrées **par serveur** (instantané)

## Setup

### 1. Base de données
Ouvre **Supabase → SQL Editor → New query**, colle le contenu de
`supabase_schema.sql` et clique **Run**. Ça crée les tables `ranks`,
`members`, `sanctions`, `applications`, `tickets`, `audit_log`, `settings`.

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
- `CLIENT_ID`, `GUILD_ID`
- `SUPABASE_URL`, `SUPABASE_KEY` (**`service_role`**, pas `anon`)
- Les IDs de salons (clic droit → *Copier l'identifiant du salon*)

### 4. Lancer
```bash
npm install
npm run deploy     # enregistre les commandes sur ton serveur
npm start          # lance le bot
```

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
| `/panel` | Admin | Panel visuel : assigner un grade à un membre |
| `/grade` | Admin | Créer ou modifier un grade (position, couleur, rôle) |
| `/init` | Admin | Hiérarchie par défaut |
| `/grades` | Tous | Affiche la hiérarchie |
| `/promote` | Staff | Attribue un grade + applique le rôle |
| `/demote` | Staff | Retire les rôles gang |

### Sanctions
| Commande | Durée |
|---|---|
| `/warn membre raison` | — |
| `/mute membre raison duree` | `30m`, `2h`, `7j`, `perm` |
| `/kick membre raison` | — |
| `/ban membre raison duree` | `perm` ou `7j` |
| `/unwarn membre [id]` | retire 1 warn ou tout l'historique |
| `/unmute membre` | fin anticipée |
| `/sanctions membre` | historique |

`/mute` utilise le **timeout natif de Discord** (jusqu'à 28 jours), aucun rôle
requis. Au-delà, ou pour un mute définitif, le bot utilise un rôle `Muted` s'il
existe. Les timeouts expirent tout seuls côté Discord ; un nettoyage de la base
tourne toutes les 5 min.

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
| `/tickets [membre]` | Staff |

Chaque ticket = un salon privé (le demandeur + le staff), fermable par le staff.
Un seul ticket ouvert par personne à la fois.

### Journal
| Commande | Qui |
|---|---|
| `/log [limite]` | Staff |
| `/commandes` | Tous | Liste les commandes chargées |

Toutes les actions sont écrites dans `audit_log` **et** postées dans
`LOG_AUDIT_CHANNEL_ID`.

## Enregistrement des commandes

Les 24 commandes sont enregistrées **par serveur** au démarrage
(`client.applicationCommands.set(guildId, ...)`). C'est instantané et ça supprime
réellement les commandes qui n'existent plus.

`npm run deploy` fait la même chose sans lancer le bot, utile quand tu ajoutes
une commande et veux la voir immédiatement.

> Un sync **global** aurait mis jusqu'à 1h à se propager. Le sync par serveur
> évite ça, à condition que le bot ne soit pas présent sur d'autres serveurs.

## Structure
```
src/
  index.js              point d'entrée, sync, routage, permissions
  config.js             lecture du .env
  db.js                 couche d'accès Supabase
  helpers.js            embeds, permissions, parsing de durée
  audit.js              journal (base + salon de log)
  deploy-commands.js    enregistrement manuel des commandes
  test.js               vérification hors ligne
  commands/
    audit.js            /log /commandes
    moderation.js       warn / mute / kick / ban / unwarn / unmute / sanctions
    grades.js           /panel /grade /init /promote /demote /grades
    members.js          /fiche /ajouter /roster /stats
    recruitment.js      /setup-recrutement /postuler-bouton /candidatures
    tickets.js          /setup-tickets /tickets
supabase_schema.sql     à exécuter une fois dans Supabase
```

## Sécurité

- `.env` est dans `.gitignore`, ne le commit jamais.
- **Les permissions sont vérifiées deux fois** : `setDefaultMemberPermissions`
  masque la commande dans l'interface, mais n'empêche personne de l'invoquer.
  `src/index.js` contient une table `REQUIRED_PERMISSIONS` qui bloque
  réellement l'exécution. Les deux sont nécessaires.
- La clé `service_role` contourne le RLS : **jamais** dans un salon Discord,
  **jamais** dans du code client, **jamais** en message.
- Seule la `service_role` parle à la base, aucune policy n'est ouverte.
- Si la clé fuite → Supabase → Project Settings → API → **Reset**.

## Tests
```bash
npm test
```
Vérifie hors ligne : config, unicité des commandes, validité du JSON envoyé à
Discord, permissions (visibilité **et** exécution), parsing de durée, exports
des modules. N'appelle pas Discord.

## Déploiement sur Render

Le bot est un **Background Worker**, pas une web app.

1. Render → **New → Background Worker**, branche `main`
2. Build Command : `npm ci`
3. Start Command : `npm start`
4. Variables d'environnement :
   ```
   DISCORD_TOKEN=...
   CLIENT_ID=...
   GUILD_ID=...
   OWNER_IDS=...
   SUPABASE_URL=...
   SUPABASE_KEY=<clé service_role>
   ```
5. `NODE_VERSION=22.16.0`

Un `render.yaml` est fourni si tu préfères le deploy par Blueprint.

⚠️ Le plan **gratuit ne supporte pas les Background Workers** — il faut un
`starter` payant. En plan gratuit (web service), le process se met en veille
après 15 min sans traffic et le bot se déconnecte.

## Limitations connues
- Un seul ticket ouvert par personne à la fois.
- Le panel `/panel` est éphémère (visible que par toi). Les boutons de
  recrutement et de ticket sont persistants.
- `/roster` se limite à 25 membres par grade dans l'affichage Discord.
- Le timeout natif Discord plafonne à 28 jours ; au-delà il faut le rôle `Muted`.
