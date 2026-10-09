// Declarative description of the Postext Discord server.
// `node setup.mjs` makes the server match this file. It is idempotent:
// things are matched by name, created when missing and updated when present.

export const links = {
  site: 'https://postext.dev',
  docs: 'https://postext.dev/en/docs/introduction',
  sandbox: 'https://postext.dev/en/sandbox',
  cookbook: 'https://postext.dev/en/cookbook',
  github: 'https://github.com/drnachio/postext',
  youtube: 'https://www.youtube.com/@Postext',
};

export const youtube = {
  channelId: 'UCcHi3aoyQODhHdueLJv9G5Q',
  // The channel publishes every video in several languages, each with its own
  // playlist. Only the "Postext — in English" playlist is posted to #videos.
  // Set to null to post every upload of the channel.
  playlistId: 'PLXV_YSL9ROv0',
  // Videos older than this are posted without pinging @Video Pings (avoids a ping storm on backfill).
  pingIfNewerThanHours: 24,
};

// Release notes in #releases, one post per published version of Postext.
// A version is a vX.Y.Z tag: Postext's release workflow only pushes it after
// build, tests and the npm publish succeed, so a failed release never gets a note.
export const releases = {
  repo: 'drnachio/postext',
  pingIfNewerThanHours: 24,
  // Long versions are split across messages; past this, the rest is linked.
  maxMessagesPerVersion: 4,
};

export const guild = {
  description:
    'Home of Postext, the open-source programmable typesetter for the web. ' +
    'For publishers, editorial teams, developers and contributors.',
  preferred_locale: 'en-US',
  default_message_notifications: 1, // only @mentions
  verification_level: 2, // medium: account older than 5 minutes
  explicit_content_filter: 2, // scan media from all members
  systemChannel: 'general', // join messages
  rulesChannel: 'rules',
  publicUpdatesChannel: 'discord-updates',
  safetyAlertsChannel: 'mod-log',
};

// Permissions granted to @everyone at the server level.
export const everyonePermissions = [
  'CREATE_INSTANT_INVITE', 'CHANGE_NICKNAME', 'VIEW_CHANNEL', 'SEND_MESSAGES',
  'SEND_MESSAGES_IN_THREADS', 'CREATE_PUBLIC_THREADS', 'EMBED_LINKS', 'ATTACH_FILES',
  'ADD_REACTIONS', 'USE_EXTERNAL_EMOJIS', 'USE_EXTERNAL_STICKERS', 'READ_MESSAGE_HISTORY',
  'USE_APPLICATION_COMMANDS', 'SEND_VOICE_MESSAGES', 'SEND_POLLS', 'CONNECT', 'SPEAK',
  'STREAM', 'USE_VAD', 'REQUEST_TO_SPEAK', 'USE_EMBEDDED_ACTIVITIES',
];

const MOD = [
  'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS', 'MANAGE_MESSAGES', 'MANAGE_THREADS',
  'MANAGE_NICKNAMES', 'VIEW_AUDIT_LOG', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS',
  'MANAGE_EVENTS', 'CREATE_EVENTS', 'PRIORITY_SPEAKER',
];

// Top to bottom = highest to lowest in the role list.
export const roles = [
  { key: 'maintainer', name: 'Maintainer', color: 0xf2c230, hoist: true, mentionable: false,
    permissions: [...MOD, 'MANAGE_CHANNELS', 'MANAGE_ROLES', 'MANAGE_GUILD', 'MANAGE_WEBHOOKS',
      'MANAGE_GUILD_EXPRESSIONS', 'CREATE_GUILD_EXPRESSIONS', 'MENTION_EVERYONE'] },
  { key: 'moderator', name: 'Moderator', color: 0x3b6fe0, hoist: true, mentionable: true, permissions: MOD },
  { key: 'contributor', name: 'Contributor', color: 0x2fbf71, hoist: true, mentionable: false, permissions: [] },
  // Self-assigned in onboarding / Channels & Roles
  { key: 'publisher', name: 'Publisher', color: 0x9b5de5, permissions: [] },
  { key: 'developer', name: 'Developer', color: 0x14b8c4, permissions: [] },
  { key: 'typographer', name: 'Typographer & Designer', color: 0xe8579a, permissions: [] },
  { key: 'writer', name: 'Writer & Translator', color: 0xf08a24, permissions: [] },
  // Notification roles (no colour)
  { key: 'releasePings', name: 'Release Pings', permissions: [] },
  { key: 'videoPings', name: 'Video Pings', permissions: [] },
  { key: 'eventPings', name: 'Event Pings', permissions: [] },
];

