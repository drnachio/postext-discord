// Announces new Postext videos in #videos, in every language, always in English.
//
//   node youtube.mjs              post videos that aren't in #videos yet
//   node youtube.mjs --dry-run    list what would be posted
//   node youtube.mjs --rebuild    delete the video posts in #videos and post every video again,
//                                 oldest first (no pings, no cross-posting)
//
// Each language has its own playlist (`youtube.playlists` in the config). The videos are
// read from each playlist's page, which lists all of them; YouTube's feeds stop at 15
// per playlist. A translation is announced with the title of its English original: from
// the "🇬🇧 English → …" (or "English version → …") link in its description, its (n/m)
// part number, or content/video-map.json. Stateless: what's already posted is read back
// from #videos.

import { readFileSync } from 'node:fs';
import { youtube as yt } from './server.config.mjs';
import { createClient, loadEnv, readJson, STATE_FILE } from './lib/discord.mjs';

const DRY = process.argv.includes('--dry-run');
const REBUILD = process.argv.includes('--rebuild');
const { token } = loadEnv();
const api = createClient(token);
const { ids } = readJson(STATE_FILE, { ids: { channels: {}, roles: {} } });
const channelId = process.env.VIDEOS_CHANNEL_ID ?? ids.channels.videos;
const pingRoleId = process.env.VIDEO_PINGS_ROLE_ID ?? ids.roles.videoPings;
if (!channelId) {
  console.error('No #videos channel ID. Run `node setup.mjs` first or set VIDEOS_CHANNEL_ID.');
  process.exit(1);
}
const videoMap = JSON.parse(readFileSync(new URL('./content/video-map.json', import.meta.url), 'utf8'));
const languageOf = new Map(yt.playlists.map((p) => [p.id, p.language]));

const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' };
const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
// "(2/4)" and "（2/4）" are the same part.
const partOf = (title) => title.normalize('NFKC').match(/\((\d+)\/(\d+)\)/)?.[0] ?? null;
// The English original a translation links to, in its description.
const englishLink = (description) =>
  description.match(/(?:🇬🇧|English)[^\n]*?youtu\.be\/([\w-]{11})/)?.[1] ?? null;
// The language playlist a video's description points to ("▶ All Postext videos in … → …list=…").
const playlistLink = (description) => description.match(/playlist\?list=([\w-]+)/)?.[1] ?? null;

// ---------- YouTube ----------

function initialData(html, name) {
  const m = html.match(new RegExp(`(?:var |window\\["?)${name}"?\\]?\\s*=\\s*(\\{.*?\\});(?:var |</script>)`, 's'));
  return m ? JSON.parse(m[1]) : null;
}

function walk(node, visit) {
  if (Array.isArray(node)) for (const x of node) walk(x, visit);
  else if (node && typeof node === 'object') { visit(node); for (const x of Object.values(node)) walk(x, visit); }
}

// Every video of a playlist, from its page: [{ id, title }] in playlist order.
async function playlistPage(id) {
  const res = await fetch(`https://www.youtube.com/playlist?list=${id}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`playlist page ${id} → ${res.status}`);
  const data = initialData(await res.text(), 'ytInitialData');
  if (!data) throw new Error(`playlist page ${id}: no data`);
  const videos = [];
  walk(data, (o) => {
    const l = o.lockupViewModel;
    if (l?.contentId?.length === 11 && /VIDEO/.test(l.contentType ?? 'VIDEO')) {
      videos.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content ?? null });
    }
    const r = o.playlistVideoRenderer;
    if (r?.videoId) videos.push({ id: r.videoId, title: r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? null });
  });
  return [...new Map(videos.map((v) => [v.id, v])).values()];
}

// A feed's entries (at most the 15 newest): [{ id, title, description, published }].
async function feed(query) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?${query}`);
  if (!res.ok) throw new Error(`feed ${query} → ${res.status}`);
  return [...(await res.text()).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: e.match(/<yt:videoId>([^<]+)/)[1],
    title: decode(e.match(/<title>([^<]+)/)[1]),
    description: decode(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? ''),
    published: new Date(e.match(/<published>([^<]+)/)[1]),
  }));
}

// Title, description and date of one video, from its page (for videos no feed shows).
async function watchPage(id) {
  const res = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: HEADERS });
  const player = res.ok ? initialData(await res.text(), 'ytInitialPlayerResponse') : null;
  const details = player?.videoDetails;
  if (!details) return null;
  const date = player.microformat?.playerMicroformatRenderer?.publishDate;
  return { title: details.title, description: details.shortDescription ?? '', published: date ? new Date(date) : null };
}

