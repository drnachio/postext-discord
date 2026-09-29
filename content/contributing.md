# 🛠️ Contributing to Postext

Postext is a community-driven open-source project, and contributions of every kind are welcome, whatever your experience level. That includes **code, tests, documentation, translations, typography, design and format schema design**.

## How work flows
**1.** An idea starts as a [GitHub Issue](<{link:github}/issues>) or [Discussion](<{link:github}/discussions>). Talking it through here first is fine too.
**2.** The community discusses the approach.
**3.** You open a pull request against `develop`.
**4.** It gets reviewed and merged.

⚠️ **Open an issue before writing code.** It avoids duplicate work and makes sure your time is well spent.

## Dev setup
Requirements: Node.js ≥ 20 and pnpm ≥ 10.
```bash
git clone https://github.com/drnachio/postext.git
cd postext && pnpm install
pnpm dev          # library watch + docs site
pnpm build && pnpm test && pnpm check-types && pnpm lint
```
The repo is a pnpm + Turborepo monorepo: `packages/postext` (engine), `postext-pdf` (PDF backend), `postext-sandbox` (sandbox UI) and `apps/web` (docs site).
<!-- split -->
## Conventions worth knowing
• TypeScript strict mode, ESM only. CI rejects PRs that fail lint.
• Docs are **bilingual** (`<topic>-en.mdx` / `<topic>-es.mdx`), and both languages must be updated together.
• Commit subjects use the imperative mood: "add column balancing", not "added…".
• Keep PRs focused, link the related issue, and add tests for changed behaviour.

## Where to talk
{#development}: engine internals, algorithms, renderers
{#integrations}: frameworks, CMSs, pipelines, AI agents
{#docs-and-translations}: docs, cookbook recipes, translations
{#github-feed}: live activity from the repository

📖 Full guide: [CONTRIBUTING.md](<{link:github}/blob/develop/CONTRIBUTING.md>)

Contributors with a merged PR get the {@contributor} role. Just let a maintainer know! 💚
