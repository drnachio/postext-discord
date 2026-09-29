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

// Every video is published in English and Spanish; tell them apart by the title.
function language(title) {
  if (/[ñáéíóú¿¡]/i.test(title)) return 'es';
  const words = title.toLowerCase().split(/[^a-záéíóúñ]+/);
  const es = words.filter((w) => ['el', 'la', 'los', 'las', 'un', 'una', 'tu', 'con', 'para', 'del', 'y', 'en', 'como'].includes(w)).length;
  const en = words.filter((w) => ['the', 'a', 'an', 'your', 'with', 'for', 'to', 'of', 'and', 'in', 'how'].includes(w)).length;
  return es > en ? 'es' : 'en';
}

const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${yt.channelId}`);
if (!res.ok) throw new Error(`YouTube feed → ${res.status}`);
const xml = await res.text();
const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
  id: e.match(/<yt:videoId>([^<]+)/)[1],
  title: decode(e.match(/<title>([^<]+)/)[1]),
  published: new Date(e.match(/<published>([^<]+)/)[1]),
}))
  .filter((v) => !yt.language || language(v.title) === yt.language)
  .sort((a, b) => a.published - b.published);

const recent = await api('GET', `/channels/${channelId}/messages?limit=100`);
const posted = new Set(recent.flatMap((m) =>
  [...m.content.matchAll(/(?:youtu\.be\/|watch\?v=|shorts\/)([\w-]{11})/g)].map((x) => x[1])));

const fresh = videos.filter((v) => !posted.has(v.id));
if (!fresh.length) {
  console.log(`No new videos (${videos.length} in feed, all posted).`);
  process.exit(0);
}

for (const v of fresh) {
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
