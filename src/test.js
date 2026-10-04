// Verification hors ligne : config, commandes, rendu HTML, routes.
// N'appelle ni Discord ni Supabase. Usage: npm test

import { readFileSync } from 'node:fs';
import { validate, config } from './config.js';
import * as tickets from './features/tickets.js';
import * as welcome from './features/welcome.js';
import { parseDuration, render } from './helpers.js';
import { esc, guildListPage, guildConfigPage, iconUrl } from './web/views.js';

const FEATURES = { tickets, welcome };
let fail = 0;
const ok = (m) => console.log(`    [OK] ${m}`);
const ko = (m) => {
  console.log(`    [KO] ${m}`);
  fail += 1;
};

console.log('='.repeat(55));
console.log('  Bot communautaire - Test hors ligne');
console.log('='.repeat(55));

// ---- 1. Config -------------------------------------------------------
console.log('\n[1] Configuration');
const problems = validate();
if (problems.length) {
  problems.forEach((p) => console.log(`    [KO] ${p}`));
  console.log('\n  Les variables manquantes sont attendues avant le premier lancement.');
  console.log('  Les tests ci-dessous ne dependent pas de la config.');
} else {
  ok('Toutes les variables sont presentes');
}

// ---- 2. Commandes ----------------------------------------------------
console.log('\n[2] Commandes slash');
const builders = Object.values(FEATURES).flatMap((m) => m.commands);
const seen = new Set();
for (const b of builders) {
  const j = b.toJSON();
  if (seen.has(j.name)) ko(`doublon : /${j.name}`);
  seen.add(j.name);
  if (!j.description) ko(`/${j.name} sans description`);
}
ok(`${seen.size} commandes, JSON valide, pas de doublon`);

console.log('\n[3] Permissions declarees');
for (const b of builders) {
  if (!b.toJSON().default_member_permissions) ko(`/${b.name} sans setDefaultMemberPermissions`);
}
ok('toutes les commandes sont masquees par defaut');

// ---- 4. Permissions verifiees a l'execution -------------------------
console.log('\n[4] Permissions verifiees a l execution');
const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const block = src.slice(
  src.indexOf('const REQUIRED_PERMISSIONS'),
  src.indexOf("client.on('interactionCreate'"),
);
const declared = [...block.matchAll(/^\s{2}'?([a-z-]+)'?:/gm)].map((m) => m[1]);
const missing = [...seen].filter((n) => !declared.includes(n));
if (missing.length) ko(`non verifiees a l'execution : ${missing.join(', ')}`);
else ok(`${declared.length} commandes bloquees si permission absente`);
if (!src.includes('memberPermissions?.has(need)')) ko('le controle a l execution est absent');

// ---- 5. Parsing ------------------------------------------------------
console.log('\n[5] Parsing de duree');
for (const [text, expected] of [['30m', 30], ['2h', 120], ['7j', 10080], ['90', 90], ['2h30', 150]]) {
  const got = parseDuration(text);
  got === expected ? ok(`parseDuration('${text}') = ${got}`) : ko(`parseDuration('${text}') = ${got}, attendu ${expected}`);
}
for (const text of ['', 'perm', 'abc', null, undefined]) {
  parseDuration(text) === null
    ? ok(`parseDuration(${JSON.stringify(text)}) = null`)
    : ko(`parseDuration(${JSON.stringify(text)}) devrait etre null`);
}

console.log('\n[6] Rendu des messages');
const fake = { id: '1', user: { username: 'bob', tag: 'bob#1234' } };
const out = render('Bienvenue {user} sur **{server}**, {count} membres ({username})', {
  member: fake,
  guild: { name: 'MonServeur' },
  count: 42,
});
out === 'Bienvenue <@1> sur **MonServeur**, 42 membres (bob)'
  ? ok('variables remplacees')
  : ko(`rendu inattendu : ${out}`);

// ---- 7. Echappement HTML ---------------------------------------------
console.log('\n[7] Echappement HTML (protection XSS)');
const payload = '<script>alert(1)</script>';
esc(payload).includes('<script>') ? ko('le HTML nest pas echappe') : ok('script echappe');
esc('a"b\'c&d') === 'a&quot;b&#39;c&amp;d' ? ok('guillemets et esperluettes echappes') : ko('echappement incomplet');

// ---- 8. Vues ---------------------------------------------------------
console.log('\n[8] Rendu des pages');
const listHtml = guildListPage([{ guild_id: '123', name: 'Test', iconHash: 'abc' }], null);
listHtml.includes('Test') ? ok('liste des serveurs') : ko('liste des serveurs vide');
listHtml.includes('cdn.discordapp.com/icons/123/abc.png') ? ok('URL icone correcte') : ko('URL icone incorrecte');
iconUrl('123', null) === null ? ok('pas d icone -> null') : ko('icone nulle devrait donner null');

const cfg = await import('./features/welcome.js');
void cfg;
const page = guildConfigPage(
  { guild_id: '123', name: 'Test' },
  { welcome_channel: null, tickets_enabled: false, tickets_count: 1 },
  null,
);
page.includes('name="welcome_message"') ? ok('formulaire de config') : ko('champs de config manquants');
page.includes('action="/guild/123/leave"') ? ok('zone dangereuse') : ko('bouton de retrait manquant');

// ---- 9. Coherence colonnes / base -------------------------------------
console.log('\n[9] Coherence avec le schema');
const sql = readFileSync(new URL('../supabase_schema.sql', import.meta.url), 'utf8');
for (const col of ['guild_id', 'icon_hash', 'owner_id', 'last_seen_at']) {
  sql.includes(col) ? ok(`colonne guilds.${col}`) : ko(`colonne guilds.${col} absente du schema`);
}
for (const col of ['welcome_channel', 'tickets_enabled', 'tickets_count', 'autorole_id', 'log_channel']) {
  sql.includes(col) ? ok(`colonne guild_config.${col}`) : ko(`colonne guild_config.${col} absente`);
}
const dbSrc = readFileSync(new URL('./db.js', import.meta.url), 'utf8');
dbSrc.includes('icon_hash') ? ok('db.js ecrit bien icon_hash') : ko('db.js incoherent avec le schema');

console.log('\n' + '='.repeat(55));
if (fail) {
  console.log(`  ${fail} ECHEC(S)`);
  console.log('='.repeat(55));
  process.exit(1);
}
console.log(`  TOUT PASSE — ${seen.size} commandes, ${declared.length} verifiees`);
console.log('='.repeat(55));
