# Bot communautaire

Bot Discord installable sur n'importe quel serveur, avec un dashboard web
pour configurer chaque serveur indépendamment.

Node.js 22 · discord.js 14 · Supabase

## Fonctionnalités v1

| | Commande | Description |
|---|---|---|
| 👋 | `/setup-welcome` | Messages de bienvenue et de départ, rôle auto |
| 🎫 | `/setup-tickets` | Tickets avec formulaire (1 à 5 questions) |
| 📋 | `/setup-logs` | Salon de logs |
| ⚙️ | `/config` | Affiche la configuration en cours |
| 📊 | `/tickets` | État des tickets du serveur |

Tout se règle aussi depuis le site, avec un texte d'aide dans l'interface.

## Architecture

Deux processus distincts, deux services Render :

- **`src/index.js`** — le bot Discord (worker)
- **`src/web.js`** — le dashboard (web service)

Ils partagent la même base. Chaque ligne porte un `guild_id` : un serveur ne
voit jamais les données d'un autre.

```
src/
  index.js            bot : commandes, événements, enregistrement par serveur
  web.js              point d'entrée du dashboard
  config.js           variables d'environnement
  db.js               accès Supabase (isolation par guild_id)
  helpers.js          embeds, parsing, rendu de messages
  features/
    welcome.js        bienvenue, départ, rôle auto, /config
    tickets.js        tickets privés + formulaire
  web/
    server.js         routage HTTP
    auth.js           OAuth2 Discord + sessions
    views.js          rendu HTML
supabase_schema.sql   à exécuter une fois dans Supabase
```

## Installation

### 1. Base de données
Supabase → **SQL Editor → New query**, colle `supabase_schema.sql`, **Run**.
Crée `guilds`, `guild_admins`, `guild_config`, `tickets`, `web_sessions`.

### 2. Application Discord
[discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → **Bot** → **Reset Token**.

Permissions du bot :
`Manage Roles` · `Manage Channels` · `Manage Server` · `Kick Members` ·
`Ban Members` · `Moderate Members` · `Read Message History` ·
`Send Messages` · `Embed Links` · `Attach Files`

**Bot → Privileged Gateway Intents** → activer **Server Members Intent**
(indispensable pour les messages de bienvenue).

### 3. OAuth2 du site
**OAuth2 → Redirects** → ajouter `https://ton-domaine/auth/callback`

### 4. Lancer

```bash
npm install
cp .env.example .env   # puis remplir
npm test               # vérifie tout hors ligne
npm start              # le bot
npm run web            # le dashboard
```

## Le dashboard

1. L'utilisateur clique sur **Se connecter avec Discord**
2. OAuth2 → le site voit ses serveurs où il a **Administrateur**
3. Il clique **Configurer** et règle bienvenue, tickets, rôle auto, logs

Un bot peut être dans des milliers de serveurs. Chaque serveur est isolé :
les tickets, la config et les logs sont filtrés par `guild_id` à chaque requête.

## Sécurité

- **Les permissions sont vérifiées deux fois.** `setDefaultMemberPermissions`
  masque la commande dans l'interface mais n'empêche personne de l'invoquer.
  `REQUIRED_PERMISSIONS` dans `src/index.js` bloque réellement l'exécution.
  Les deux sont nécessaires.
- **Sessions** : token aléatoire de 32 octets, stocké **haché** (SHA-256) en
  base, cookie `HttpOnly` + `SameSite=Lax`.
- **Anti-CSRF** : un `state` aléatoire est comparé en temps constant au retour
  d'OAuth2.
- **XSS** : tout ce qui vient d'un utilisateur passe par `esc()` avant d'être
  mis dans le HTML. C'est vérifié par un test.
- **`service_role`** : contorne le RLS. Jamais dans un salon, jamais côté
  client, jamais dans un message.
- **RLS activé** sur toutes les tables, aucune policy ouverte : seul le code
  serveur accède à la base.

Si une clé fuite → Supabase → Project Settings → API → **Reset**.

## Tests

```bash
npm test
```

Vérifie hors ligne : config, unicité des commandes, validité du JSON envoyé à
Discord, permissions (visibilité **et** exécution), parsing de durée, rendu des
messages, échappement HTML, rendu des pages, cohérence code ↔ schéma SQL.

N'appelle ni Discord ni Supabase.

## Déploiement

Le `render.yaml` définit les deux services (worker + web). Si tu déploies à la
main :

| | Bot | Dashboard |
|---|---|---|
| Type | **Background Worker** | **Web Service** |
| Build | `npm ci` | `npm ci` |
| Start | `npm start` | `npm run web` |

Le plan gratuit de Render ne permet pas les Background Workers. Un bot gratuit
se met en veille après 15 min sans trafic et se déconnecte.

## Idées pour la suite

Non implémentées, notées pour plus tard :

- Logs structurés (join/leave/suppression de messages) — la table est prête
- Anti-spam : filtres de mots, limite de mentions, slowmode
- Réactions automatiques / rôles par message
- Commandes `/help` et `/stats` du bot
- Webhooks : `POST /hooks/:guild_id` pour pousser des events depuis un site
- Premium : quotas, tableaux de bord anonymes, export de données

## Limitations connues

- `/roster` n'existe pas encore (le bot n'a pas vocation à lister les membres).
- Le dashboard ne montre que les serveurs où l'utilisateur a `Administrateur`,
  pas `Manage Guild`.
- Un utilisateur qui retire le bot depuis un serveur mais garde une session
  ouverte voit encore la config en lecture.
