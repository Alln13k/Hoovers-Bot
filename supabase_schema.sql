-- =============================================================
--  Bot communautaire - Schema Supabase
--  A coller dans Supabase > SQL Editor > New query > Run
--
--  Modele multi-tenant : chaque ligne est isolee par guild_id.
--  Un serveur ne voit jamais les donnees d'un autre.
-- =============================================================

-- ---------- SERVEURS ----------
create table if not exists public.guilds (
  guild_id        bigint primary key,
  name            text,
  owner_id        bigint,                  -- proprio du serveur
  installed_by    bigint,                  -- qui a invite le bot
  icon_hash       text,                    -- hash de l'icone, pas une URL
  locale          text default 'fr',
  created_at      timestamptz default now(),
  last_seen_at    timestamptz default now()
);

-- ---------- ADMINS (utilisateurs autorises a configurer le serveur) ----------
create table if not exists public.guild_admins (
  guild_id      bigint      not null,
  user_id       bigint      not null,
  role_id       bigint,                    -- restreint a ce role Discord (optionnel)
  added_at      timestamptz default now(),
  primary key (guild_id, user_id)
);

-- ---------- CONFIG PAR SERVEUR ----------
-- Une seule ligne par serveur, upsert a chaque modification depuis le site.
create table if not exists public.guild_config (
  guild_id          bigint primary key,
  welcome_channel   bigint,
  welcome_message   text,
  leave_channel     bigint,
  leave_message     text,
  log_channel       bigint,
  tickets_category  bigint,
  tickets_enabled   boolean default false,
  tickets_message   text,
  tickets_count     int default 1,         -- 1..5 questions du formulaire
  autorole_enabled  boolean default false,
  autorole_id       bigint,                 -- role donne a l'accueil
  automod_enabled   boolean default false,
  updated_at        timestamptz default now()
);

-- ---------- TICKETS ----------
create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  guild_id    bigint      not null,
  channel_id  bigint      not null unique,
  user_id     bigint      not null,
  subject     text,
  answers     jsonb       default '{}'::jsonb,
  status      text        not null default 'open',   -- open | closed
  closed_by   bigint,
  created_at  timestamptz default now(),
  closed_at   timestamptz
);

create index if not exists tickets_guild_idx on public.tickets (guild_id, status);

-- ---------- SESSIONS DU SITE WEB ----------
create table if not exists public.web_sessions (
  token       text primary key,
  user_id     bigint      not null,
  expires_at  timestamptz not null,
  created_at  timestamptz default now()
);

create index if not EXISTS web_sessions_user_idx on public.web_sessions (user_id);

-- ---------- ROW LEVEL SECURITY ----------
-- On verrouille tout. Seules les service_role (le bot et le site, cote
-- serveur) passent. Aucune policy n'est ouverte.
alter table public.guilds         enable row level security;
alter table public.guild_admins   enable row level security;
alter table public.guild_config   enable row level security;
alter table public.tickets       enable row level security;
alter table public.web_sessions  enable row level security;