async function oembedTitle(id) {
  const res = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`);
  return res.ok ? (await res.json()).title : null;
}

// ---------- what's on YouTube ----------

const videos = new Map(); // id → { id, title, description, published, language }
const merge = (v) => videos.set(v.id, { ...videos.get(v.id), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x != null)) });

for (const p of yt.playlists) {
  const pageVideos = await playlistPage(p.id).catch((e) => { console.warn(`⚠ ${e.message}; using its feed (15 newest)`); return null; });
  const feedVideos = await feed(`playlist_id=${p.id}`).catch(() => []);
  for (const v of pageVideos ?? feedVideos) merge({ id: v.id, title: v.title, language: p.language });
  for (const v of feedVideos) merge({ ...v, language: p.language });
}
// The channel's newest uploads, with their descriptions: catches a video not yet in any playlist.
for (const v of await feed(`channel_id=${yt.channelId}`).catch(() => [])) {
  const language = videos.get(v.id)?.language ?? languageOf.get(playlistLink(v.description));
  if (!language) {
    const list = playlistLink(v.description);
    console.warn(`⚠ ${v.id} "${v.title}" is in no configured playlist${list ? ` (its description points to ${list}: add it to youtube.playlists)` : ''}`);
    continue;
  }
  merge({ ...v, language });
}

const englishTitles = new Map([...videos.values()].filter((v) => v.language === 'English').map((v) => [v.id, v.title]));
const englishByPart = new Map([...videos.values()]
  .filter((v) => v.language === 'English' && v.title && partOf(v.title)).map((v) => [partOf(v.title), v.title]));

async function englishTitle(v) {
  if (v.language === 'English') return v.title;
  const original = englishLink(v.description ?? '') ?? videoMap[v.id];
  if (original) return englishTitles.get(original) ?? await oembedTitle(original);
  return (v.title && englishByPart.get(partOf(v.title))) ?? null;
}

// The announcement, always in English.
async function line(v) {
  const title = await englishTitle(v);
  if (v.language === 'English') return `🎬 **${title}**`;
  return title ? `🎬 **${title}** · 🌐 ${v.language} version` : `🎬 New video in ${v.language}`;
}

// ---------- what's in #videos ----------

const me = await api('GET', '/users/@me');
const posts = [];
let before = null;
for (;;) {
  const page = await api('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
  posts.push(...page.filter((m) => m.author.id === me.id && /youtu\.be\/[\w-]{11}/.test(m.content)));
  if (page.length < 100) break;
  before = page.at(-1).id;
}

if (REBUILD) {
  console.log(`${DRY ? '[dry-run] ' : ''}delete ${posts.length} video posts in #videos`);
  if (!DRY) for (const m of posts) await api('DELETE', `/channels/${channelId}/messages/${m.id}`);
  posts.length = 0;
}

const posted = new Set(posts.flatMap((m) => [...m.content.matchAll(/youtu\.be\/([\w-]{11})/g)].map((x) => x[1])));
const byLine = new Map();
for (const m of posts) {
  const l = m.content.replace(/^<@&\d+>\s*/, '').split('\n')[0];
  if (!byLine.has(l)) byLine.set(l, m);
}

// New videos, completed from their page when no feed carried their description.
const fresh = [];
for (const v of videos.values()) {
  if (posted.has(v.id)) continue;
  if (v.description == null || !v.published) {
    const page = await watchPage(v.id);
    if (!page) { console.warn(`⚠ ${v.id}: page unavailable, trying again on the next run`); continue; }
    merge({ id: v.id, ...page, title: v.title ?? page.title });
  }
  fresh.push(videos.get(v.id));
}
fresh.sort((a, b) => (a.published ?? 0) - (b.published ?? 0));

if (!fresh.length) {
  console.log(`No new videos (${videos.size} in ${yt.playlists.length} playlists, all posted).`);
  process.exit(0);
}

for (const v of fresh) {
  const text = await line(v);
  // A re-upload (same announcement, new video ID): point the existing post at the new video.
  const old = text.includes('**') ? byLine.get(text) : null;
  if (old) {
    console.log(`${DRY ? '[dry-run] ' : ''}update ${v.id} ${text} (re-upload)`);
    if (!DRY) {
      await api('PATCH', `/channels/${channelId}/messages/${old.id}`, {
        content: old.content.replace(/https:\/\/youtu\.be\/[\w-]{11}/, `https://youtu.be/${v.id}`),
        allowed_mentions: { parse: [] },
      });
    }
    continue;
  }
  const recent = v.published && (Date.now() - v.published) / 36e5 < yt.pingIfNewerThanHours;
  const ping = !REBUILD && pingRoleId && recent && yt.pingLanguages.includes(v.language);
  const content = `${ping ? `<@&${pingRoleId}> ` : ''}${text}\nhttps://youtu.be/${v.id}`;
  console.log(`${DRY ? '[dry-run] ' : ''}post ${v.id} ${text}${ping ? ' (ping)' : ''}`);
  if (DRY) continue;
  const msg = await api('POST', `/channels/${channelId}/messages`, {
    content, allowed_mentions: { roles: ping ? [pingRoleId] : [] },
  });
  byLine.set(text, msg);
  // Publish to servers following #videos (not on a rebuild: 10 cross-posts per hour).
  if (!REBUILD) await api('POST', `/channels/${channelId}/messages/${msg.id}/crosspost`).catch(() => {});
}
