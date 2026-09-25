#!/usr/bin/env bash
# Collect the commits on a release branch since its last patch tag.
#
#   bash .claude/skills/release/scripts/commits.sh v34
#   bash .claude/skills/release/scripts/commits.sh v34 v0.34.13 v0.34.14   # replay a past range
#
# Prints the last tag, the next tag and the release date (America/Los_Angeles),
# then one tab-separated line per commit, oldest first:
#
#   sha  git-author-name  github-login  pr  subject  co-authors
#
# github-login comes from the GitHub API (gh); without gh it is "-". Merge
# commits, commits already released under another sha (same patch or same PR
# number, i.e. re-picked after a branch reset) and bot/AI co-authors are left
# out. After a reset, "missing" lines list what the last release had and the
# tip does not. Read-only.
set -euo pipefail

branch="${1:?usage: commits.sh <branch, e.g. v34> [since-tag] [until-ref]}"
since="${2:-}"
until_ref="${3:-}"
repo="openfrontio/OpenFrontIO"

if [[ ! "$branch" =~ ^v([0-9]+)$ ]]; then
  echo "error: branch must look like v34, got '$branch'" >&2
  exit 2
fi
minor="${BASH_REMATCH[1]}"

# A failed fetch (offline, lock held by a concurrent fetch) falls back to the
# local refs rather than aborting, but says so.
fetch() { git fetch --quiet origin "$@" 2> /dev/null || echo "warning	git fetch $* failed; using local refs, which may be stale"; }

fetch "+refs/heads/$branch:refs/remotes/origin/$branch"

# Last v0.<minor>.<patch> tag on the remote, by version order.
last_tag="${since:-$(git ls-remote --tags --refs origin "v0.$minor.*" \
  | sed 's#.*refs/tags/##' \
  | grep -E "^v0\.$minor\.[0-9]+$" \
  | sort -V | tail -1 || true)}"

if [[ -z "$last_tag" ]]; then
  echo "error: no v0.$minor.<patch> tag exists yet; the v0.$minor.0 notes are written by hand" >&2
  exit 3
fi

fetch "+refs/tags/$last_tag:refs/tags/$last_tag"
if [[ -n "$until_ref" ]]; then
  git rev-parse -q --verify "$until_ref^{commit}" > /dev/null || fetch "+refs/tags/$until_ref:refs/tags/$until_ref"
  head="$until_ref"
else
  head="origin/$branch"
fi
patch="${last_tag##*.}"
next_tag="v0.$minor.$((patch + 1))"

echo "last_tag	$last_tag"
echo "next_tag	$next_tag"
echo "date	$(TZ=America/Los_Angeles date '+%B %-d, %Y')"

# The clone may be shallow; deepen until the tag and head share history.
for depth in 200 1000 5000; do
  git merge-base "$last_tag" "$head" > /dev/null 2>&1 && break
  fetch --depth="$depth" "+refs/heads/$branch:refs/remotes/origin/$branch"
done
if ! git merge-base "$last_tag" "$head" > /dev/null 2>&1; then
  echo "error: $last_tag and $head share no history" >&2
  exit 4
fi
if ! git merge-base --is-ancestor "$last_tag" "$head"; then
  echo "warning	$last_tag is not an ancestor of $head (branch was reset or rebuilt); listing what $head adds, minus cherry-picks of released commits"
fi

# Commits the tip adds (right) and commits the last release had that the tip
# lacks (left, only non-empty after a reset). Patch-identical pairs cancel out;
# a re-picked commit whose patch changed is caught by its PR number instead.
pr_of() { grep -oE '\(#[0-9]+\)$' <<< "$1" | tr -d '()#' || true; }
declare -A left_pr=() right_pr=()
while IFS=$'\x1f' read -r sha subject; do
  p="$(pr_of "$subject")"
  [[ -n "$p" ]] && right_pr[$p]=1
done < <(git log --format='%H%x1f%s' --cherry-pick --right-only --no-merges "$last_tag...$head")
missing=()
while IFS=$'\x1f' read -r sha name subject; do
  p="$(pr_of "$subject")"
  [[ -n "$p" ]] && left_pr[$p]=1
  [[ -n "$p" && -n "${right_pr[$p]:-}" ]] && continue
  missing+=("${sha:0:9}	$name	${p:--}	$(sed -E 's/ \(#[0-9]+\)$//' <<< "$subject")")
done < <(git log --reverse --format='%H%x1f%an%x1f%s' --cherry-pick --left-only --no-merges "$last_tag...$head")

# Released in the last tag but gone from the tip: a dropped revert brings its
# change back, a dropped fix takes it away. Neither shows in the commit list.
for m in "${missing[@]}"; do echo "missing	$m"; done

declare -A login=()
if command -v gh > /dev/null 2>&1; then
  while IFS=$'\t' read -r sha l; do login[$sha]="$l"; done < <(
    gh api --paginate "repos/$repo/compare/$last_tag...${until_ref:-$branch}?per_page=100" \
      --jq '.commits[] | [.sha, (.author.login // "-")] | @tsv'
  )
fi

lines=()
repicked=0
while IFS=$'\x1f' read -r -d $'\x1e' sha name subject coauthors; do
  sha="${sha#$'\n'}"
  pr="$(pr_of "$subject")"
  if [[ -n "$pr" && -n "${left_pr[$pr]:-}" ]]; then
    repicked=$((repicked + 1))
    continue
  fi
  subject="$(sed -E 's/ \(#[0-9]+\)$//' <<< "$subject")"
  # Drop bots and AI assistants, then the email addresses.
  coauthors="$(tr '\035' '\n' <<< "$coauthors" \
    | grep -viE 'noreply@anthropic\.com|\[bot\]|^claude|copilot|dependabot' \
    | sed -E 's/ *<[^>]*>//' | grep -v '^$' | paste -sd, - | sed 's/,/, /g' || true)"
  lines+=("${sha:0:9}	$name	${login[$sha]:--}	${pr:--}	$subject	${coauthors:--}")
done < <(git log --reverse --format='%H%x1f%an%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e' \
  --cherry-pick --right-only --no-merges "$last_tag...$head")

[[ "$repicked" -gt 0 ]] && echo "repicked	$repicked commit(s) already released under another sha, left out"
echo "commits	${#lines[@]}"
for l in "${lines[@]}"; do echo "$l"; done
