// Makes the Postext Discord server match server.config.mjs.
//
//   node setup.mjs --validate            offline checks of config + content (no token needed)
//   node setup.mjs --dry-run             show what would change, change nothing
//   node setup.mjs                       apply
//   node setup.mjs --enable-community    also turn on Discord's Community features (first run only)

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as cfg from './server.config.mjs';
import {
  createClient, loadEnv, permissionBits, readJson, writeJson, STATE_FILE, SECRETS_FILE,
} from './lib/discord.mjs';

const args = new Set(process.argv.slice(2));
const VALIDATE = args.has('--validate');
const DRY = args.has('--dry-run');
const ENABLE_COMMUNITY = args.has('--enable-community');

const TYPE = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15 };
const FLAG_PINNED = 2;
const FLAG_REQUIRE_TAG = 16;
const SUPPRESS_EMBEDS = 4;
const NO_PINGS = { parse: [] };

const REPLACE_MANUAL = args.has('--replace-manual');

const log = (...a) => console.log(...a);
// Emoji may or may not carry the U+FE0F variation selector depending on how they were typed.
const sameName = (a, b) => !!a && !!b && a.normalize('NFC').replace(/\uFE0F/g, '') === b.normalize('NFC').replace(/\uFE0F/g, '');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------- content ----------

const allChannels = cfg.categories.flatMap((c) => c.channels.map((ch) => ({ ...ch, category: c })));

function readContent(file) {
  return readFileSync(new URL(`./content/${file}`, import.meta.url), 'utf8');
}

function splitMessages(text) {
  return text.split(/^<!-- split -->$/m).map((s) => s.trim()).filter(Boolean);
}

function parseForumFile(text) {
  const m = text.match(/^<!-- pinned post: (.+) -->$/m);
  if (!m) return { guidelines: text.trim(), post: null };
  return {
    guidelines: text.slice(0, m.index).trim(),
    post: { title: m[1].trim(), content: text.slice(m.index + m[0].length).trim() },
  };
}

function makeRenderer(ids, community) {
  return (text) => text
    .replace(/\{#([\w-]+)\}/g, (_, k) => {
      if (!allChannels.some((c) => c.key === k)) throw new Error(`Unknown channel {#${k}}`);
      return ids.channels[k] ? `<#${ids.channels[k]}>` : `#${k}`;
    })
    .replace(/\{@(\w+)\}/g, (_, k) => {
      const role = cfg.roles.find((r) => r.key === k);
      if (!role) throw new Error(`Unknown role {@${k}}`);
      return ids.roles[k] ? `<@&${ids.roles[k]}>` : `@${role.name}`;
    })
    .replace(/\{customize\}/g, community ? '<id:customize>' : '**Channels & Roles**')
    .replace(/\{link:(\w+)\}/g, (_, k) => {
      if (!cfg.links[k]) throw new Error(`Unknown link {link:${k}}`);
      return cfg.links[k];
    });
}

// ---------- validation (offline) ----------

