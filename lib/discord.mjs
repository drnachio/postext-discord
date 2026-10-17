// Minimal Discord REST client (no dependencies) + shared helpers.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const API = 'https://discord.com/api/v10';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadEnv() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { DISCORD_TOKEN, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !GUILD_ID) {
    console.error('Missing DISCORD_TOKEN or GUILD_ID. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  return { token: DISCORD_TOKEN, guildId: GUILD_ID };
}

export function createClient(token) {
  return async function api(method, path, body, { reason } = {}) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const headers = {
        Authorization: `Bot ${token}`,
        'User-Agent': 'DiscordBot (https://postext.dev, 1.0)',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason);
      const res = await fetch(API + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        await sleep(((data.retry_after ?? 1) * 1000) + 250);
        continue;
      }
      if (res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    }
    throw new Error(`${method} ${path} → gave up after retries`);
  };
}

export const STATE_FILE = 'state.json';
export const SECRETS_FILE = '.secrets.json';

export function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}

export function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const PERMISSIONS = {
  CREATE_INSTANT_INVITE: 0, KICK_MEMBERS: 1, BAN_MEMBERS: 2, ADMINISTRATOR: 3,
  MANAGE_CHANNELS: 4, MANAGE_GUILD: 5, ADD_REACTIONS: 6, VIEW_AUDIT_LOG: 7,
  PRIORITY_SPEAKER: 8, STREAM: 9, VIEW_CHANNEL: 10, SEND_MESSAGES: 11,
  SEND_TTS_MESSAGES: 12, MANAGE_MESSAGES: 13, EMBED_LINKS: 14, ATTACH_FILES: 15,
  READ_MESSAGE_HISTORY: 16, MENTION_EVERYONE: 17, USE_EXTERNAL_EMOJIS: 18,
  VIEW_GUILD_INSIGHTS: 19, CONNECT: 20, SPEAK: 21, MUTE_MEMBERS: 22, DEAFEN_MEMBERS: 23,
  MOVE_MEMBERS: 24, USE_VAD: 25, CHANGE_NICKNAME: 26, MANAGE_NICKNAMES: 27,
  MANAGE_ROLES: 28, MANAGE_WEBHOOKS: 29, MANAGE_GUILD_EXPRESSIONS: 30,
  USE_APPLICATION_COMMANDS: 31, REQUEST_TO_SPEAK: 32, MANAGE_EVENTS: 33,
  MANAGE_THREADS: 34, CREATE_PUBLIC_THREADS: 35, CREATE_PRIVATE_THREADS: 36,
  USE_EXTERNAL_STICKERS: 37, SEND_MESSAGES_IN_THREADS: 38, USE_EMBEDDED_ACTIVITIES: 39,
  MODERATE_MEMBERS: 40, USE_SOUNDBOARD: 42, CREATE_GUILD_EXPRESSIONS: 43,
  CREATE_EVENTS: 44, USE_EXTERNAL_SOUNDS: 45, SEND_VOICE_MESSAGES: 46, SEND_POLLS: 49,
  USE_EXTERNAL_APPS: 50,
};

export function permissionBits(names = []) {
  let bits = 0n;
  for (const name of names) {
    if (!(name in PERMISSIONS)) throw new Error(`Unknown permission ${name}`);
    bits |= 1n << BigInt(PERMISSIONS[name]);
  }
  return bits;
}

// True if one of the bot's latest messages in the channel already carries an embed
// with this title. The feeds run from two repositories (this one's schedule and
// drnachio/postext's workflows): checking right before posting keeps two runs
// that overlap from posting the same thing twice.
export async function alreadyPosted(api, channelId, botId, title) {
  const recent = await api('GET', `/channels/${channelId}/messages?limit=25`);
  return recent.some((m) => m.author.id === botId && m.embeds?.some((e) => e.title === title));
}
