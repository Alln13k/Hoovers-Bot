-- =============================================================
--  HOOVERS - Schema Supabase
--  A coller dans Supabase > SQL Editor > New query > Run
-- =============================================================

-- ---------- GRADES (hiérarchie du gang) ----------
create table if not exists public.ranks (
  id            uuid primary key default gen_random_uuid(),
  guild_id      bigint      not null,
  name          text        not null,
  discord_role_id bigint,                    -- rôle Discord appliqué automatiquement
  position      int         not null default 0,   -- 0 = plus bas, 100 = boss
  color         text        default '#9ca3af',
  created_at    timestamptz default now()
);

create index if not exists ranks_guild_idx on public.ranks (guild_id);

-- ---------- FICHES MEMBRES ----------
create table if not exists public.members (
  id            uuid primary key default gen_random_uuid(),
  guild_id      bigint      not null,
  user_id       bigint      not null,
  username      text,
  rank_id       uuid references public.ranks (id) on delete set null,
  status        text        not null default 'active',  -- active | recrue | inactif | parti
  notes         text,
  joined_at     timestamptz default now(),
  unique (guild_id, user_id)
);

create index if not exists members_guild_idx on public.members (guild_id);

-- ---------- SANCTIONS ----------
create table if not exists public.sanctions (
  id            uuid primary key default gen_random_uuid(),
  guild_id      bigint      not null,
  user_id       bigint      not null,
  moderator_id  bigint      not null,
  type          text        not null,          -- warn | mute | kick | ban
  reason        text        not null,
  duration_minutes int,                       -- null = définitif
  active        boolean     not null default true,
  expires_at    timestamptz,
  created_at    timestamptz default now()
);

create index if not exists sanctions_user_idx on public.sanctions (guild_id, user_id);

-- ---------- RECRUTEMENT ----------
create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  guild_id      bigint      not null,
  user_id       bigint      not null,
  answers       jsonb       not null,
  status        text        not null default 'pending',  -- pending | accepted | rejected
  reviewed_by   bigint,
  review_note   text,
  created_at    timestamptz default now()
);

create index if not exists apps_guild_idx on public.applications (guild_id, status);

-- ---------- TICKETS ----------
create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  guild_id      bigint      not null,
  user_id       bigint      not null,
  channel_id    bigint,
  category_id   bigint,
  subject       text,
  status        text        not null default 'open',  -- open | closed
  closed_by     bigint,
  created_at    timestamptz default now(),
  closed_at     timestamptz
);

-- ---------- JOURNAL D'AUDIT ----------
create table if not exists public.audit_log (
  id            bigserial primary key,
  guild_id      bigint      not null,
  actor_id      bigint      not null,
  action        text        not null,
  target_id     bigint,
  details       jsonb       default '{}'::jsonb,
  created_at    timestamptz default now()
);

create index if not exists audit_guild_idx on public.audit_log (guild_id, created_at desc);

-- ---------- SETTINGS (config persistante du bot) ----------
create table if not exists public.settings (
  guild_id      bigint primary key,
  recruit_channel_id bigint,
  tickets_channel_id  bigint,
  muted_role_id       bigint,
  created_at    timestamptz default now()
);

-- ---------- ROW LEVEL SECURITY ----------
-- On active RLS et on verrouille tout: seul le bot (service_role) parle a la base.
alter table public.ranks        enable row level security;
alter table public.members      enable row level security;
alter table public.sanctions    enable row level security;
alter table public.applications enable row level security;
alter table public.tickets      enable row level security;
alter table public.audit_log    enable row level security;
alter table public.settings    enable row level security;

-- Aucune policy = aucun acces depuis le navigateur.
-- Seul le service_role key (cote bot) passe.
