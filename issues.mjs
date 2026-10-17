// Posts a summary of every issue closed in drnachio/postext to #github-feed.
//
//   node issues.mjs                  post issues closed since the last one posted
//   node issues.mjs --dry-run        list what would be posted
//   node issues.mjs --preview <n>    print the summary of issue <n> (no Discord needed)
//
// The summary is built from the issue itself: what was asked (its first paragraph),
// how it was solved (the closing comment), the pull requests that reference it and
// the release it shipped in. Where to resume is read back from #github-feed: the
// most recent summary's closing time, or `issues.since` in the config on the first run.

import { issues as cfg } from './server.config.mjs';
import { alreadyPosted, createClient, loadEnv, readJson, STATE_FILE } from './lib/discord.mjs';
import { github as githubApi } from './lib/github.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const PREVIEW = argv.includes('--preview') ? Number(argv[argv.indexOf('--preview') + 1]) : null;

const COLORS = { completed: 0x2fbf71, not_planned: 0x8b8f98, duplicate: 0x8b8f98 };
const OUTCOME = { completed: '✅ Completed', not_planned: '🚫 Not planned', duplicate: '♊ Duplicate' };

const github = (path) => githubApi(cfg.repo, path);

// ---------- summary ----------

// Meaningful paragraphs of a GitHub markdown text: no headings, quotes, code
// blocks, images, task lists or bookkeeping lines ("Part of #846", "Done in …").
function paragraphs(md = '') {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p
      && !/^#{1,6}\s/.test(p)
      && !/^>/.test(p)
      && !/^!\[/.test(p)
      && !/^[-*] \[[ x]\]/i.test(p)
      && !/^(part of|found by|refs?|see|done in|fixed in|closes|closed by|follow-?up)\b[^.]*\.?$/i.test(p.split('\n')[0])
      && !/^🤖 Generated with/.test(p));
}

// The first paragraph, cut at a sentence end near `max` characters.
function excerpt(md, max) {
  const p = paragraphs(md)[0];
  if (!p) return null;
  // A leading bold label ("**Engine.**") would repeat the section's own label.
  const flat = p.replace(/\s*\n\s*/g, ' ').replace(/^\*\*[^*]{1,40}\*\*[.:]?\s*/, '');
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')) + ' …';
}

function duration(from, to) {
  const days = Math.floor((to - from) / 864e5);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.round((to - from) / 36e5));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

async function summarize(issue) {
  const [comments, timeline] = await Promise.all([
    github(`/issues/${issue.number}/comments?per_page=100`),
    github(`/issues/${issue.number}/timeline?per_page=100`),
  ]);
  const closedAt = new Date(issue.closed_at);
  // The resolution: the last comment written before (or at) the closing.
  const resolution = comments.filter((c) => new Date(c.created_at) <= new Date(closedAt.getTime() + 6e4)).at(-1);

  const prs = new Map();
  let release = null;
  for (const e of timeline) {
    const src = e.event === 'cross-referenced' ? e.source?.issue : null;
    if (!src?.pull_request) continue;
    const version = src.title.match(/^Release v?(\d+\.\d+\.\d+)/i)?.[1];
    if (version) { if (src.pull_request.merged_at) release = version; continue; }
    prs.set(src.number, src);
  }

  const reason = issue.state_reason ?? 'completed';
  const lines = [];
  const asked = excerpt(issue.body, cfg.maxChars);
  if (asked) lines.push(`**The issue.** ${asked}`);
  const solved = resolution && excerpt(resolution.body, cfg.maxChars);
  if (solved) lines.push(`**${reason === 'completed' ? 'The fix' : 'Why it was closed'}.** ${solved}`);
  if (!lines.length) lines.push('_No description._');

  const fields = [{ name: 'Outcome', value: OUTCOME[reason] ?? reason, inline: true }];
  if (reason === 'completed') {
    fields.push({
      name: 'Ships in',
      value: release ? `v${release}` : 'the next release',
      inline: true,
    });
  }
  const labels = issue.labels.map((l) => l.name).filter(Boolean);
  if (labels.length) fields.push({ name: 'Labels', value: labels.join(', '), inline: true });
  if (prs.size) {
    fields.push({
      name: 'Pull requests',
      value: [...prs.values()].slice(-5).map((p) => `[#${p.number}](${p.html_url}) ${p.title}`.slice(0, 200)).join('\n'),
    });
  }

  return {
    title: `Issue #${issue.number} closed: ${issue.title}`.slice(0, 256),
    url: issue.html_url,
    description: lines.join('\n\n'),
    color: COLORS[reason] ?? COLORS.completed,
    fields,
    footer: { text: `Opened by ${issue.user.login} · open for ${duration(new Date(issue.created_at), closedAt)}` },
    timestamp: closedAt.toISOString(),
  };
}

// ---------- main ----------

if (PREVIEW) {
  console.log(JSON.stringify(await summarize(await github(`/issues/${PREVIEW}`)), null, 2));
  process.exit(0);
}

const { token } = loadEnv();
const api = createClient(token);
const { ids } = readJson(STATE_FILE, { ids: { channels: {} } });
const channelId = process.env.GITHUB_FEED_CHANNEL_ID ?? ids.channels['github-feed'];
if (!channelId) {
  console.error('No #github-feed channel ID. Run `node setup.mjs` first or set GITHUB_FEED_CHANNEL_ID.');
  process.exit(1);
}

// Where to resume: the latest closing already posted (summaries carry it as their timestamp).
const me = await api('GET', '/users/@me');
const recent = await api('GET', `/channels/${channelId}/messages?limit=100`);
const postedKeys = new Set();
let cursor = new Date(cfg.since);
for (const m of recent) {
  if (m.author.id !== me.id) continue;
  for (const e of m.embeds ?? []) {
    const n = e.title?.match(/^Issue #(\d+) closed/)?.[1];
    if (!n) continue;
    postedKeys.add(`${n}@${new Date(e.timestamp).toISOString()}`);
    if (e.timestamp && new Date(e.timestamp) > cursor) cursor = new Date(e.timestamp);
  }
}

// Issues (not pull requests) closed after the cursor, oldest first.
const closed = [];
for (let page = 1; ; page++) {
  const batch = await github(`/issues?state=closed&sort=updated&direction=desc&per_page=100&page=${page}&since=${cursor.toISOString()}`);
  closed.push(...batch.filter((i) => !i.pull_request && new Date(i.closed_at) >= cursor));
  if (batch.length < 100) break;
}
const pending = closed
  .filter((i) => !postedKeys.has(`${i.number}@${new Date(i.closed_at).toISOString()}`))
  .sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at));

if (!pending.length) {
  console.log(`No newly closed issues (since ${cursor.toISOString()}).`);
  process.exit(0);
}

for (const issue of pending) {
  console.log(`${DRY ? '[dry-run] ' : ''}post #${issue.number} ${issue.title}`);
  if (DRY) continue;
  const embed = await summarize(issue);
  if (await alreadyPosted(api, channelId, me.id, embed.title)) { console.log('  already posted by another run'); continue; }
  await api('POST', `/channels/${channelId}/messages`, {
    embeds: [embed],
    allowed_mentions: { parse: [] },
  });
}
