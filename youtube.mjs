// Announces new Postext videos in #videos, in every language, always in English.
//
//   node youtube.mjs              post videos that aren't in #videos yet
//   node youtube.mjs --dry-run    list what would be posted
//   node youtube.mjs --rebuild    delete the video posts in #videos and post every video again,
//                                 oldest first (no pings, no cross-posting)
//
// Each language has its own playlist. A translation is announced with the title of
// its English original: from the "English version →" link in its description, its
// (n/m) part number, or content/video-map.json. Stateless: what's already posted is
// read back from #videos.

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

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
// "(2/4)" and "（2/4）" are the same part.
const partOf = (title) => title.normalize('NFKC').match(/\((\d+)\/(\d+)\)/)?.[0] ?? null;

async function playlist(id, language) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${id}`);
  if (!res.ok) throw new Error(`YouTube playlist ${id} → ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: e.match(/<yt:videoId>([^<]+)/)[1],
    title: decode(e.match(/<title>([^<]+)/)[1]),
    description: decode(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? ''),
    published: new Date(e.match(/<published>([^<]+)/)[1]),
    language,
  }));
}

const lists = await Promise.all(yt.playlists.map((p) => playlist(p.id, p.language)));
const english = lists[yt.playlists.findIndex((p) => p.id === yt.englishPlaylist)];
const englishById = new Map(english.map((v) => [v.id, v]));
const englishByPart = new Map(english.filter((v) => partOf(v.title)).map((v) => [partOf(v.title), v]));

function englishTitle(v) {
  if (v.language === 'English') return v.title;
  const linked = v.description.match(/English version[^\n]*?youtu\.be\/([\w-]{11})/)?.[1];
  const original = englishById.get(linked) ?? englishById.get(videoMap[v.id]) ?? englishByPart.get(partOf(v.title));
  return original?.title ?? null;
}

// The announcement, always in English.
function line(v) {
  const title = englishTitle(v);
  if (v.language === 'English') return `🎬 **${title}**`;
  return title ? `🎬 **${title}** · 🌐 ${v.language} version` : `🎬 New video in ${v.language}`;
}

const videos = lists.flat().sort((a, b) => a.published - b.published);

// Video posts already in #videos (the bot's messages with a YouTube link).
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

const fresh = videos.filter((v) => !posted.has(v.id));
if (!fresh.length) {
  console.log(`No new videos (${videos.length} in ${yt.playlists.length} playlists, all posted).`);
  process.exit(0);
}

for (const v of fresh) {
  const text = line(v);
  // A re-upload (same announcement, new video ID): point the existing post at the new video.
  const old = text.includes("**") ? byLine.get(text) : null;
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
  const recent = (Date.now() - v.published) / 36e5 < yt.pingIfNewerThanHours;
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