function validate() {
  const errors = [];
  const fake = { channels: {}, roles: {} };
  allChannels.forEach((c, i) => { fake.channels[c.key] = String(1_300_000_000_000_000_000n + BigInt(i)); });
  cfg.roles.forEach((r, i) => { fake.roles[r.key] = String(1_300_000_000_000_001_000n + BigInt(i)); });
  const render = makeRenderer(fake, true);
  const check = (cond, msg) => { if (!cond) errors.push(msg); };

  const keys = allChannels.map((c) => c.key);
  check(new Set(keys).size === keys.length, 'Duplicate channel keys');

  for (const m of cfg.messages) {
    check(keys.includes(m.channel), `message ${m.key}: unknown channel ${m.channel}`);
    splitMessages(render(readContent(m.file))).forEach((chunk, i) =>
      check(chunk.length <= 2000, `${m.file} part ${i + 1} is ${chunk.length} chars (max 2000)`));
  }
  for (const ch of allChannels.filter((c) => c.type === 'forum')) {
    const f = cfg.forums[ch.key];
    check(f, `forum ${ch.key} has no entry in forums`);
    if (!f) continue;
    check(f.tags.length <= 20, `forum ${ch.key}: ${f.tags.length} tags (max 20)`);
    f.tags.forEach((t) => check(t.name.length <= 20, `forum ${ch.key}: tag "${t.name}" > 20 chars`));
    const { guidelines, post } = parseForumFile(render(readContent(ch.content)));
    check(guidelines.length <= 4096, `${ch.content} guidelines ${guidelines.length} chars (max 4096)`);
    if (post) {
      check(post.title.length <= 100, `${ch.content} post title too long`);
      check(post.content.length <= 2000, `${ch.content} pinned post ${post.content.length} chars (max 2000)`);
    }
  }
  for (const ch of allChannels) {
    if (ch.topic) check(ch.topic.length <= 1024, `#${ch.key} topic too long`);
  }
  const ob = cfg.onboarding;
  ob.defaultChannels.forEach((k) => check(keys.includes(k), `onboarding: unknown channel ${k}`));
  check(ob.defaultChannels.length >= 7, 'onboarding needs ≥7 default channels');
  const writable = ob.defaultChannels.filter((k) => {
    const ch = allChannels.find((c) => c.key === k);
    const ow = ch?.overwrites ?? ch?.category.overwrites ?? [];
    return !ow.some((o) => o.target === '@everyone' && o.deny?.some((p) => p === 'SEND_MESSAGES' || p === 'VIEW_CHANNEL'));
  });
  check(writable.length >= 5, `onboarding needs ≥5 writable default channels (has ${writable.length})`);
  for (const p of ob.prompts) {
    for (const o of p.options) {
      o.roles.forEach((r) => check(cfg.roles.some((x) => x.key === r), `onboarding option "${o.title}": unknown role ${r}`));
      o.channels.forEach((c) => check(keys.includes(c), `onboarding option "${o.title}": unknown channel ${c}`));
      check(o.roles.length + o.channels.length > 0, `onboarding option "${o.title}" needs a role or channel`);
      check(o.title.length <= 50, `onboarding option title too long: ${o.title}`);
      check((o.description ?? '').length <= 100, `onboarding option description too long: ${o.title}`);
    }
  }
  check(cfg.welcomeScreen.description.length <= 140, 'welcome screen description > 140 chars');
  check(cfg.welcomeScreen.channels.length <= 5, 'welcome screen: max 5 channels');
  cfg.welcomeScreen.channels.forEach((w) => check(keys.includes(w.channel), `welcome screen: unknown channel ${w.channel}`));
  for (const r of cfg.roles) permissionBits(r.permissions);
  permissionBits(cfg.everyonePermissions);

  if (errors.length) {
    console.error('✖ Validation failed:\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  log(`✔ Config valid: ${cfg.roles.length} roles, ${cfg.categories.length} categories, ` +
    `${allChannels.length} channels, ${cfg.messages.length} synced messages.`);
}

validate();
if (VALIDATE) process.exit(0);

// ---------- live run ----------

const { token, guildId: G } = loadEnv();
const api = createClient(token);
const state = readJson(STATE_FILE, { ids: { channels: {}, roles: {} }, messages: {}, forumPosts: {} });
const secrets = readJson(SECRETS_FILE, {});
const ids = { channels: {}, roles: {} };
let fakeId = 0;

// Mutating calls go through here so --dry-run can skip them.
async function mutate(method, path, body, what) {
  log(`${DRY ? '  [dry-run] ' : '  '}${what}`);
  if (DRY) return { id: `dry-${++fakeId}`, ...(body ?? {}) };
  return api(method, path, body, { reason: 'postext-discord setup' });
}

function overwritesFor(list = []) {
  return list.map((o) => ({
    id: o.target === '@everyone' ? G : ids.roles[o.target],
    type: 0,
    allow: permissionBits(o.allow).toString(),
    deny: permissionBits(o.deny).toString(),
  })).filter((o) => o.id);
}

const normOverwrites = (list = []) => JSON.stringify(
  list.map((o) => [o.id, o.type, String(o.allow ?? '0'), String(o.deny ?? '0')])
    .sort((a, b) => a[0].localeCompare(b[0])),
);

// Fields of `desired` that differ from `current`.
function diff(current, desired) {
  const out = {};
  for (const [k, v] of Object.entries(desired)) {
    const cur = current?.[k];
    if (k === 'permission_overwrites') {
      if (normOverwrites(cur) !== normOverwrites(v)) out[k] = v;
    } else if (k === 'available_tags') {
      const simplify = (tags = []) => JSON.stringify(tags.map((t) => [t.name, !!t.moderated, t.emoji_name ?? null]));
      if (simplify(cur) !== simplify(v)) out[k] = v;
    } else if (k === 'default_reaction_emoji') {
      if ((cur?.emoji_name ?? null) !== (v?.emoji_name ?? null)) out[k] = v;
    } else if (JSON.stringify(cur ?? null) !== JSON.stringify(v ?? null)) {
      out[k] = v;
    }
  }
  return out;
}

async function main() {
  const me = await api('GET', '/users/@me');
  let guild = await api('GET', `/guilds/${G}?with_counts=true`);
  log(`Bot ${me.username} → server "${guild.name}" (${guild.approximate_member_count} members)${DRY ? ' — DRY RUN' : ''}\n`);

  let community = guild.features.includes('COMMUNITY');
  if (!community && !ENABLE_COMMUNITY) {
    console.error(
      'This server is not a Community server yet. Forums, announcement channels, onboarding and the\n' +
      'welcome screen require it. Rerun with --enable-community (this accepts Discord\'s Community\n' +
      'Guidelines on the server\'s behalf), or enable it in Server Settings → Enable Community.',
    );
    process.exit(1);
  }

  // ----- roles -----
  log('Roles');
  const guildRoles = await api('GET', `/guilds/${G}/roles`);
  const everyone = guildRoles.find((r) => r.id === G);
  const everyonePerms = permissionBits(cfg.everyonePermissions).toString();
  if (everyone.permissions !== everyonePerms) {
    await mutate('PATCH', `/guilds/${G}/roles/${G}`, { permissions: everyonePerms }, 'update @everyone permissions');
  }
  for (const role of cfg.roles) {
    const body = {
      name: role.name, color: role.color ?? 0, hoist: !!role.hoist,
      mentionable: !!role.mentionable, permissions: permissionBits(role.permissions).toString(),
    };
    const existing = guildRoles.find((r) => r.name === role.name && !r.managed);
    if (!existing) {
      ids.roles[role.key] = (await mutate('POST', `/guilds/${G}/roles`, body, `create role ${role.name}`)).id;
    } else {
      ids.roles[role.key] = existing.id;
      const changes = diff(existing, body);
      if (Object.keys(changes).length) {
        await mutate('PATCH', `/guilds/${G}/roles/${existing.id}`, changes, `update role ${role.name} (${Object.keys(changes)})`)
          .catch((e) => log(`  ⚠ could not update role ${role.name} (move the bot's role above it): ${e.message}`));
      }
    }
  }
  if (!DRY) {
    // Stack our roles (top of the config = highest) directly above @everyone.
    const n = cfg.roles.length;
    const positions = cfg.roles.map((r, i) => ({ id: ids.roles[r.key], position: n - i }));
    try {
      await api('PATCH', `/guilds/${G}/roles`, positions);
    } catch (e) {
      log(`  ⚠ could not reorder roles (move the bot's role to the top): ${e.message}`);
    }
  }

  // ----- categories & channels -----
  log('\nChannels');
  let channels = await api('GET', `/guilds/${G}/channels`);
  const catIds = [];
  const deferredTypeChanges = [];

  for (const cat of cfg.categories) {
    const body = { name: cat.name, permission_overwrites: overwritesFor(cat.overwrites) };
    const existing = channels.find((c) => c.type === TYPE.category && (sameName(c.name, cat.name) || c.name === cat.renameFrom));
    let id;
    if (!existing) {
      id = (await mutate('POST', `/guilds/${G}/channels`, { ...body, type: TYPE.category }, `create category ${cat.name}`)).id;
    } else {
      id = existing.id;
      const changes = diff(existing, body);
      if (Object.keys(changes).length) {
        await mutate('PATCH', `/channels/${id}`, changes,
          existing.name !== cat.name ? `rename category "${existing.name}" → "${cat.name}"` : `update category ${cat.name}`);
      }
    }
    catIds.push(id);

    for (const ch of cat.channels) {
      if (ch.type === 'stage' && !community && DRY) { log(`  [dry-run] create stage ${ch.key} (after Community)`); continue; }
      const type = TYPE[ch.type];
      const isForum = ch.type === 'forum';
      const body = {
        name: ch.key,
        parent_id: id,
        permission_overwrites: overwritesFor(ch.overwrites ?? cat.overwrites),
      };
      if (ch.topic) body.topic = ch.topic;
      if (ch.rate_limit_per_user) body.rate_limit_per_user = ch.rate_limit_per_user;
      let forumCfg;
      if (isForum) {
        // Forum guidelines (the forum's topic) are set later, once every channel ID is known.
        forumCfg = cfg.forums[ch.key];
        body.default_forum_layout = forumCfg.layout === 'gallery' ? 2 : 1;
        body.default_sort_order = forumCfg.sort === 'creation' ? 1 : 0;
        body.default_reaction_emoji = forumCfg.reaction ? { emoji_id: null, emoji_name: forumCfg.reaction } : null;
        body.default_auto_archive_duration = 10080;
      }

      const compatible = (c) => c.type === type
        || (ch.type === 'announcement' && c.type === TYPE.text)
        || (ch.type === 'text' && c.type === TYPE.announcement);
      const existing = channels.find((c) => c.name === ch.key && compatible(c));

      if (isForum) {
        body.available_tags = forumCfg.tags.map((t) => ({
          ...(existing?.available_tags?.find((x) => x.name === t.name)?.id
            ? { id: existing.available_tags.find((x) => x.name === t.name).id } : {}),
          name: t.name, moderated: !!t.moderated, emoji_id: null, emoji_name: t.emoji ?? null,
        }));
      }

      let chId;
      if (!existing) {
        // Announcement channels need Community; create as text and convert afterwards.
        const createType = ch.type === 'announcement' && !community ? TYPE.text : type;
        if (createType !== type) deferredTypeChanges.push(ch.key);
        const created = await mutate('POST', `/guilds/${G}/channels`, { ...body, type: createType },
          `create ${ch.type} #${ch.key} in ${cat.name}`);
        chId = created.id;
      } else {
        chId = existing.id;
        if (existing.type !== type) deferredTypeChanges.push(ch.key);
        const changes = diff(existing, body);
        if (Object.keys(changes).length) {
          await mutate('PATCH', `/channels/${chId}`, changes, `update #${ch.key} (${Object.keys(changes)})`);
        }
      }
      ids.channels[ch.key] = chId;
    }
  }
  if (!DRY) {
    channels = await api('GET', `/guilds/${G}/channels`);
    const positions = [];
    cfg.categories.forEach((cat, i) => {
      positions.push({ id: catIds[i], position: i });
      cat.channels.forEach((ch, j) => ids.channels[ch.key] && positions.push({ id: ids.channels[ch.key], position: j }));
    });
    await api('PATCH', `/guilds/${G}/channels`, positions);
    const known = new Set([...catIds, ...Object.values(ids.channels)]);
    for (const c of channels.filter((c) => !known.has(c.id) && ![10, 11, 12].includes(c.type))) {
      log(`  ⚠ channel "${c.name}" is not in the config (left untouched)`);
    }
  }

  // ----- community -----
  if (!community) {
    log('\nCommunity');
    await mutate('PATCH', `/guilds/${G}`, {
      features: [...new Set([...guild.features, 'COMMUNITY'])],
      verification_level: Math.max(cfg.guild.verification_level, 1),
      explicit_content_filter: 2,
      rules_channel_id: ids.channels[cfg.guild.rulesChannel],
      public_updates_channel_id: ids.channels[cfg.guild.publicUpdatesChannel],
    }, 'enable Community features');
    community = true;
    // Stage channels can only exist in Community servers.
    for (const cat of cfg.categories) {
      for (const ch of cat.channels.filter((c) => c.type === 'stage' && !ids.channels[c.key])) {
        const idx = cfg.categories.indexOf(cat);
        ids.channels[ch.key] = (await mutate('POST', `/guilds/${G}/channels`,
          { name: ch.key, type: TYPE.stage, parent_id: catIds[idx] }, `create stage ${ch.key}`)).id;
      }
    }
  }
  for (const key of deferredTypeChanges) {
    const ch = allChannels.find((c) => c.key === key);
    await mutate('PATCH', `/channels/${ids.channels[key]}`, { type: TYPE[ch.type] }, `convert #${key} to ${ch.type}`);
  }

  const render = makeRenderer(ids, community);

  // ----- forums: guidelines + pinned post -----
  log('\nForums');
  for (const ch of allChannels.filter((c) => c.type === 'forum')) {
    const forumId = ids.channels[ch.key];
    const forumCfg = cfg.forums[ch.key];
    const { guidelines, post } = parseForumFile(render(readContent(ch.content)));
    const current = DRY ? null : await api('GET', `/channels/${forumId}`);
    const desiredFlags = forumCfg.requireTag ? FLAG_REQUIRE_TAG : 0;

    let postId = state.forumPosts[ch.key];
    if (postId && !DRY) {
      try { await api('GET', `/channels/${postId}`); } catch { postId = null; }
    }
    if (post && !postId) {
      if (current?.flags & FLAG_REQUIRE_TAG) {
        await mutate('PATCH', `/channels/${forumId}`, { flags: 0 }, `temporarily allow untagged posts in #${ch.key}`);
      }
      const thread = await mutate('POST', `/channels/${forumId}/threads`, {
        name: post.title,
        message: { content: post.content, flags: SUPPRESS_EMBEDS, allowed_mentions: NO_PINGS },
      }, `create pinned post "${post.title}" in #${ch.key}`);
      postId = thread.id;
      await mutate('PATCH', `/channels/${postId}`, { flags: FLAG_PINNED, locked: true }, `pin + lock "${post.title}"`);
      state.forumPosts[ch.key] = postId;
      state.messages[`forum:${ch.key}`] = { hash: hash(post.title + post.content) };
    } else if (post && state.messages[`forum:${ch.key}`]?.hash !== hash(post.title + post.content)) {
      await mutate('PATCH', `/channels/${postId}`, { name: post.title }, `rename pinned post in #${ch.key}`);
      await mutate('PATCH', `/channels/${postId}/messages/${postId}`,
        { content: post.content, flags: SUPPRESS_EMBEDS, allowed_mentions: NO_PINGS }, `edit pinned post in #${ch.key}`);
      state.messages[`forum:${ch.key}`] = { hash: hash(post.title + post.content) };
    }

    const changes = diff(DRY ? {} : { topic: current.topic, flags: current.flags & FLAG_REQUIRE_TAG },
      { topic: guidelines, flags: desiredFlags });
    if (Object.keys(changes).length) {
      await mutate('PATCH', `/channels/${forumId}`, { topic: guidelines, flags: desiredFlags },
        `set guidelines${forumCfg.requireTag ? ' + require tags' : ''} for #${ch.key}`);
    }
  }

  // ----- synced messages -----
  log('\nMessages');
  for (const m of cfg.messages) {
    const channelId = ids.channels[m.channel];
    const chunks = splitMessages(render(readContent(m.file)));
    const prev = state.messages[m.key]?.channel === channelId ? state.messages[m.key] : { ids: [], hashes: [] };
    if (!prev.ids.length) {
      // Messages posted by hand (not by this bot) can't be edited by the bot.
      const existing = await api('GET', `/channels/${channelId}/messages?limit=50`);
      const manual = existing.filter((x) => x.author.id !== me.id && x.type === 0);
      if (manual.length && !REPLACE_MANUAL) {
        log(`  ⚠ #${m.channel} already has ${manual.length} message(s) posted by hand — skipped (use --replace-manual to delete them and repost as the bot)`);
        continue;
      }
      for (const x of manual) {
        await mutate('DELETE', `/channels/${channelId}/messages/${x.id}`, undefined, `delete hand-posted message in #${m.channel}`);
      }
    }
    const next = { channel: channelId, ids: [], hashes: [] };
    for (let i = 0; i < chunks.length; i++) {
      const body = { content: chunks[i], flags: SUPPRESS_EMBEDS, allowed_mentions: NO_PINGS };
      const h = hash(chunks[i]);
      let id = prev.ids[i];
      if (id && prev.hashes[i] === h) {
        next.ids.push(id); next.hashes.push(h); continue;
      }
      if (id) {
        try {
          await mutate('PATCH', `/channels/${channelId}/messages/${id}`, body, `edit ${m.file} part ${i + 1} in #${m.channel}`);
        } catch (e) {
          if (e.status !== 404) throw e;
          id = null;
        }
      }
      if (!id) {
        id = (await mutate('POST', `/channels/${channelId}/messages`, body, `post ${m.file} part ${i + 1} in #${m.channel}`)).id;
        if (m.pin && i === 0) {
          await mutate('PUT', `/channels/${channelId}/messages/pins/${id}`, undefined, `pin ${m.file} in #${m.channel}`)
            .catch(() => api('PUT', `/channels/${channelId}/pins/${id}`));
        }
      }
      next.ids.push(id); next.hashes.push(h);
    }
    for (const stale of prev.ids.slice(chunks.length)) {
      await mutate('DELETE', `/channels/${channelId}/messages/${stale}`, undefined, `delete surplus message in #${m.channel}`)
        .catch(() => {});
    }
    state.messages[m.key] = next;
  }

  // ----- server settings -----
  log('\nServer settings');
  guild = DRY ? guild : await api('GET', `/guilds/${G}`);
  const settings = {
    description: cfg.guild.description,
    preferred_locale: cfg.guild.preferred_locale,
    default_message_notifications: cfg.guild.default_message_notifications,
    verification_level: cfg.guild.verification_level,
    explicit_content_filter: cfg.guild.explicit_content_filter,
    system_channel_id: ids.channels[cfg.guild.systemChannel],
    system_channel_flags: (1 << 2) | (1 << 3), // no setup tips, no sticker-reply button on joins
    rules_channel_id: ids.channels[cfg.guild.rulesChannel],
    public_updates_channel_id: ids.channels[cfg.guild.publicUpdatesChannel],
    safety_alerts_channel_id: ids.channels[cfg.guild.safetyAlertsChannel],
  };
  const settingChanges = diff(guild, settings);
  if (Object.keys(settingChanges).length) {
    await mutate('PATCH', `/guilds/${G}`, settingChanges, `update server settings (${Object.keys(settingChanges)})`);
  }

  await mutate('PATCH', `/guilds/${G}/welcome-screen`, {
    enabled: true,
    description: cfg.welcomeScreen.description,
    welcome_channels: cfg.welcomeScreen.channels.map((w) => ({
      channel_id: ids.channels[w.channel], description: w.description, emoji_id: null, emoji_name: w.emoji,
    })),
  }, 'update welcome screen');

  // ----- onboarding -----
  log('\nOnboarding');
  const currentOnboarding = DRY ? { prompts: [] } : await api('GET', `/guilds/${G}/onboarding`);
  let seq = 0n;
  const snowflake = () => String(((BigInt(Date.now()) - 1420070400000n) << 22n) + (seq++));
  const prompts = cfg.onboarding.prompts.map((p, i) => {
    const existing = currentOnboarding.prompts.find((x) => x.title === p.title);
    return {
      id: existing?.id ?? snowflake(),
      type: 0,
      title: p.title,
      single_select: p.single_select,
      required: p.required,
      in_onboarding: p.in_onboarding,
      options: p.options.map((o) => ({
        id: existing?.options.find((x) => x.title === o.title)?.id ?? snowflake(),
        title: o.title,
        description: o.description ?? '',
        emoji_id: null,
        emoji_name: o.emoji,
        emoji_animated: false,
        role_ids: o.roles.map((r) => ids.roles[r]),
        channel_ids: o.channels.map((c) => ids.channels[c]),
      })),
    };
  });
  try {
    await mutate('PUT', `/guilds/${G}/onboarding`, {
      prompts,
      default_channel_ids: cfg.onboarding.defaultChannels.map((c) => ids.channels[c]),
      enabled: true,
      mode: 0,
    }, `configure onboarding (${prompts.length} prompts)`);
  } catch (e) {
    log(`  ⚠ onboarding not applied: ${e.message}`);
  }

  // ----- automod -----
  log('\nAutoMod');
  const rules = DRY ? [] : await api('GET', `/guilds/${G}/auto-moderation/rules`);
  const modLog = ids.channels['mod-log'];
  for (const rule of cfg.automod) {
    const actions = rule.actions.map((a) => ({
      block: { type: 1, metadata: rule.blockMessage ? { custom_message: rule.blockMessage } : {} },
      alert: { type: 2, metadata: { channel_id: modLog } },
      timeout: { type: 3, metadata: { duration_seconds: 600 } },
    })[a]);
    const body = {
      name: rule.name, event_type: 1, trigger_type: rule.trigger_type,
      ...(rule.trigger_metadata ? { trigger_metadata: rule.trigger_metadata } : {}),
      actions, enabled: true,
      exempt_roles: [ids.roles.maintainer, ids.roles.moderator].filter(Boolean),
    };
    // Spam, preset and mention-spam rules are one-per-server: match those by type.
    const existing = rules.find((r) => r.name === rule.name || ([3, 4, 5].includes(rule.trigger_type) && r.trigger_type === rule.trigger_type));
    try {
      if (existing) {
        const { trigger_type, ...patch } = body;
        await mutate('PATCH', `/guilds/${G}/auto-moderation/rules/${existing.id}`, patch, `update rule "${rule.name}"`);
      } else {
        await mutate('POST', `/guilds/${G}/auto-moderation/rules`, body, `create rule "${rule.name}"`);
      }
    } catch (e) {
      if (existing && e.status === 404) log(`  = "${existing.name}" is Discord's built-in rule (not editable) — kept as is`);
      else log(`  ⚠ rule "${rule.name}" not applied: ${e.message}`);
    }
  }

  // ----- webhooks -----
  log('\nWebhooks');
  const feedId = ids.channels['github-feed'];
  if (!DRY) {
    const hooks = await api('GET', `/channels/${feedId}/webhooks`);
    let hook = hooks.find((h) => h.name === 'GitHub');
    if (!hook) hook = await mutate('POST', `/channels/${feedId}/webhooks`, { name: 'GitHub' }, 'create webhook GitHub in #github-feed');
    secrets.githubWebhookUrl = `https://discord.com/api/webhooks/${hook.id}/${hook.token}/github`;
    writeJson(SECRETS_FILE, secrets);
    log(`  GitHub webhook URL saved to ${SECRETS_FILE}`);
  } else {
    log('  [dry-run] ensure webhook GitHub in #github-feed');
  }

  if (!DRY) {
    state.ids = ids;
    writeJson(STATE_FILE, state);
  }
  log(`\n✔ Done${DRY ? ' (dry run, nothing changed)' : ''}.`);
}

main().catch((e) => {
  if (!DRY) writeJson(STATE_FILE, { ...state, ids: { channels: { ...state.ids.channels, ...ids.channels }, roles: { ...state.ids.roles, ...ids.roles } } });
  console.error('\n✖', e.message);
  process.exit(1);
});
