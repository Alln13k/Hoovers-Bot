// Rendu HTML. Pas de framework : des templates simples, c'est suffisant
// pour un dashboard de quelques pages et ca evite une dependance de plus.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Echappe le HTML. A appeler sur TOUTE donnee saisie par un utilisateur. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const STYLE = `
:root{--bg:#1a1b1e;--card:#232428;--line:#2f3136;--txt:#f2f3f5;--mut:#9aa0a6;
--pri:#5865f2;--ok:#57f287;--err:#ed4245}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);
font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{border-bottom:1px solid var(--line);padding:16px 24px;display:flex;
align-items:center;gap:16px;background:var(--card)}
header h1{font-size:18px;margin:0}
.wrap{max-width:960px;margin:0 auto;padding:32px 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;
padding:24px;margin-bottom:20px}
h2{font-size:20px;margin:0 0 6px}
.mut{color:var(--mut);font-size:14px}
label{display:block;margin:16px 0 6px;font-size:13px;font-weight:600;color:var(--mut)}
input,select,textarea{width:100%;padding:10px 12px;background:var(--bg);
border:1px solid var(--line);border-radius:8px;color:var(--txt);font:inherit}
textarea{min-height:70px;resize:vertical}
button{margin-top:18px;padding:10px 18px;background:var(--pri);color:#fff;
border:0;border-radius:8px;font:inherit;font-weight:600;cursor:pointer}
button:hover{filter:brightness(1.1)}
a{color:var(--pri)}
.row{display:flex;gap:12px;flex-wrap:wrap}
.row>*{flex:1;min-width:180px}
.guild{display:flex;align-items:center;gap:14px;padding:14px;border:1px solid var(--line);
border-radius:10px;margin-bottom:10px;background:var(--bg)}
.guild img{width:40px;height:40px;border-radius:10px}
.tag{font-size:12px;padding:2px 8px;border-radius:20px;background:var(--line);
color:var(--mut)}
.tag.on{background:rgba(87,242,135,.15);color:var(--ok)}
.tag.off{background:rgba(237,66,69,.15);color:var(--err)}
.flash{padding:12px 16px;border-radius:10px;margin-bottom:20px}
.flash.ok{background:rgba(87,242,135,.12);color:var(--ok)}
.flash.err{background:rgba(237,66,69,.12);color:var(--err)}
.hint{font-size:12px;color:var(--mut);margin-top:4px}
`;

export function layout({ title, user, body, flash }) {
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Bot</title>
<style>${STYLE}</style>
</head><body>
<header>
  <h1>🤖 Bot communautaire</h1>
  <div style="flex:1"></div>
  ${user ? `<span class="mut">${esc(user.username)}</span>
  <form method="post" action="/logout" style="margin:0">
  <button style="margin:0;background:var(--line);padding:8px 14px">Deconnexion</button>
  </form>` : ''}
</header>
<div class="wrap">
${flash ? `<div class="flash ${flash.kind}">${esc(flash.message)}</div>` : ''}
${body}
</div>
</body></html>`;
}

export function loginPage() {
  return layout({
    title: 'Connexion',
    body: `<div class="card" style="text-align:center;padding:48px 24px">
  <h2>Configurez votre serveur</h2>
  <p class="mut" style="max-width:420px;margin:12px auto 0">
  Bienvenue, rejoignez les serveurs ou vous avez les permissions
  d'administrateur, et personnalisez le bot depuis le dashboard.</p>
  <a href="/auth/login"><button style="margin-top:24px">Se connecter avec Discord</button></a>
</div>`,
  });
}

/** Construit l'URL d'une icone de serveur Discord a partir de son hash. */
export function iconUrl(guildId, hash) {
  if (!hash) return null;
  return `https://cdn.discordapp.com/icons/${encodeURIComponent(guildId)}/${encodeURIComponent(hash)}.png`;
}

