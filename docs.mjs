// Announces in #docs-and-translations the versions of Postext that improve the
// documentation or the translations: a new language, new doc pages, updated
// pages, translated cookbook recipes. Versions that touch neither are skipped.
//
//   node docs.mjs                   post versions not announced yet
//   node docs.mjs --dry-run         list what would be posted
//   node docs.mjs --preview <tag>   print the notice for one version (no Discord needed)
//
// Each version is compared with the previous tag: docs/<topic>-<lang>.mdx,
// apps/web/messages/<lang>.json and cookbook write-ups (*.<lang>.md). Where to
// resume is read back from the channel (the latest version announced) or
// `docs.since` in the config on the first run.

import { docs as cfg } from './server.config.mjs';
import { alreadyPosted, createClient, loadEnv, readJson, STATE_FILE } from './lib/discord.mjs';
import { compareVersions, github, versionTags } from './lib/github.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const PREVIEW = argv.includes('--preview') ? argv[argv.indexOf('--preview') + 1] : null;

const COLOR = 0x14b8c4;
const languageName = (code) => new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
const DOC_RE = /^docs\/([a-z0-9-]+)-([a-z]{2})\.mdx$/;
const MESSAGES_RE = /^apps\/web\/messages\/([a-z]{2})\.json$/;
const COOKBOOK_RE = /^cookbook\/.+\.([a-z]{2})\.md$/;
// Edits to these metadata lines alone are not an improvement.
const TRIVIAL_LINE = /^[+-]\s*(lastUpdated|readingTime):/;

function meaningfulPatch(file) {
  if (!file.patch) return true; // too large to show: assume it matters
  return file.patch.split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .some((l) => !TRIVIAL_LINE.test(l) && l.slice(1).trim());
}

async function docMeta(topic, lang, ref) {
  try {
    const file = await github(cfg.repo, `/contents/docs/${topic}-${lang}.mdx?ref=${ref}`);
    const src = Buffer.from(file.content, 'base64').toString('utf8');
    const field = (k) => src.match(new RegExp(`${k}:\\s*(['"\`])([\\s\\S]*?)\\1\\s*,`))?.[2];
    return { title: field('sidebarTitle') ?? field('title') ?? topic, summary: field('plainSummary') ?? field('description') };
  } catch {
    return { title: topic, summary: null };
  }
}

// Docs, site translations and cookbook files of a version: path → blob SHA.
// The full tree, unlike the compare endpoint, has no 300-file limit.
async function filesAt(ref) {
  const tree = await github(cfg.repo, `/git/trees/${ref}?recursive=1`);
  if (tree.truncated) throw new Error(`Tree of ${ref} is truncated`);
  return new Map(tree.tree
    .filter((e) => e.type === 'blob' && (DOC_RE.test(e.path) || MESSAGES_RE.test(e.path) || COOKBOOK_RE.test(e.path)))
    .map((e) => [e.path, e.sha]));
}

const languagesIn = (files) => new Set([...files.keys()].map((p) => p.match(MESSAGES_RE)?.[1]).filter(Boolean));

const docUrl = (topic) => `https://postext.dev/en/docs/${topic}`;
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

