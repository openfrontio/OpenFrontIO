---
name: release
description: Cut the next patch release on an OpenFront release branch - `/release v34` finds the last v0.34.x tag, collects the commits on the v34 branch since it, writes one curated player-facing line per change with its author, and creates a draft GitHub release v0.34.N+1 whose notes are the new section stacked on top of the previous release's notes. Use whenever the user types /release, or asks to cut, tag, ship, draft or write release notes / a changelog for a vNN branch or a v0.NN.x version, even if they don't say "skill".
---

# /release <branch>

`/release v34` makes the next patch release of the `v34` branch of
`openfrontio/OpenFrontIO`. The argument is the branch (`v34`), not a version;
if the user gives a version like `v0.34.19`, take the branch from its minor
number and check the patch is the next one.

Release notes on this repo are **cumulative**: each release's body is its own
new section on top, followed by the previous release's body unchanged, so the
latest release page reads as the whole v0.34 changelog. Look at the latest
release first if you have not seen one this session:
`gh release view --repo openfrontio/OpenFrontIO` (or the latest v0.<minor>.x).

## 1. Collect the commits

Run the script from the root of an OpenFrontIO checkout. It lives in this
skill's directory: `.claude/skills/release/` in the repo, or
`~/.claude/skills/release/` if the skill is installed for your user.

```bash
bash .claude/skills/release/scripts/commits.sh v34 # or ~/.claude/skills/release/scripts/commits.sh
```

It prints `last_tag`, `next_tag`, `date` (today in America/Los_Angeles, which
is how every release is dated), possibly `warning`, `missing` and `repicked`
lines, `commits`, then one tab-separated line per commit, oldest first:
`sha  git-author  github-login  pr  subject  co-authors`.

- `commits 0`: say there is nothing to release since `last_tag` and stop.
- Exit 3 (no `v0.<minor>.*` tag yet): the `.0` release of a branch has a
  hand-written overview and categorised sections. Say so and stop; don't try to
  generate it.
- A `warning` that the last tag is not an ancestor means the branch was reset
  or rebuilt since the last release (it has happened on v34). The list may then
  hold things that were never meant for this release. Put the warning at the top
  of what you show the user.
- `missing` lines are commits the last release shipped that the tip no longer
  has. These matter more than anything in the commit list, because they change
  what players get without appearing in it: a missing revert brings the
  reverted change back (v0.34.14 silently re-shipped the New Zealand map this
  way), and a missing fix un-fixes something. Name each one to the user and ask
  whether it's intended before drafting. Don't write notes that paper over it.
- `repicked` says how many commits were left out because the last release
  already shipped the same PR under another sha. No action needed; mention the
  count.

If the subject is too terse to write a player-facing line from, read the
commit (`git show --stat <sha>`) or the PR (`gh pr view <pr>`). Don't guess
what a change does.

## 2. Write the section

Exact shape (the date is unpadded, month spelled out):

```text
# v0.34.19
*September 25, 2026*

- Let hosts pay to put a listed lobby in the public Special queue — **Evan**
- Better latency reporting — **Evan**
- fix(steam): prevent hardware back button from exiting app — **ayushthepiro11-design**
```

Between the summary and the author goes a space, an em dash (—) and a space,
and each author is bold. Several
authors: `— **Ryan**, **ItsTimeTooSleep**`.

### Curating

The readers are players, so the list says what changed for them, not what the
diff did. The real notes turn 12 commits into 8 lines, or six telemetry commits
into one. So:

- **Rewrite for players.** Say what changed as they see it, in plain words:
  "Render cosmetic grids lazily so large catalogs don't freeze the client"
  becomes "Fix the main menu freezing for players with large cosmetic
  collections; the store and inventory now load as you scroll". A subject that
  already reads well can stay as it is. Keep it to one line.
- **Strip** the `(#1234)` PR suffix. Drop the `feat(x):` / `fix(x):` prefix
  when you rewrite a line; it's fine to keep it when you keep the subject as is.
  Keep `meta:` for balance changes, since players look for it.
- **Fold** a run of related internal commits by the same person into one line:
  telemetry, logging, metrics, deploy plumbing. For example "More observability
  and telemetry improvements — **Evan**" or "Various infrastructure improvements
  — **Evan**".
- **Drop** what no player or server operator would notice: CI and workflow
  changes, docs, refactors with no behaviour change, test-only commits, lint
  and formatting, dependency bumps (unless it's a security fix), and a commit
  together with its revert. Don't drop real bug fixes, even small ones.
- **Order**: the most noticeable changes first (new features, then fixes that
  players hit), internal and folded lines last.

Keep a list of what you dropped or folded and why. You show it in step 3 so
the user can put anything back.

### Author names

The name is the person's usual display name, not their email:

1. Known team members always go by these names:
   `Evan` / `evanpelle` → **Evan**, `Josh Harris` → **Josh**,
   `iamlewis` → **Lewis**.
2. Otherwise, if the git author name is a real multi-word name, use the first
   word: `Panindhra Tallapudi` → **Panindhra**.
3. Otherwise (a single-word handle) use the GitHub login when the script found
   one, since git names drift from GitHub handles: git `Kinatic11` →
   **ayushthepiro11-design**. With no login (`-`), use the git name.

If two different people in one section would end up with the same name (Josh
Harris and Josh Bradley are both "Josh"), use full names for the ones who
aren't in the table.

Credit human co-authors too (the script already leaves out bots and AI
assistants). Never put an email address in the notes.

## 3. Show, then create a draft

Before anything touches GitHub, show the user:

- `last_tag` → `next_tag`, the date, and any warning;
- the new section exactly as it will appear;
- what you dropped or folded, one line each with the short sha.

Then create the release **as a draft**. Build the body as the new section, a
blank line, and the previous release's body as it is:

```bash
prev="$(gh release view v0.34.18 --repo openfrontio/OpenFrontIO --json body --jq .body)"
printf '%s\n\n%s\n' "$(cat section.md)" "$prev" | tr -d '\r' > body.md
gh release create v0.34.19 --repo openfrontio/OpenFrontIO \
  --draft --target v34 --title v0.34.19 --notes-file body.md
```

Bodies edited in GitHub's web editor come back with CRLF line endings; the
`tr` makes the whole body LF so it isn't mixed. That is the only change to the
previous body. Write `section.md` and `body.md` in a scratch directory, not the
repo. Take the
previous body from the `last_tag` release itself, not from GitHub's "latest"
(which could be another branch). A draft creates no tag and notifies nobody, so
this step is safe to redo: if the user wants changes, edit the draft with
`gh release edit v0.34.19 --notes-file body.md`, don't create a second one.

Give the user the draft's URL and stop there.

## 4. Publish only when told to

Publishing creates the tag on `v34` and is public, so do it only when the user
says so after seeing the draft:

```bash
gh release edit v0.34.19 --repo openfrontio/OpenFrontIO --draft=false
```

If a newer release line has already been published (a `v0.35.x` exists), add
`--latest=false` so this patch doesn't take the "Latest" badge from it.

## If gh is not available

Without `gh`, logins come back as `-`, so use the git name for handles and say
that you did. You also can't create the draft. If a GitHub tool you do have can
read the `last_tag` release, use it to build the full `body.md`; if not, write
only `section.md` and say it goes above the existing notes. Give the user the
file path and the `gh release create` command above, and stop. Never create or
publish a release through some other route. The user's review of the draft is
the point of step 3.
