// Posts new videos from the Postext YouTube channel to #videos.
//
//   node youtube.mjs            post videos that aren't in #videos yet
//   node youtube.mjs --dry-run  list what would be posted
//
// Stateless: it reads the channel's recent messages to know what was already posted,
// so it is safe to run from cron, GitHub Actions or by hand.

import { youtube as yt } from './server.config.mjs';
import { createClient, loadEnv, readJson, STATE_FILE } from './lib/discord.mjs';

const DRY = process.argv.includes('--dry-run');
const { token } = loadEnv();
const api = createClient(token);
const { ids } = readJson(STATE_FILE, { ids: { channels: {}, roles: {} } });
const channelId = process.env.VIDEOS_CHANNEL_ID ?? ids.channels.videos;
const pingRoleId = process.env.VIDEO_PINGS_ROLE_ID ?? ids.roles.videoPings;
if (!channelId) {
  console.error('No #videos channel ID. Run `node setup.mjs` first or set VIDEOS_CHANNEL_ID.');
  process.exit(1);
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const res = await fetch(yt.playlistId
  ? `https://www.youtube.com/feeds/videos.xml?playlist_id=${yt.playlistId}`
  : `https://www.youtube.com/feeds/videos.xml?channel_id=${yt.channelId}`);
if (!res.ok) throw new Error(`YouTube feed → ${res.status}`);
const xml = await res.text();
const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
  id: e.match(/<yt:videoId>([^<]+)/)[1],
  title: decode(e.match(/<title>([^<]+)/)[1]),
  published: new Date(e.match(/<published>([^<]+)/)[1]),
})).sort((a, b) => a.published - b.published);

// What's already in #videos: video IDs, and which message carries each title.
const me = await api('GET', '/users/@me');
const posted = new Set();
const byTitle = new Map();
let before = null;
for (;;) {
  const page = await api('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
  for (const m of page) {
    if (m.author.id !== me.id) continue;
    const ids = [...m.content.matchAll(/(?:youtu\.be\/|watch\?v=|shorts\/)([\w-]{11})/g)].map((x) => x[1]);
    ids.forEach((id) => posted.add(id));
    const title = m.content.match(/🎬 \*\*(.+?)\*\*/)?.[1];
    if (title && !byTitle.has(title)) byTitle.set(title, m);
  }
  if (page.length < 100) break;
  before = page.at(-1).id;
}

const fresh = videos.filter((v) => !posted.has(v.id));
if (!fresh.length) {
  console.log(`No new videos (${videos.length} in feed, all posted).`);
  process.exit(0);
}

for (const v of fresh) {
  // A re-upload (same title, new ID): point the existing post at the new video.
  const old = byTitle.get(v.title);
  if (old) {
    console.log(`${DRY ? '[dry-run] ' : ''}update ${v.id} "${v.title}" (re-upload)`);
    if (!DRY) {
      await api('PATCH', `/channels/${channelId}/messages/${old.id}`, {
        content: old.content.replace(/https:\/\/youtu\.be\/[\w-]{11}/, `https://youtu.be/${v.id}`),
        allowed_mentions: { parse: [] },
      });
    }
    continue;
  }
  const ageHours = (Date.now() - v.published) / 36e5;
  const ping = pingRoleId && ageHours < yt.pingIfNewerThanHours;
  const content = `${ping ? `<@&${pingRoleId}> ` : ''}🎬 **${v.title}**\nhttps://youtu.be/${v.id}`;
  console.log(`${DRY ? '[dry-run] ' : ''}post ${v.id} "${v.title}"${ping ? ' (ping)' : ''}`);
  if (DRY) continue;
  const msg = await api('POST', `/channels/${channelId}/messages`, {
    content, allowed_mentions: { roles: ping ? [pingRoleId] : [] },
  });
  // Publish to servers following #videos (announcement channels only).
  await api('POST', `/channels/${channelId}/messages/${msg.id}/crosspost`).catch(() => {});
}