// Overwrite presets. Role keys are resolved to IDs at run time; '@everyone' is the guild.
const readOnly = [
  { target: '@everyone', deny: ['SEND_MESSAGES', 'CREATE_PUBLIC_THREADS', 'CREATE_PRIVATE_THREADS', 'SEND_POLLS'] },
  { target: 'maintainer', allow: ['SEND_MESSAGES'] },
  { target: 'moderator', allow: ['SEND_MESSAGES'] },
];
const staffOnly = [
  { target: '@everyone', deny: ['VIEW_CHANNEL'] },
  { target: 'maintainer', allow: ['VIEW_CHANNEL'] },
  { target: 'moderator', allow: ['VIEW_CHANNEL'] },
];

// Channel types: text | announcement | forum | voice | stage
// `renameFrom` adopts an existing channel/category (the ones Discord created by default).
export const categories = [
  {
    name: '📌 Start Here',
    channels: [
      { key: 'welcome', type: 'text', overwrites: readOnly,
        topic: 'What Postext is and how to find your way around this server.' },
      { key: 'rules', type: 'text', overwrites: readOnly,
        topic: 'Community guidelines. By participating you agree to them.' },
      { key: 'announcements', type: 'announcement', overwrites: readOnly,
        topic: 'Releases and project news. Follow this channel to get updates in your own server.' },
      { key: 'releases', type: 'announcement', overwrites: readOnly,
        topic: 'Every published version of Postext with its release notes. Press Follow to get them in your own server.' },
      { key: 'videos', type: 'announcement', overwrites: readOnly,
        topic: `New videos from ${links.youtube} — tutorials, demos and deep dives. Posted automatically.` },
      { key: 'resources', type: 'text', overwrites: readOnly,
        topic: 'Docs, sandbox, cookbook, repository and other useful links.' },
    ],
  },
  {
    name: '💬 Community',
    renameFrom: 'Canales de texto',
    channels: [
      { key: 'general', type: 'text', topic: 'Anything Postext. For support, use #help.' },
      { key: 'introductions', type: 'text',
        topic: 'Say hi! Who are you, what do you publish or build, and what brings you here?',
        rate_limit_per_user: 60 },
      { key: 'typography', type: 'text',
        topic: 'The craft: typefaces, justification, hyphenation, grids, and the centuries-old rules of the page.' },
      { key: 'showcase', type: 'forum', content: 'forums/showcase.md' },
      { key: 'off-topic', type: 'text', topic: 'Everything else. Keep it friendly.' },
    ],
  },
  {
    name: '🛟 Help & Feedback',
    channels: [
      { key: 'help', type: 'forum', content: 'forums/help.md' },
      { key: 'feature-requests', type: 'forum', content: 'forums/feature-requests.md' },
    ],
  },
  {
    name: '📚 Publishers',
    channels: [
      { key: 'publisher-desk', type: 'forum', content: 'forums/publisher-desk.md' },
      { key: 'publishing-lounge', type: 'text',
        topic: 'For publishers and editorial teams: workflows, tooling, and moving production to Postext.' },
      { key: 'print-production', type: 'text',
        topic: 'Print-ready PDF, CMYK and spot colours, PDF/UA accessibility, prepress and printer handoff.' },
    ],
  },
  {
    name: '🛠️ Development',
    channels: [
      { key: 'contributing', type: 'text',
        topic: 'How to contribute (code, docs, design, typography, translations). Read the pinned guide first.' },
      { key: 'development', type: 'text',
        topic: 'Engine internals, layout algorithms, renderers and work in progress. Decisions land on GitHub.' },
      { key: 'integrations', type: 'text',
        topic: 'Using Postext with frameworks, CMSs, build pipelines and AI agents (the Postext agent skill).' },
      { key: 'docs-and-translations', type: 'text',
        topic: 'Documentation, examples, cookbook recipes and translations (docs are bilingual EN/ES).' },
      { key: 'github-feed', type: 'text', overwrites: readOnly,
        topic: `Activity from ${links.github} — issues, pull requests and releases.` },
    ],
  },
  {
    name: '🔊 Voice',
    renameFrom: 'Canales de voz',
    channels: [
      { key: 'General', type: 'voice' },
      { key: 'Pairing', type: 'voice' },
      { key: 'Office Hours', type: 'stage' },
    ],
  },
  {
    name: '🛡️ Staff',
    overwrites: staffOnly,
    channels: [
      { key: 'mod-chat', type: 'text', overwrites: staffOnly, topic: 'Private moderator discussion.' },
      { key: 'mod-log', type: 'text', overwrites: staffOnly, topic: 'AutoMod alerts and safety notifications.' },
      { key: 'discord-updates', type: 'text', overwrites: staffOnly, topic: 'Community updates sent by Discord.' },
    ],
  },
];

