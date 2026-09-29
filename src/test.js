// Verification hors ligne : parsing, perms, commandes, schema JSON.
// N'appelle pas Discord. Usage: npm test

import { readFileSync } from 'node:fs';
import * as audit from './commands/audit.js';
import * as moderation from './commands/moderation.js';
import * as grades from './commands/grades.js';
import * as members from './commands/members.js';
import * as recruitment from './commands/recruitment.js';
import * as tickets from './commands/tickets.js';
import { parseDuration, fmtDuration } from './helpers.js';
import { config, validate } from './config.js';

const MODULES = { audit, moderation, grades, members, recruitment, tickets };
let failures = 0;

const ok = (label) => console.log(`    [OK] ${label}`);
const ko = (label, extra = '') => {
  console.log(`    [KO] ${label} ${extra}`);
  failures += 1;
};

console.log('='.repeat(55));
console.log('  HOOVERS - Test hors ligne');
console.log('='.repeat(55));

console.log('\n[1] Configuration');
const problems = validate();
if (problems.length) {
  problems.forEach((p) => ko(p));
} else {
  ok(`GUILD_ID  = ${config.guildId}`);
  ok(`CLIENT_ID = ${config.clientId}`);
  ok(`OWNER_IDS = ${config.ownerIds.join(', ')}`);
}

console.log('\n[2] Commandes et JSON');
const all = [];
for (const [name, mod] of Object.entries(MODULES)) {
  for (const builder of mod.commands) {
    all.push([name, builder]);
  }
}
console.log(`    ${all.length} commandes declarees`);

const seen = new Set();
for (const [mod, builder] of all) {
  try {
    const json = builder.toJSON();
    if (seen.has(json.name)) ko(`doublon de nom : /${json.name}`);
    else seen.add(json.name);
    if (!json.description) ko(`/${json.name} sans description`);
  } catch (e) {
    ko(`/${builder.name} JSON invalide`, e.message);
  }
}
ok(`${seen.size} commandes uniques, JSON valide`);

console.log('\n[3] Permissions par defaut (visibilite)');
const NEED_PERMS = [
  'warn', 'mute', 'kick', 'ban', 'unwarn', 'unmute', 'sanctions',
  'panel', 'grade', 'init', 'promote', 'demote',
  'ajouter', 'candidatures', 'setup-tickets', 'tickets',
  'setup-recrutement', 'postuler-bouton',
];
for (const [mod, builder] of all) {
  const name = builder.name;
  if (!NEED_PERMS.includes(name)) continue;
  if (!builder.toJSON().default_member_permissions) {
    ko(`/${name} n'a pas setDefaultMemberPermissions`);
  }
}
ok(`${NEED_PERMS.length} commandes sensibles masquees par defaut`);

console.log('\n[3b] Permissions reellement verifiees a l execution');
const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('const REQUIRED_PERMISSIONS'), src.indexOf('client.on(\'interactionCreate\''));
const declared = [...block.matchAll(/^\s{2}'?([a-z-]+)'?:/gm)].map((m) => m[1]);
const missing = NEED_PERMS.filter((n) => !declared.includes(n));
if (missing.length) ko(`non verifiees a l'execution : ${missing.join(', ')}`);
else ok(`${declared.length} commandes verifiees avant execution`);
if (!src.includes('memberPermissions?.has(need)')) ko('le controle memberPermissions est absent');

console.log('\n[4] Parsing de duree');
const CASES = [
  ['30m', 30], ['2h', 120], ['7j', 10080], ['1j12h', 2160],
  ['90', 90], ['2h30', 150],
];
for (const [text, expected] of CASES) {
  const got = parseDuration(text);
  got === expected ? ok(`parseDuration('${text}') = ${got}`) : ko(`parseDuration('${text}') = ${got}, attendu ${expected}`);
}
for (const text of ['', 'perm', 'inf', 'abc', '5x', null, undefined]) {
  const got = parseDuration(text);
  got === null ? ok(`parseDuration('${text ?? 'null'}') = null`) : ko(`parseDuration('${text}') = ${got}, attendu null`);
}

console.log('\n[5] Formatage de duree');
const FORMATS = [[90, '1h30m'], [1440, '1j'], [45, '45m'], [null, 'definitif']];
for (const [input, expected] of FORMATS) {
  const got = fmtDuration(input);
  got === expected ? ok(`fmtDuration(${input}) = ${got}`) : ko(`fmtDuration(${input}) = ${got}, attendu ${expected}`);
}

console.log('\n[6] Exports requis');
const EXPECTED_EXPORTS = {
  audit: ['commands', 'handle'],
  moderation: ['commands', 'handle', 'sweepExpiredMutes'],
  grades: ['commands', 'handle', 'applyRank', 'buildRankSelect', 'rankLine'],
  members: ['commands', 'handle'],
  recruitment: ['commands', 'handle', 'applicationModal', 'reviewRow', 'postApplyButton'],
  tickets: ['commands', 'handle', 'createTicket', 'closeTicket', 'openButton'],
};
for (const [mod, names] of Object.entries(EXPECTED_EXPORTS)) {
  for (const n of names) {
    MODULES[mod][n] ? ok(`cogs.${mod}.${n}`) : ko(`cogs.${mod}.${n} manquant`);
  }
}

console.log('\n' + '='.repeat(55));
if (failures) {
  console.log(`  ${failures} ECHEC(S) — corriger avant de deployer`);
  console.log('='.repeat(55));
  process.exit(1);
}
console.log(`  TOUT PASSE — ${seen.size} commandes, ${NEED_PERMS.length} protegees`);
console.log('='.repeat(55));
