# Postext Discord

Infrastructure-as-code for the Postext Discord server. The whole server (roles, channels, forums, permissions, welcome message, guidelines, onboarding, AutoMod) is described in [`server.config.mjs`](server.config.mjs) and [`content/`](content/). `setup.mjs` makes the server match those files. It's idempotent, so edit and re-run whenever you like.

## One-time bot setup

1. Go to <https://discord.com/developers/applications> → **New Application** → name it `Postext`.
2. **Bot** tab → **Reset Token** → copy it. Leave *Privileged Gateway Intents* off; they aren't needed.
3. **OAuth2 → URL Generator** → scopes `bot`, permissions `Administrator` → open the generated URL and add the bot to the Postext server.
4. In Discord: *User Settings → Advanced → Developer Mode* on, then right-click the server icon → **Copy Server ID**.
5. `cp .env.example .env` and paste both values into `.env`. This file is git-ignored, so **never commit it or paste the token anywhere else**.

## Commands

```bash
npm run validate                        # offline checks (lengths, references, onboarding rules)
npm run plan                            # dry run: show what would change
node setup.mjs --enable-community       # first run: builds everything + enables Community
npm run setup                           # later runs: sync changes
npm run youtube                         # post new YouTube videos to #videos
```

`state.json` stores channel, role and message IDs so that re-runs **edit** the existing messages instead of posting new ones. Commit it. `.secrets.json` holds the GitHub webhook URL. Don't commit that one.

## Editing content

- Messages live in `content/*.md`. A line with just `<!-- split -->` starts a new Discord message (max 2000 chars each).
- Forums live in `content/forums/*.md`. Text before `<!-- pinned post: Title -->` becomes the forum's guidelines, and text after it becomes the pinned, locked post.
- Placeholders: `{#channel}` for channel mentions, `{@roleKey}` for role mentions (never pings), `{customize}` for Channels & Roles, `{link:name}` for links from `server.config.mjs`.

## YouTube → #videos

`youtube.mjs` reads the channel's RSS feed and posts every video that isn't in #videos yet. It only posts the English versions (`youtube.language` in the config). Videos newer than 24h ping **@Video Pings**, and older ones (backfill) are posted without a ping. Posts are cross-posted to servers that follow #videos.

To run it automatically, push this folder to a GitHub repo and add the repo secrets `DISCORD_TOKEN` and `GUILD_ID`. [`.github/workflows/youtube.yml`](.github/workflows/youtube.yml) then checks every hour.

## GitHub → #github-feed

Setup creates a webhook and saves its URL (already ending in `/github`) to `.secrets.json`. Add it in **drnachio/postext → Settings → Webhooks** with content type `application/json`, and pick the events you want (Issues, Pull requests, Releases, Discussions).

## Manual steps (not exposed by the Discord API)

- **Server Guide** (Server Settings → Onboarding → Server Guide): add the welcome message, new-member to-dos (e.g. "Read the rules", "Introduce yourself"), and resource pages.
- **Server icon & banner**: use the Postext logo.
- Give yourself the **Maintainer** role, and give trusted people **Moderator**.
