// Posts release notes for every published version of Postext to #releases.
//
//   node releases.mjs                  post versions that aren't in #releases yet
//   node releases.mjs --backfill       first run: post the whole history (no pings, no cross-posting)
//   node releases.mjs --dry-run        list what would be posted
//   node releases.mjs --preview <dir>  write the rendered notes to <dir> (no Discord needed)
//
// A version is a vX.Y.Z tag. Postext's release workflow only pushes it after
// build, tests and the npm publish succeed, so failed releases never get a note.
// The notes are built from the commits between a tag and the previous one.
// Stateless like youtube.mjs: what's already posted is read back from #releases.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { releases as cfg } from './server.config.mjs';
import { alreadyPosted, createClient, loadEnv, readJson, STATE_FILE } from './lib/discord.mjs';
import { github as githubApi, versionTags as repoVersionTags } from './lib/github.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const BACKFILL = argv.includes('--backfill');
const PREVIEW = argv.includes('--preview') ? argv[argv.indexOf('--preview') + 1] : null;

const COLOR = 0xf2c230;
const DESC_LIMIT = 4000; // embed descriptions max out at 4096
// ---------- GitHub ----------

const github = (path) => githubApi(cfg.repo, path);
const versionTags = () => repoVersionTags(cfg.repo);

