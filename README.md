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

`youtube.mjs` reads the channel's RSS feed and posts every video that isn't in #videos yet. It follows the English playlist ("Postext — in English", `youtube.playlistId` in the config), so only English videos are posted. A re-uploaded video (same title, new ID) updates the existing post instead of posting it twice. Videos newer than 24h ping **@Video Pings**, and older ones (backfill) are posted without a ping. Posts are cross-posted to servers that follow #videos.

## Releases → #releases

`releases.mjs` posts the release notes of every published Postext version (`vX.Y.Z` tags in drnachio/postext) to #releases. Postext's release workflow only pushes a tag after build, tests and the npm publish succeed, so a failed release never gets a note. The notes are built from the commits between a tag and the previous one, grouped by type (`feat` → New features, `fix` → Bug fixes, `perf`, `docs`, `skill`, …); tests, CI and chores are only counted. Long versions are split across up to 4 messages. Versions newer than 24h ping **@Release Pings** and are cross-posted to servers following #releases.

To replace the generated notes of a version with hand-written ones, add `content/releases/vX.Y.Z.md` (see `v0.3.16.md`, the first version). `--backfill` posts the whole history on an empty channel (no pings); `--preview <dir>` renders every version to files without touching Discord.

## Automation

[`.github/workflows/feeds.yml`](.github/workflows/feeds.yml) runs both feeds every hour with the repo secrets `DISCORD_TOKEN` and `GUILD_ID`. Run it by hand from the Actions tab (**Feeds → Discord → Run workflow**) to post right away.

## GitHub → #github-feed

Setup creates a webhook and saves its URL (already ending in `/github`) to `.secrets.json`. Add it in **drnachio/postext → Settings → Webhooks** with content type `application/json`, and pick the events you want (Issues, Pull requests, Releases, Discussions).

## Manual steps (not exposed by the Discord API)

- **Server Guide** (Server Settings → Onboarding → Server Guide): add the welcome message, new-member to-dos (e.g. "Read the rules", "Introduce yourself"), and resource pages.
- **Server icon & banner**: use the Postext logo.
- Give yourself the **Maintainer** role, and give trusted people **Moderator**.