// The notice for one version, or null when nothing in it concerns docs or translations.
async function notice(tag, prev) {
  const [cmp, oldFiles, newFiles] = await Promise.all([
    github(cfg.repo, `/compare/${prev}...${tag}`), filesAt(prev), filesAt(tag),
  ]);
  // Patches from the compare endpoint (at most 300 files) only serve to ignore
  // metadata-only edits; the list of changed files comes from the two trees.
  const patches = new Map((cmp.files ?? []).map((f) => [f.filename, f]));
  const files = [];
  for (const [path, sha] of newFiles) {
    if (!oldFiles.has(path)) files.push({ filename: path, status: 'added' });
    else if (oldFiles.get(path) !== sha) files.push({ filename: path, status: 'modified', patch: patches.get(path)?.patch });
  }

  const added = (re) => files.filter((f) => f.status === 'added' && re.test(f.filename));
  const changed = (re) => files.filter((f) => f.status === 'modified' && re.test(f.filename) && meaningfulPatch(f));

  // New languages: a new site translation.
  const before = languagesIn(oldFiles);
  const after = languagesIn(newFiles);
  const newLanguages = [...after].filter((l) => !before.has(l));
  const docLangsAdded = new Map();
  for (const f of added(DOC_RE)) {
    const [, , lang] = f.filename.match(DOC_RE);
    docLangsAdded.set(lang, (docLangsAdded.get(lang) ?? 0) + 1);
  }

  // New pages (a topic whose English page appeared) and updated pages.
  const newTopics = added(DOC_RE).map((f) => f.filename.match(DOC_RE)).filter((m) => m[2] === 'en').map((m) => m[1]);
  const updated = new Map();
  for (const f of changed(DOC_RE)) {
    const [, topic, lang] = f.filename.match(DOC_RE);
    if (newTopics.includes(topic)) continue;
    if (!updated.has(topic)) updated.set(topic, new Set());
    updated.get(topic).add(lang);
  }

  // Cookbook write-ups added per language (English ones are new recipes, not translations).
  const recipes = new Map();
  for (const f of added(COOKBOOK_RE)) {
    const lang = f.filename.match(COOKBOOK_RE)[1];
    recipes.set(lang, (recipes.get(lang) ?? 0) + 1);
  }

  // What the docs commits say.
  const notes = cmp.commits
    .map((c) => c.commit.message.split('\n')[0])
    .filter((s) => /^docs(\([^)]*\))?!?:/.test(s))
    // Internal design notes (DESIGN.md) are not user documentation.
    .filter((s) => !/^docs\(design\)|\bDESIGN\b|§\s?\d/.test(s))
    .map((s) => s.replace(/^docs(\(([^)]*)\))?!?:\s*/, (_, __, scope) => (scope ? `**${scope}** — ` : '')))
    .map((s) => s.replace(/\s*\((?:refs?\s*)?#\d+(?:,\s*#\d+)*\)\s*$/i, ''))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));

  const translatedUi = changed(MESSAGES_RE).map((f) => f.filename.match(MESSAGES_RE)[1]).filter((l) => !newLanguages.includes(l));
  if (!newLanguages.length && !newTopics.length && !updated.size && !notes.length && ![...recipes.keys()].some((l) => l !== 'en')) {
    return null;
  }

  const lines = [];
  for (const lang of newLanguages) {
    const docs = docLangsAdded.get(lang);
    const recs = recipes.get(lang);
    const parts = ['the website'];
    if (docs) parts.push(`${docs} documentation page${docs === 1 ? '' : 's'}`);
    if (recs) parts.push(`${recs} cookbook recipe${recs === 1 ? '' : 's'}`);
    const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)} are` : `${parts[0]} is`;
    lines.push(`🌍 **New language: ${languageName(lang)}.** ${what.charAt(0).toUpperCase() + what.slice(1)} now available in ${languageName(lang)}.`);
  }
  for (const [lang, n] of docLangsAdded) {
    if (newLanguages.includes(lang) || lang === 'en' || n < 5) continue;
    lines.push(`🌍 **${n} documentation pages translated into ${languageName(lang)}.**`);
  }
  if (newTopics.length) {
    lines.push('', '### 🆕 New pages');
    for (const topic of newTopics) {
      const meta = await docMeta(topic, 'en', tag);
      lines.push(`• [${meta.title}](${docUrl(topic)})${meta.summary ? ` — ${trim(meta.summary, 300)}` : ''}`);
    }
  }
  if (updated.size) {
    lines.push('', '### ✏️ Updated pages');
    const entries = [...updated.entries()].sort((a, b) => b[1].size - a[1].size);
    for (const [topic, langs] of entries.slice(0, 12)) {
      const meta = await docMeta(topic, 'en', tag);
      const where = langs.size >= after.size ? 'in every language' : `in ${[...langs].map(languageName).join(', ')}`;
      lines.push(`• [${meta.title}](${docUrl(topic)}) ${where}`);
    }
    if (entries.length > 12) lines.push(`• …and ${entries.length - 12} more pages`);
  }
  if (notes.length) {
    lines.push('', '### 📝 What changed');
    for (const n of notes.slice(0, 15)) lines.push(`• ${n}`);
    if (notes.length > 15) lines.push(`• …and ${notes.length - 15} more documentation changes`);
  }
  const recipeLines = [...recipes.entries()].filter(([l]) => l !== 'en' && !newLanguages.includes(l));
  if (recipeLines.length) {
    lines.push('', '### 🍳 Cookbook');
    lines.push(`• Recipes translated: ${recipeLines.map(([l, n]) => `${n} into ${languageName(l)}`).join(', ')}`);
  }
  if (translatedUi.length) {
    const ui = translatedUi.length >= after.size ? 'in every language' : `in ${translatedUi.map(languageName).join(', ')}`;
    lines.push('', `🗣️ Website text updated ${ui}.`);
  }
  lines.push('', `📖 [Read the documentation](https://postext.dev/en/docs/introduction) · 🔗 [Changes in ${tag}](https://github.com/${cfg.repo}/compare/${prev}...${tag})`);

  const description = lines.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
  const release = cmp.commits.find((c) => c.commit.message.startsWith(`chore: release ${tag}`));
  return {
    title: `Docs & translations in Postext ${tag}`,
    url: `https://github.com/${cfg.repo}/compare/${prev}...${tag}`,
    description: description.length > 4000 ? description.slice(0, 3990).replace(/\n[^\n]*$/, '') + '\n…' : description,
    color: COLOR,
    timestamp: new Date((release ?? cmp.commits.at(-1)).commit.committer.date).toISOString(),
  };
}

// ---------- main ----------

const tags = await versionTags(cfg.repo);

if (PREVIEW) {
  const i = tags.indexOf(PREVIEW);
  if (i < 1) throw new Error(`Unknown or first version: ${PREVIEW}`);
  const embed = await notice(tags[i], tags[i - 1]);
  console.log(embed ? `# ${embed.title}\n\n${embed.description}` : `${PREVIEW}: nothing about docs or translations.`);
  process.exit(0);
}

const { token } = loadEnv();
const api = createClient(token);
const { ids } = readJson(STATE_FILE, { ids: { channels: {} } });
const channelId = process.env.DOCS_CHANNEL_ID ?? ids.channels['docs-and-translations'];
if (!channelId) {
  console.error('No #docs-and-translations channel ID. Run `node setup.mjs` first or set DOCS_CHANNEL_ID.');
  process.exit(1);
}

// The latest version announced (people talk in this channel too: only the bot's notices count).
const me = await api('GET', '/users/@me');
let last = cfg.since;
for (const m of await api('GET', `/channels/${channelId}/messages?limit=100`)) {
  if (m.author.id !== me.id) continue;
  for (const e of m.embeds ?? []) {
    const v = e.title?.match(/^Docs & translations in Postext (v\d+\.\d+\.\d+)$/)?.[1];
    if (v && compareVersions(v, last) > 0) last = v;
  }
}

// Versions after the last one announced; versions without docs changes are checked again
// on later runs, so only the latest few are looked at.
const pending = tags.filter((t) => compareVersions(t, last) > 0).slice(-cfg.maxVersionsPerRun);
let posted = 0;
for (const tag of pending) {
  const embed = await notice(tag, tags[tags.indexOf(tag) - 1]);
  if (!embed) continue;
  posted++;
  console.log(`${DRY ? '[dry-run] ' : ''}post ${embed.title}`);
  if (DRY) continue;
  if (await alreadyPosted(api, channelId, me.id, embed.title)) { console.log('  already posted by another run'); continue; }
  await api('POST', `/channels/${channelId}/messages`, { embeds: [embed], allowed_mentions: { parse: [] } });
}
if (!posted) console.log(`No docs or translation changes to announce (${pending.length} version(s) checked after ${last}).`);