async function commitsFor(tag, prev) {
  if (prev) return (await github(`/compare/${prev}...${tag}`)).commits;
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await github(`/commits?sha=${tag}&per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.reverse();
}

// ---------- notes ----------

const SECTIONS = [
  { key: 'features', title: '✨ New features', types: ['feat'] },
  { key: 'performance', title: '⚡ Performance', types: ['perf'] },
  { key: 'improvements', title: '🔧 Improvements', types: ['refactor', 'style', 'improve'] },
  { key: 'fixes', title: '🐛 Bug fixes', types: ['fix'] },
  { key: 'skill', title: '🤖 Agent skill', types: ['skill'] },
  { key: 'content', title: '🍳 Cookbook, sandbox & presets', types: ['cookbook', 'sandbox', 'presets'] },
  { key: 'docs', title: '📖 Documentation', types: ['docs'] },
];
const TYPE_TO_SECTION = Object.fromEntries(SECTIONS.flatMap((s) => s.types.map((t) => [t, s.key])));

function parseCommit(message) {
  const subject = message.split('\n')[0].trim();
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  const type = m ? m[1].toLowerCase() : null;
  let text = m ? m[4] : subject;
  const prs = [...text.matchAll(/#(\d+)/g)].map((x) => Number(x[1]));
  text = text.replace(/\s*\((?:refs?|closes|fixes)?\s*#\d+(?:,\s*#\d+)*\)\s*$/i, '').trim();
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return { type, scope: m?.[2] ?? null, breaking: !!m?.[3], text, prs };
}

function buildNotes(tag, prev, commits) {
  const version = tag.slice(1);
  const release = commits.find((c) => c.commit.message.startsWith(`chore: release ${tag}`));
  const date = new Date((release ?? commits.at(-1))?.commit.committer.date ?? Date.now());
  const packages = release?.commit.message.match(/\(([^)]*v\d[^)]*)\)/)?.[1]
    .split(',').map((p) => p.trim()).filter(Boolean) ?? [];

  const prs = new Set();
  const groups = Object.fromEntries(SECTIONS.map((s) => [s.key, []]));
  let maintenance = 0;
  for (const c of commits) {
    const msg = c.commit.message;
    const merge = msg.match(/^Merge pull request #(\d+)/);
    if (merge) { prs.add(Number(merge[1])); continue; }
    if (c.parents.length > 1 || /^chore: release /.test(msg) || /^Merge /.test(msg)) continue;
    const p = parseCommit(msg);
    p.prs.forEach((n) => prs.add(n));
    const section = TYPE_TO_SECTION[p.type];
    if (!section) { maintenance++; continue; }
    const scope = p.scope ? `**${p.scope}** — ` : '';
    groups[section].push(`• ${p.breaking ? '⚠️ **Breaking:** ' : ''}${scope}${p.text}`);
  }

  const compareUrl = prev
    ? `https://github.com/${cfg.repo}/compare/${prev}...${tag}`
    : `https://github.com/${cfg.repo}/commits/${tag}`;

  const head = [`Released <t:${Math.floor(date / 1000)}:D> · \`npm install postext@${version}\``];
  if (packages.length) head.push(`Also published: ${packages.join(' · ')}`);
  const lines = [head.join('\n'), ''];

  // Hand-written notes for a version win over the generated ones.
  const override = new URL(`./content/releases/${tag}.md`, import.meta.url);
  if (existsSync(override)) {
    lines.push(readFileSync(override, 'utf8').trim(), '');
    lines.push(`🔗 [Full changelog](${compareUrl})`);
    return { version, tag, date, compareUrl, text: lines.join('\n').trim() };
  }

  const userFacing = SECTIONS.reduce((n, s) => n + groups[s.key].length, 0);
  if (!prev) {
    lines.push('The first version of Postext published on npm.', '');
  }
  if (!userFacing && !maintenance) {
    lines.push('Maintenance release: the packages were republished with no code changes.', '');
  }
  for (const s of SECTIONS) {
    // The first version carries the whole pre-release history: keep it to features.
    if (!prev && s.key !== 'features') continue;
    if (!groups[s.key].length) continue;
    lines.push(`### ${s.title}`, ...groups[s.key], '');
  }
  const footer = [];
  if (maintenance && prev) footer.push(`🧰 Plus ${maintenance} test, CI and maintenance change${maintenance === 1 ? '' : 's'}.`);
  if (!prev) {
    const fixes = groups.fixes.length;
    if (fixes) footer.push(`🐛 Plus ${fixes} fixes along the way.`);
  }
  const prLinks = [...prs].sort((a, b) => a - b).slice(-6)
    .map((n) => `[#${n}](https://github.com/${cfg.repo}/pull/${n})`);
  footer.push(`🔗 [Full changelog](${compareUrl})${prLinks.length ? ` · Pull requests: ${prLinks.join(', ')}` : ''}`);
  lines.push(...footer);

  return { version, tag, date, compareUrl, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

// Split the notes on line boundaries into embed-sized chunks.
function toMessages(notes) {
  const chunks = [];
  let cur = '';
  for (const line of notes.text.split('\n')) {
    if ((cur + '\n' + line).length > DESC_LIMIT) { chunks.push(cur.trim()); cur = ''; }
    // A section heading carries over when a list is cut in two.
    cur += (cur ? '\n' : '') + line;
  }
  if (cur.trim()) chunks.push(cur.trim());

  const max = cfg.maxMessagesPerVersion;
  if (chunks.length > max) {
    const kept = chunks.slice(0, max);
    const dropped = chunks.slice(max).join('\n').split('\n').filter((l) => l.startsWith('•')).length;
    kept[max - 1] += `\n\n…and ${dropped} more changes in the [full changelog](${notes.compareUrl}).`;
    chunks.splice(0, chunks.length, ...kept);
  }
  return chunks.map((description, i) => ({
    title: i === 0 ? `Postext v${notes.version}` : `Postext v${notes.version} (continued, ${i + 1}/${chunks.length})`,
    url: i === 0 ? notes.compareUrl : undefined,
    description,
    color: COLOR,
    timestamp: i === 0 ? notes.date.toISOString() : undefined,
  }));
}

// ---------- main ----------

const tags = await versionTags();
const rendered = [];
for (let i = 0; i < tags.length; i++) rendered.push({ tag: tags[i], prev: tags[i - 1] ?? null });

if (PREVIEW) {
  mkdirSync(PREVIEW, { recursive: true });
  for (const r of rendered) {
    const embeds = toMessages(buildNotes(r.tag, r.prev, await commitsFor(r.tag, r.prev)));
    writeFileSync(`${PREVIEW}/${r.tag}.md`, embeds.map((e) => `# ${e.title}\n\n${e.description}`).join('\n\n---\n\n'));
  }
  console.log(`Wrote ${rendered.length} versions to ${PREVIEW}`);
  process.exit(0);
}

const { token } = loadEnv();
const api = createClient(token);
const { ids } = readJson(STATE_FILE, { ids: { channels: {}, roles: {} } });
const channelId = process.env.RELEASES_CHANNEL_ID ?? ids.channels.releases;
const pingRoleId = process.env.RELEASE_PINGS_ROLE_ID ?? ids.roles.releasePings;
if (!channelId) {
  console.error('No #releases channel ID. Run `node setup.mjs` first or set RELEASES_CHANNEL_ID.');
  process.exit(1);
}

// Versions already posted, read back from the bot's own messages.
const me = await api('GET', '/users/@me');
const posted = new Set();
let before = null;
for (;;) {
  const page = await api('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
  for (const m of page) {
    if (m.author.id !== me.id) continue;
    for (const e of m.embeds ?? []) {
      const v = e.title?.match(/^Postext v(\d+\.\d+\.\d+)/)?.[1];
      if (v) posted.add(v);
    }
  }
  if (page.length < 100) break;
  before = page.at(-1).id;
}

const pending = rendered.filter((r) => !posted.has(r.tag.slice(1)));
if (!pending.length) {
  console.log(`No new versions (${tags.length} tagged, all posted).`);
  process.exit(0);
}
if (!posted.size && pending.length > 1 && !BACKFILL) {
  console.error(`#releases is empty and ${pending.length} versions exist. Run once with --backfill to post the history.`);
  process.exit(1);
}

for (const r of pending) {
  const notes = buildNotes(r.tag, r.prev, await commitsFor(r.tag, r.prev));
  const embeds = toMessages(notes);
  const fresh = Date.now() - notes.date < cfg.pingIfNewerThanHours * 36e5;
  const ping = !BACKFILL && fresh && pingRoleId;
  console.log(`${DRY ? '[dry-run] ' : ''}post ${r.tag} (${embeds.length} message${embeds.length === 1 ? '' : 's'})${ping ? ' (ping)' : ''}`);
  if (DRY) continue;
  if (await alreadyPosted(api, channelId, me.id, embeds[0].title)) { console.log('  already posted by another run'); continue; }
  for (const [i, embed] of embeds.entries()) {
    const msg = await api('POST', `/channels/${channelId}/messages`, {
      content: i === 0 && ping ? `<@&${pingRoleId}>` : undefined,
      embeds: [embed],
      allowed_mentions: { roles: i === 0 && ping ? [pingRoleId] : [] },
    });
    // Followers get new versions; the backfill isn't cross-posted (10 per hour limit).
    if (!BACKFILL) await api('POST', `/channels/${channelId}/messages/${msg.id}/crosspost`).catch(() => {});
  }
}