export function guildListPage(guilds, flash) {
  const rows = guilds
    .map((g) => {
      const url = iconUrl(g.guild_id, g.iconHash ?? g.icon_hash);
      const icon = url
        ? `<img src="${esc(url)}" alt="">`
        : '<div style="width:40px;height:40px;border-radius:10px;background:var(--line)"></div>';
      const target = `/guild/${encodeURIComponent(g.guild_id)}`;
      return `<div class="guild">${icon}
  <div style="flex:1"><strong>${esc(g.name)}</strong>
  <div class="mut">${esc(String(g.guild_id))}</div></div>
  <a href="${target}"><button style="margin:0;padding:8px 14px">Configurer</button></a>
</div>`;
    })
    .join('');

  return layout({
    title: 'Vos serveurs',
    user: null,
    flash,
    body: `<div class="card">
  <h2>Vos serveurs</h2>
  <p class="mut">Seuls les serveurs ou vous avez <strong>Administrateur</strong> apparaissent.</p>
  ${rows || '<p class="mut" style="margin-top:16px">Aucun serveur trouve. Verifiez que le bot est invite.</p>'}
</div>`,
  });
}

export function guildConfigPage(guild, config, flash) {
  return layout({
    title: `Config — ${guild.name}`,
    user: null,
    flash,
    body: `<div class="card">
  <h2>${esc(guild.name)}</h2>
  <p class="mut">Les modifications sont prises en compte par le bot en quelques secondes.</p>
</div>

<form method="post" action="/guild/${esc(guild.guild_id)}">
<div class="card">
  <h2>Bienvenue &amp; depart</h2>

  <label>ID du salon de bienvenue</label>
  <input name="welcome_channel" value="${esc(config.welcome_channel ?? '')}"
    placeholder="ex: 1234567890123456789">
  <div class="hint">Clic droit sur le salon &gt; Copier l'identifiant du salon</div>

  <label>Message de bienvenue</label>
  <textarea name="welcome_message" placeholder="Bienvenue {user} sur {server} !">${esc(config.welcome_message ?? '')}</textarea>
  <div class="hint">Variables : <code>{user}</code> <code>{username}</code> <code>{tag}</code> <code>{server}</code> <code>{count}</code></div>

  <label>ID du salon de depart</label>
  <input name="leave_channel" value="${esc(config.leave_channel ?? '')}" placeholder="Meme salon ou un autre">

  <label>Message de depart</label>
  <textarea name="leave_message" placeholder="{username} a quitte {server}.">${esc(config.leave_message ?? '')}</textarea>
</div>

<div class="card">
  <h2>Tickets</h2>
  <label>ID de la categorie des tickets</label>
  <input name="tickets_category" value="${esc(config.tickets_category ?? '')}" placeholder="Clic droit sur la categorie">

  <label>Tickets actives</label>
  <select name="tickets_enabled">
    <option value="false" ${config.tickets_enabled ? '' : 'selected'}>Non</option>
    <option value="true" ${config.tickets_enabled ? 'selected' : ''}>Oui</option>
  </select>

  <label>Nombre de questions (1 a 5)</label>
  <input name="tickets_count" type="number" min="1" max="5" value="${esc(config.tickets_count ?? 1)}">

  <label>Role donne automatiquement a l'accueil</label>
  <input name="autorole_id" value="${esc(config.autorole_id ?? '')}" placeholder="Clic droit sur le role &gt; Copier l'identifiant">

  <label>Role automatique actif</label>
  <select name="autorole_enabled">
    <option value="false" ${config.autorole_enabled ? '' : 'selected'}>Non</option>
    <option value="true" ${config.autorole_enabled ? 'selected' : ''}>Oui</option>
  </select>
</div>

<div class="card">
  <h2>Logs</h2>
  <label>ID du salon de logs</label>
  <input name="log_channel" value="${esc(config.log_channel ?? '')}" placeholder="Laisser vide pour desactiver">
</div>

<button type="submit">Enregistrer</button>
</form>

<div class="card" style="border-color:var(--err)">
  <h2 style="color:var(--err)">Zone dangereuse</h2>
  <p class="mut">Retire le bot du serveur et supprime toutes les donnees associees.</p>
  <form method="post" action="/guild/${esc(guild.guild_id)}/leave">
  <button style="background:var(--err)">Retirer le bot du serveur</button>
  </form>
</div>`,
  });
}

export function errorPage(message) {
  return layout({
    title: 'Erreur',
    body: `<div class="card">
  <h2>Erreur</h2><p class="mut">${esc(message)}</p>
  <a href="/guilds"><button>Retour</button></a>
</div>`,
  });
}
