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

`youtube.mjs` reads one playlist per language (`youtube.playlists` in the config) from its page, which lists every video (YouTube's feeds stop at 15 per playlist), plus the channel's newest uploads, and announces every video in #videos, always in English: a translation is posted with the title of its English original, taken from the "🇬🇧 English →" (or "English version →") link in its description, its (n/m) part number, or `content/video-map.json`, plus its language. Only English videos newer than 24h ping **@Video Pings** (one ping per video, not one per language). A re-upload (same announcement, new video ID) updates the existing post instead of posting it twice. `--rebuild` deletes the video posts and posts every video again in order, without pings.

## Releases → #releases

`releases.mjs` posts the release notes of every published Postext version (`vX.Y.Z` tags in drnachio/postext) to #releases. Postext's release workflow only pushes a tag after build, tests and the npm publish succeed, so a failed release never gets a note. The notes are built from the commits between a tag and the previous one, grouped by type (`feat` → New features, `fix` → Bug fixes, `perf`, `docs`, `skill`, …); tests, CI and chores are only counted. Long versions are split across up to 4 messages. Versions newer than 24h ping **@Release Pings** and are cross-posted to servers following #releases.

To replace the generated notes of a version with hand-written ones, add `content/releases/vX.Y.Z.md` (see `v0.3.16.md`, the first version). `--backfill` posts the whole history on an empty channel (no pings); `--preview <dir>` renders every version to files without touching Discord.

## Closed issues → #github-feed

`issues.mjs` posts a summary of every issue closed in drnachio/postext: what was asked (the issue's first paragraph), how it was solved or why it was closed (the closing comment), the outcome, the release it ships in (from the merged `Release x.y.z` pull request that references it, else "the next release"), labels, linked pull requests and how long it was open. Pull requests are left out. It resumes from the latest summary in the channel; `issues.since` in the config sets where the very first run starts. `--preview <n>` prints the summary of issue `n` without posting.

## Docs & translations → #docs-and-translations

`docs.mjs` announces the versions that improve the documentation or the translations. Each version is compared with the previous tag through the two file trees (no 300-file limit): a new site language (`apps/web/messages/<lang>.json`), new doc pages (`docs/<topic>-en.mdx`, with their title and plain summary), updated pages and in how many languages (edits to `lastUpdated` / `readingTime` alone don't count), docs pages and cookbook recipes translated, and the `docs:` commits as "What changed" (internal DESIGN notes left out). Versions that touch none of these post nothing. It resumes from the latest version announced in the channel; `docs.since` in the config sets the first run. `--preview <tag>` prints the notice of a version without posting.

## Automation

[`.github/workflows/feeds.yml`](.github/workflows/feeds.yml) runs the four feeds (videos, releases, closed issues, docs & translations) every hour with the repo secrets `DISCORD_TOKEN` and `GUILD_ID`. Run it by hand from the Actions tab (**Feeds → Discord → Run workflow**) to post right away.

## GitHub → #github-feed

Setup creates a webhook and saves its URL (already ending in `/github`) to `.secrets.json`. Add it in **drnachio/postext → Settings → Webhooks** with content type `application/json`, and pick the events you want (Issues, Pull requests, Releases, Discussions).

## Manual steps (not exposed by the Discord API)

- **Server Guide** (Server Settings → Onboarding → Server Guide): add the welcome message, new-member to-dos (e.g. "Read the rules", "Introduce yourself"), and resource pages.
- **Server icon & banner**: use the Postext logo.
- Give yourself the **Maintainer** role, and give trusted people **Moderator**.
