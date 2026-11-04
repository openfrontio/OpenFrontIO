#!/usr/bin/env bash
# Collect the commits a set of release notes should cover.
#
#   range.sh v0.35.3..v35              # patch block: tag to branch tip
#   range.sh v35                       # patch block: last v0.35.x tag to tip
#   range.sh v0.35.3..v0.35.4          # replay a past patch
#   range.sh --major v35               # beta body: main since the v35 branch point
#   range.sh v0.36.0-beta1..main --minus v35   # what a beta2 adds over beta1
#
# `--minus <branch>` leaves out commits that already shipped on that release
# branch, matched by patch id, by PR number in the subject, or by the
# backport bot's "Cherry-pick of #NNNN" body. `--major <branch>` is
# `<merge-base of main and branch>..main --minus <branch>`.
#
# Prints `repo`, `from`, `to`, `head_sha`, `date` (America/Los_Angeles, how
# releases are dated), optional `warning`, `excluded` (count left out by
# --minus), `commits`, then one tab-separated line per commit, oldest first:
#
#   sha  git-author  github-login  pr  subject  co-authors  backport-of
#
# For a backport commit, `pr`, `github-login` and `subject` describe the
# original PR (the one players care about), and `backport-of` is the
# original PR number; otherwise it is "-". Read-only.
set -euo pipefail

minus=""
major=""
range=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --minus) minus="${2:?--minus needs a branch}"; shift 2 ;;
        --major) major="${2:?--major needs a branch}"; shift 2 ;;
        -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
        *) range="$1"; shift ;;
    esac
done

origin_url="$(git remote get-url origin)"
repo="$(sed -E 's#.*github\.com[:/]##; s#\.git$##' <<< "$origin_url")"
echo "repo	$repo"

# origin may be SSH with no agent loaded; fall back to HTTPS with gh's token.
fetch() {
    git fetch --quiet origin "$@" 2> /dev/null \
        || git -c credential.helper='!gh auth git-credential' fetch --quiet "https://github.com/$repo.git" "$@" 2> /dev/null \
        || echo "warning	git fetch $* failed; using local refs, which may be stale"
}
fetch '+refs/tags/*:refs/tags/*'
is_branch() { [[ "$1" =~ ^(main|v[0-9]+)$ ]]; }
# A branch name means its origin tip, never a stale local branch.
resolve() {
    if is_branch "$1"; then
        fetch "+refs/heads/$1:refs/remotes/origin/$1"
        echo "origin/$1"
    else
        echo "$1"
    fi
}
latest_patch_tag() { git tag -l "v0.$1.[0-9]*" | grep -E "^v0\.$1\.[0-9]+$" | sort -V | tail -1 || true; }

if [[ -n "$major" ]]; then
    minus="$major"
    to="$(resolve main)"
    branch_ref="$(resolve "$major")"
    from="$(git merge-base "$branch_ref" "$to")"
