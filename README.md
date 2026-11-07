# Git GUI Client

A GitKraken-style Git GUI built with **Tauri 2**, **React + TypeScript**, and a hybrid Rust git backend (`git2`/libgit2 for reads, the `git` CLI for mutations).

![stack](https://img.shields.io/badge/Tauri-2.x-ffc131) ![react](https://img.shields.io/badge/React-18-61dafb) ![rust](https://img.shields.io/badge/Rust-git2%20%2B%20CLI-orange)

## Features

- **Commit history table** — lane-based commit graph (merge-aware), author, relative dates, and branch/tag/HEAD badges on each commit
- **Older history access** — load older commits in batches from the history view
- **Commit actions** — cherry-pick or revert a commit from its history row
- **Reset to commit** — move the current branch to a selected commit using soft, mixed, or hard reset
- **Commit details** — full message, author/committer info, per-file stats (`+/-`), click a file to see its diff
- **Branches panel** — create/delete local and remote branches, per-branch dropdown menu to switch branches (remote branches automatically create a local tracking branch)
- **Remotes and upstreams** — add/edit/remove remotes, choose a remote for fetch/push, and set or clear a local branch's upstream
- **Remote safety options** — toggle stale-branch pruning on fetch and lease-guarded force-push behavior per repository
- **Tags panel** — create tags on the selected commit (or `HEAD` when none is selected), delete tags, push all local tags to the selected remote, and click a tag to jump to the tagged commit in history
- **Changes panel** — staged / unstaged / untracked grouping with per-file and stage-all/unstage-all actions; stage or unstage individual diff hunks
- **Diff view** — Monaco editor with syntax highlighting, split/inline toggle, staged vs. unstaged vs. commit diffs, binary-file detection
- **Commit controls** — commit message box with amend support (`Ctrl+Enter` to commit), staged-file counter
- **GitLab project browser** — browse projects accessible to a configured self-hosted GitLab account and clone them directly into a new tab
- Auto-refresh every 5s so external `git` operations show up live

## Tech stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Shell    | Tauri 2 (Rust)                                              |
| Git read | [`git2`](https://github.com/rust-lang/git2-rs) (libgit2)   |
| Git write| `git` CLI subprocess (hooks, aliases and edge cases intact) |
| Frontend | React 18, TypeScript, Vite 5                                |
| Diff     | Monaco Editor (`@monaco-editor/react`)                      |

## Project structure

```
├── src/                      # React frontend
│   ├── api.ts                # TypeScript types + Tauri invoke wrappers
│   ├── monaco.ts             # Monaco editor + web-worker setup
│   ├── App.tsx               # Layout & state
│   └── components/           # Header, Sidebar panels, CommitList (graph),
│                             # DiffView, CommitDetails, CommitBox, Welcome
└── src-tauri/
    ├── src/lib.rs            # Tauri commands (invoke handlers)
    └── src/git/
        ├── mod.rs            # Read ops: status, log, branches, tags, diffs
        └── cli.rs            # Mutations via git CLI: stage, commit, checkout…
```

## Getting started

Prerequisites: Rust (≥ 1.77), Node.js (≥ 20.19), `git`, and the Tauri system dependencies for your OS (see <https://v2.tauri.app/start/prerequisites/>).

```bash
npm install
npm run tauri dev        # starts vite + builds & launches the app
```

Production build:

```bash
npm run tauri build      # outputs bundles in src-tauri/target/release/bundle
```

## Scripts

| Command              | Description                     |
| -------------------- | ------------------------------- |
| `npm run dev`        | Vite dev server only            |
| `npm run build`      | Type-check + production build   |
| `npm run tauri dev`  | Full desktop dev loop           |
| `npm run tauri build`| Release bundles                 |