// Forum settings. Tag emoji must be unicode. Moderated tags can only be set by staff.
export const forums = {
  help: {
    layout: 'list', sort: 'activity', reaction: '✅', requireTag: true,
    tags: [
      { name: 'Question', emoji: '❓' },
      { name: 'Possible bug', emoji: '🐛' },
      { name: 'Layout & floats', emoji: '📐' },
      { name: 'Justification', emoji: '🔤' },
      { name: 'Math & formulas', emoji: '🧮' },
      { name: 'PDF output', emoji: '🖨️' },
      { name: 'HTML & canvas', emoji: '🌐' },
      { name: 'Configuration', emoji: '⚙️' },
      { name: '.postext format', emoji: '📦' },
      { name: 'AI agent skill', emoji: '🤖' },
      { name: 'Sandbox', emoji: '🧪' },
      { name: 'Solved', emoji: '✅' },
      { name: 'Moved to GitHub', emoji: '🔗', moderated: true },
    ],
  },
  'feature-requests': {
    layout: 'list', sort: 'activity', reaction: '👍', requireTag: true,
    tags: [
      { name: 'Engine', emoji: '⚙️' },
      { name: 'Renderers', emoji: '🖨️' },
      { name: 'File format', emoji: '📦' },
      { name: 'Sandbox', emoji: '🧪' },
      { name: 'Docs', emoji: '📖' },
      { name: 'Integrations', emoji: '🔌' },
      { name: 'Publishing workflow', emoji: '🏛️' },
      { name: 'Typography', emoji: '🔤' },
      { name: 'Under review', emoji: '🔍', moderated: true },
      { name: 'Planned', emoji: '🗺️', moderated: true },
      { name: 'In progress', emoji: '🚧', moderated: true },
      { name: 'Shipped', emoji: '🚀', moderated: true },
      { name: 'Not planned', emoji: '🚫', moderated: true },
    ],
  },
  'publisher-desk': {
    layout: 'list', sort: 'activity', reaction: '👍', requireTag: true,
    tags: [
      { name: 'Books', emoji: '📚' },
      { name: 'Magazines & news', emoji: '📰' },
      { name: 'Academic & journals', emoji: '🎓' },
      { name: 'Education', emoji: '🏫' },
      { name: 'Print production', emoji: '🖨️' },
      { name: 'Digital & web', emoji: '🌐' },
      { name: 'Accessibility', emoji: '♿' },
      { name: 'Multilingual', emoji: '🌍' },
      { name: 'Workflow', emoji: '🔄' },
      { name: 'Request', emoji: '🙋' },
      { name: 'Pilot interest', emoji: '🤝' },
      { name: 'Acknowledged', emoji: '👀', moderated: true },
      { name: 'Planned', emoji: '🗺️', moderated: true },
      { name: 'Shipped', emoji: '🚀', moderated: true },
    ],
  },
  showcase: {
    layout: 'gallery', sort: 'creation', reaction: '✨', requireTag: false,
    tags: [
      { name: 'Book', emoji: '📚' },
      { name: 'Magazine', emoji: '📰' },
      { name: 'Academic', emoji: '🎓' },
      { name: 'Web', emoji: '🌐' },
      { name: 'Print / PDF', emoji: '🖨️' },
      { name: 'Tool / plugin', emoji: '🧰' },
      { name: 'Experiment', emoji: '🧪' },
    ],
  },
};