elif [[ "$range" == *..* ]]; then
    from="$(resolve "${range%%..*}")"
    to="$(resolve "${range##*..}")"
elif [[ "$range" =~ ^v([0-9]+)$ ]]; then
    to="$(resolve "$range")"
    from="$(latest_patch_tag "${BASH_REMATCH[1]}")"
    [[ -n "$from" ]] || { echo "error: no v0.${BASH_REMATCH[1]}.x tag yet; use --major $range for the .0 notes" >&2; exit 3; }
else
    echo "usage: range.sh <from>..<to> | <vNN> | --major <vNN>  [--minus <vNN>]" >&2
    exit 2
fi

for r in "$from" "$to"; do
    git rev-parse -q --verify "$r^{commit}" > /dev/null || { echo "error: unknown ref $r" >&2; exit 2; }
done
echo "from	$from"
echo "to	$to"
echo "head_sha	$(git rev-parse "$to^{commit}")"
echo "date	$(TZ=America/Los_Angeles date '+%B %-d, %Y')"
git merge-base --is-ancestor "$from" "$to" \
    || echo "warning	$from is not an ancestor of $to; listing only what $to adds"

pr_of() { grep -oE '\(#[0-9]+\)$' <<< "$1" | tr -d '()#' || true; }
backport_of() { grep -oE 'Cherry-pick of #[0-9]+' <<< "$1" | head -1 | grep -oE '[0-9]+' || true; }

# Everything the release branch already shipped, by patch id and by PR
# number. Newline-separated lists, not associative arrays: macOS bash is 3.2.
shipped_patch=""
shipped_pr=""
if [[ -n "$minus" ]]; then
    minus_ref="$(resolve "$minus")"
    base="$(git merge-base "$minus_ref" "$to")"
    shipped_patch="$(git rev-list --no-merges "$base..$minus_ref" \
        | while read -r s; do git show "$s" | git patch-id --stable | cut -d' ' -f1; done)"
    shipped_pr="$(git log --no-merges --format='%s%n%b' "$base..$minus_ref" \
        | grep -oE '(\(#[0-9]+\)$|Cherry-pick of #[0-9]+)' | grep -oE '[0-9]+')"
fi
in_list() { [[ -n "$1" ]] && grep -qxF "$1" <<< "$2"; }

logins=""
if command -v gh > /dev/null 2>&1; then
    logins="$(gh api --paginate "repos/$repo/compare/$(git rev-parse "$from")...$(git rev-parse "$to")?per_page=100" \
        --jq '.commits[] | [.sha, (.author.login // "-")] | @tsv' 2> /dev/null || true)"
fi
login_of() { awk -F'\t' -v s="$1" '$1 == s { print $2; found = 1 } END { if (!found) print "-" }' <<< "$logins"; }

lines=()
excluded=0
while IFS=$'\x1f' read -r -d $'\x1e' sha name subject coauthors body; do
    sha="${sha#$'\n'}"
    pr="$(pr_of "$subject")"
    if [[ -n "$minus" ]]; then
        pid="$(git show "$sha" | git patch-id --stable | cut -d' ' -f1)"
        if in_list "$pid" "$shipped_patch" || in_list "$pr" "$shipped_pr"; then
            excluded=$((excluded + 1)); continue
        fi
    fi
    subject="$(sed -E 's/ \(#[0-9]+\)$//' <<< "$subject")"
    who="$(login_of "$sha")"
    orig="$(backport_of "$body")"
    if [[ -n "$orig" ]]; then
        # The bot's commit carries its own login and a "[v35] " subject;
        # credit and describe the PR it picked instead.
        subject="$(sed -E 's/^\[v[0-9]+\] //' <<< "$subject")"
        if command -v gh > /dev/null 2>&1; then
            IFS=$'\t' read -r name who < <(gh pr view "$orig" --repo "$repo" --json author,title \
                --jq '[.author.login, .author.login] | @tsv' 2> /dev/null || echo "$name	$who")
        fi
        pr="$orig"
    fi
    coauthors="$(tr '\035' '\n' <<< "$coauthors" \
        | grep -viE 'noreply@anthropic\.com|\[bot\]|^claude|copilot|dependabot' \
        | sed -E 's/ *<[^>]*>//' | grep -v '^$' | grep -vxF -e "$name" -e "$who" \
        | paste -sd, - | sed 's/,/, /g' || true)"
    lines+=("${sha:0:9}	$name	$who	${pr:--}	$subject	${coauthors:--}	${orig:--}")
done < <(git log --reverse --no-merges \
    --format='%H%x1f%an%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1f%b%x1e' "$from..$to")

[[ "$excluded" -gt 0 ]] && echo "excluded	$excluded commit(s) already shipped on $minus, left out"
echo "commits	${#lines[@]}"
for l in ${lines[@]+"${lines[@]}"}; do echo "$l"; done