// Messages the bot keeps in sync. Files live in content/. A line containing only
// `<!-- split -->` starts a new Discord message (max 2000 characters each).
export const messages = [
  { key: 'welcome', channel: 'welcome', file: 'welcome.md' },
  { key: 'rules', channel: 'rules', file: 'rules.md' },
  { key: 'resources', channel: 'resources', file: 'resources.md' },
  { key: 'videos-intro', channel: 'videos', file: 'videos.md' },
  { key: 'contributing', channel: 'contributing', file: 'contributing.md', pin: true },
  { key: 'publishers', channel: 'publishing-lounge', file: 'publishers.md', pin: true },
];

// Server onboarding (Community servers). Needs ≥7 default channels, ≥5 of them writable.
export const onboarding = {
  defaultChannels: [
    'welcome', 'rules', 'announcements', 'videos', 'resources',
    'general', 'introductions', 'typography', 'showcase', 'help', 'feature-requests',
  ],
  prompts: [
    {
      title: 'What brings you to Postext?',
      single_select: false, required: true, in_onboarding: true,
      options: [
        { title: 'I work in publishing', emoji: '📚',
          description: 'Publisher, editor, production or editorial team',
          roles: ['publisher'], channels: ['publisher-desk', 'publishing-lounge', 'print-production'] },
        { title: 'I build with Postext', emoji: '💻',
          description: 'Developer integrating Postext into a product or pipeline',
          roles: ['developer'], channels: ['integrations', 'development'] },
        { title: 'I love typography & design', emoji: '🔤',
          description: 'Typographer, book designer, layout nerd',
          roles: ['typographer'], channels: ['print-production'] },
        { title: 'I want to contribute', emoji: '🛠️',
          description: 'Code, tests, design or format schema',
          roles: [], channels: ['contributing', 'development', 'github-feed'] },
        { title: 'I write docs or translate', emoji: '✍️',
          description: 'Documentation, examples and translations',
          roles: ['writer'], channels: ['docs-and-translations', 'contributing'] },
      ],
    },
    {
      title: 'Which notifications would you like?',
      single_select: false, required: false, in_onboarding: true,
      options: [
        { title: 'New releases', emoji: '🚀', description: 'Get pinged when a new version ships', roles: ['releasePings'], channels: ['releases'] },
        { title: 'New videos', emoji: '🎬', description: 'Get pinged when a new YouTube video is out', roles: ['videoPings'], channels: [] },
        { title: 'Events & office hours', emoji: '📅', description: 'Get pinged for live sessions', roles: ['eventPings'], channels: [] },
      ],
    },
  ],
};

// Welcome screen shown to new members of Community servers (max 5 channels).
export const welcomeScreen = {
  description: 'The community of Postext, the programmable typesetter for the web.',
  channels: [
    { channel: 'rules', emoji: '📜', description: 'Read the community guidelines' },
    { channel: 'help', emoji: '🛟', description: 'Ask a question about Postext' },
    { channel: 'publisher-desk', emoji: '📚', description: 'Publishers: tell us what you need' },
    { channel: 'feature-requests', emoji: '💡', description: 'Suggest and vote on ideas' },
    { channel: 'showcase', emoji: '✨', description: 'See what people build with Postext' },
  ],
};

// AutoMod. Alerts go to #mod-log; staff roles are exempt from keyword rules.
export const automod = [
  { name: 'Block slurs & sexual content', trigger_type: 4,
    trigger_metadata: { presets: [2, 3] }, actions: ['block', 'alert'] },
  { name: 'Block spam', trigger_type: 3, actions: ['block'] },
  { name: 'Block mention spam', trigger_type: 5,
    trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true },
    actions: ['block', 'alert', 'timeout'] },
  { name: 'No invite links or scams', trigger_type: 1,
    trigger_metadata: {
      regex_patterns: ['discord(?:\\.gg|(?:app)?\\.com/invite)/[a-z0-9-]+'],
      keyword_filter: ['free nitro', 'nitro giveaway', '*steamcommunity.ru*', 'airdrop claim'],
    },
    actions: ['block', 'alert'],
    blockMessage: 'Invite links and promotional scams are not allowed here. Ask a moderator if you think this is a mistake.' },
];
