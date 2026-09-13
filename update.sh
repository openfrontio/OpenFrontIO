#!/bin/bash
# update.sh - Script to update Docker container on Hetzner server
# Called by deploy.sh after uploading Docker image to Docker Hub
set -eo pipefail

# Check if environment file is provided
if [ $# -ne 1 ]; then
    echo "Error: Environment file path is required"
    echo "Usage: $0 <env_file_path>"
    exit 1
fi

ENV_FILE="$1"

# Check if environment file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Environment file '$ENV_FILE' not found"
    exit 1
fi

# Load environment variables from the provided file
echo "Loading environment variables from $ENV_FILE..."
export $(grep -v '^#' "$ENV_FILE" | xargs)

echo "======================================================"
echo "🔄 UPDATING SERVER: ${HOST} ENVIRONMENT"
echo "======================================================"

# Container and image configuration
CONTAINER_NAME="openfront-${ENV}-${SUBDOMAIN}"

echo "Pulling ${GHCR_IMAGE} from GitHub Container Registry..."
docker pull "${GHCR_IMAGE}"

# Upload hashed assets to R2 before swapping containers. If this fails the old
# container keeps serving — better than a stop-then-fail outage.
echo "======================================================"
echo "📦 Uploading assets to R2 for ${DOMAIN}..."
echo "======================================================"

if [ -z "$DOMAIN" ] || [ -z "$API_KEY" ]; then
    echo "❌ DOMAIN or API_KEY not set; cannot upload assets."
    exit 1
fi
for cmd in jq curl xargs; do
    if ! command -v "$cmd" > /dev/null 2>&1; then
        echo "❌ Required tool '$cmd' not found. Install via setup.sh."
        exit 1
    fi
done

EXTRACT_DIR="$(mktemp -d -t openfront-assets-XXXXXX)"
trap 'rm -rf "$EXTRACT_DIR"' EXIT

TMP_CONTAINER="$(docker create "${GHCR_IMAGE}")"
if ! docker cp "${TMP_CONTAINER}:/usr/src/app/static" "$EXTRACT_DIR/"; then
    echo "❌ docker cp failed"
    docker rm "${TMP_CONTAINER}" > /dev/null 2>&1 || true
    exit 1
fi
docker rm "${TMP_CONTAINER}" > /dev/null

STATIC_DIR="$EXTRACT_DIR/static"
echo "Extracted to $STATIC_DIR; top-level contents:"
ls -la "$STATIC_DIR/" || true

R2_ENDPOINT="https://api.${DOMAIN}"
# The hostname players load the page from, which is what the server list and
# the static Worker are keyed by (docs/MultiServer.md, "Server list v2"). Behind
# a load balancer that is the apex (SITE_HOST); a standalone deployment — beta,
# a branch preview — is its own site.
SITE="${SITE_HOST:-${SUBDOMAIN}.${DOMAIN}}"
MANIFEST="$STATIC_DIR/asset-manifest.json"
if [ ! -f "$MANIFEST" ]; then
    echo "❌ Manifest not found at $MANIFEST"
    exit 1
fi

# Manifest values are like "/_assets/foo/bar.<hash>.png"; strip the leading "/".
KEYS_JSON="$(jq '[.[] | sub("^/"; "")]' "$MANIFEST")"
TOTAL="$(echo "$KEYS_JSON" | jq 'length')"
echo "Checking $TOTAL asset keys against $R2_ENDPOINT..."

CHECK_BODY="$(mktemp)"
HTTP_CODE="$(curl -sS --connect-timeout 10 --max-time 120 \
    -o "$CHECK_BODY" -w "%{http_code}" -X POST "$R2_ENDPOINT/game_assets/check" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"keys\": $KEYS_JSON}")"
if [ "$HTTP_CODE" != "200" ]; then
    echo "❌ /check returned HTTP $HTTP_CODE:"
    cat "$CHECK_BODY"
    rm -f "$CHECK_BODY"
    exit 1
fi
if ! jq -e '.missing | type == "array"' "$CHECK_BODY" > /dev/null; then
    echo "❌ /check response missing '.missing' array:"
    cat "$CHECK_BODY"
    rm -f "$CHECK_BODY"
    exit 1
fi
MISSING="$(jq -r '.missing[]' "$CHECK_BODY")"
rm -f "$CHECK_BODY"

if [ -z "$MISSING" ]; then
    echo "✅ All $TOTAL assets already in R2; nothing to upload."
else
    MISSING_COUNT="$(echo "$MISSING" | wc -l | tr -d ' ')"
    echo "Uploading $MISSING_COUNT missing asset(s)..."
    export R2_ENDPOINT API_KEY STATIC_DIR
    # KEY from the manifest is URL-encoded per segment (e.g. flags/C%C3%B4te.png).
    # Files on disk live at the *decoded* path, so decode KEY before reading the
    # file, then encode the whole decoded path as one URL segment for the POST.
    # NUL-delimit the keys: xargs's default tokenizer treats quotes specially,
    # so a key with an apostrophe (e.g. flags/Mi'"'"'kmaq.svg) aborts the batch.
    if ! echo "$MISSING" | tr '\n' '\0' | xargs -0 -P 16 -I{} bash -euc '
        KEY="$1"
        # Validate KEY: only chars that encodeURIComponent leaves literal
        # (A-Z a-z 0-9 - _ . ! ~ * ( ) plus apostrophe), "/" between segments,
        # and well-formed %HH escapes. The %HH check makes the printf-based
        # decoder below safe by rejecting partial escapes; excluding "\" keeps
        # printf "%b" from interpreting unexpected backslash sequences. The
        # regex lives in a variable so the literal apostrophe sits inside a
        # double-quoted assignment instead of being parsed as a shell quote.
        RE="^([A-Za-z0-9._/~!*'\''()-]|%[0-9A-Fa-f]{2})+\$"
        [[ "$KEY" =~ $RE ]] || {
            echo "❌ invalid key from server: $KEY" >&2; exit 1
        }
        DECODED="$(printf "%b" "${KEY//%/\\x}")"
        # Defense-in-depth: refuse any decoded path that escapes the asset tree,
        # in case the trusted /check endpoint is ever compromised.
        case "$DECODED" in
            /* | *..* ) echo "❌ refusing unsafe path: $DECODED" >&2; exit 1 ;;
        esac
        ENC="$(jq -rn --arg k "$DECODED" "\$k|@uri")"
        if ! curl -fsS \
            --retry 5 --retry-all-errors --retry-delay 2 \
            --connect-timeout 10 --max-time 120 \
            -X PUT \
            "$R2_ENDPOINT/game_assets/upload/$ENC" \
            -H "X-API-Key: $API_KEY" \
            -H "Content-Type: application/octet-stream" \
            --data-binary "@$STATIC_DIR/$DECODED" > /dev/null; then
            echo "❌ Failed to upload: $DECODED" >&2
            exit 1
        fi
    ' _ {}; then
        echo "❌ One or more asset uploads failed."
        exit 1
    fi
    echo "✅ Uploaded $MISSING_COUNT asset(s) to R2."
fi

# Publish a fully-rendered app shell as index-<short-commit>.html next to the
# hashed assets, so games archived from this build can still be replayed after
# this deployment is torn down (#4934). Old clients find it via the same short
# prefix of the record's gitCommit (see src/client/VersionedReplay.ts).
# Rendered inside the image with the same env file the live container gets, so
# the baked BOOTSTRAP_CONFIG matches what the server would have served.
FULL_COMMIT="$(tr -d '[:space:]' < "$STATIC_DIR/commit.txt" 2> /dev/null || true)"
if [[ ! "$FULL_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
    echo "⚠️ Skipping versioned index upload: commit.txt is not a full SHA ('$FULL_COMMIT')"
else
    INDEX_KEY="index-${FULL_COMMIT:0:7}.html"
    echo "Rendering $INDEX_KEY..."
    if ! docker run --rm --env-file "$ENV_FILE" --entrypoint npx \
        "${GHCR_IMAGE}" tsx src/server/RenderStaticIndex.ts \
        > "$EXTRACT_DIR/$INDEX_KEY"; then
        echo "❌ Failed to render $INDEX_KEY"
        exit 1
    fi
    # Guard against uploading an empty or non-shell document (e.g. a renderer
    # crash that still exited 0 upstream of the redirect).
    if ! grep -q "BOOTSTRAP_CONFIG" "$EXTRACT_DIR/$INDEX_KEY"; then
        echo "❌ Rendered $INDEX_KEY looks wrong (no BOOTSTRAP_CONFIG)"
        exit 1
    fi
    if ! curl -fsS \
        --retry 5 --retry-all-errors --retry-delay 2 \
        --connect-timeout 10 --max-time 120 \
        -X PUT \
        "$R2_ENDPOINT/game_assets/upload/$INDEX_KEY" \
        -H "X-API-Key: $API_KEY" \
        -H "Content-Type: application/octet-stream" \
        --data-binary "@$EXTRACT_DIR/$INDEX_KEY" > /dev/null; then
        echo "❌ Failed to upload $INDEX_KEY"
        exit 1
    fi
    echo "✅ Uploaded $INDEX_KEY."

    # --- Per-version publish (multi-server v2) -------------------------------
    #
    # Three more objects, keyed by SITE and the short commit rather than by this
    # container. Together they are everything a player of this version needs
    # that is not already a hashed asset: the page, and the desktop shell's
    # release descriptor plus its cheap poll pointer.
    #
    #   game_assets/sites/<site>/v/<short>/index.html
    #   game_assets/sites/<site>/v/<short>/desktop/release.json
    #   game_assets/sites/<site>/v/<short>/desktop/version.json
    #
    # (The upload endpoint prefixes game_assets/ itself.) Nothing serves these
    # until the static Worker exists, so this is additive and harmless today —
    # see docs/MultiServer.md, "Publish pipeline (v2)".
    #
    # The page is rendered --environment-only: no cluster, instanceLetter,
    # instanceId, serverHost or siteHost. One page per VERSION, not per server,
    # is the whole point; the client asks the API for the server list. The
    # legacy index-<short>.html above deliberately keeps the server values
    # until OPE-431 lands, because today's client throws without a worker-count
    # source.
    SHORT="${FULL_COMMIT:0:7}"
    VERSION_PREFIX="sites/${SITE}/v/${SHORT}"
    echo "Publishing ${VERSION_PREFIX}/ for ${SITE}..."

    # Same single-segment URL encoding the asset loop uses: the whole key goes
    # through jq's @uri, so "/" arrives as %2F and the endpoint stores it at
    # game_assets/<key>.
    upload_versioned() {
        local key="$1" file="$2" content_type="$3" enc
        enc="$(jq -rn --arg k "$key" '$k|@uri')"
        if ! curl -fsS \
            --retry 5 --retry-all-errors --retry-delay 2 \
            --connect-timeout 10 --max-time 120 \
            -X PUT \
            "$R2_ENDPOINT/game_assets/upload/$enc" \
            -H "X-API-Key: $API_KEY" \
            -H "Content-Type: $content_type" \
            --data-binary "@$file" > /dev/null; then
            echo "❌ Failed to upload $key"
            return 1
        fi
        echo "✅ Uploaded $key."
    }

    ENV_INDEX="$EXTRACT_DIR/environment-index.html"
    if ! docker run --rm --env-file "$ENV_FILE" --entrypoint npx \
        "${GHCR_IMAGE}" tsx src/server/RenderStaticIndex.ts --environment-only \
        > "$ENV_INDEX"; then
        echo "❌ Failed to render the environment-only page"
        exit 1
    fi
    # Same sanity check as the replay shell: a renderer that crashed downstream
    # of the redirect would otherwise publish an empty page for the version.
    if ! grep -q "BOOTSTRAP_CONFIG" "$ENV_INDEX"; then
        echo "❌ The environment-only page looks wrong (no BOOTSTRAP_CONFIG)"
        exit 1
    fi
    # A per-server value in a page served to every player of this version would
    # pin them all to one server — exactly what v2 removes. Cheap to assert
    # here, invisible until it hurts otherwise.
    for FIELD in cluster instanceLetter instanceId serverHost siteHost; do
        if grep -q "^ *${FIELD}:" "$ENV_INDEX"; then
            echo "❌ The environment-only page still carries ${FIELD}"
            exit 1
        fi
    done

    DESKTOP_RELEASE="$EXTRACT_DIR/desktop-release.json"
    DESKTOP_VERSION="$EXTRACT_DIR/desktop-version.json"
    if ! docker run --rm --env-file "$ENV_FILE" --entrypoint npx \
        "${GHCR_IMAGE}" tsx src/server/RenderDesktopDescriptor.ts \
        > "$DESKTOP_RELEASE"; then
        echo "❌ Failed to build the desktop release descriptor"
        exit 1
    fi
    if ! docker run --rm --env-file "$ENV_FILE" --entrypoint npx \
        "${GHCR_IMAGE}" tsx src/server/RenderDesktopDescriptor.ts --version-pointer \
        > "$DESKTOP_VERSION"; then
        echo "❌ Failed to build the desktop version pointer"
        exit 1
    fi
    # The shell refuses a descriptor it cannot parse, so publishing a truncated
    # one strands every Steam client on this version.
    if ! jq -e '.schemaVersion and .clientVersion and .template.sha256' \
        "$DESKTOP_RELEASE" > /dev/null; then
        echo "❌ The desktop release descriptor is missing required fields"
        exit 1
    fi
    if ! jq -e '.clientVersion and .coreVersion' "$DESKTOP_VERSION" > /dev/null; then
        echo "❌ The desktop version pointer is missing required fields"
        exit 1
    fi

    upload_versioned "${VERSION_PREFIX}/index.html" "$ENV_INDEX" "text/html" || exit 1
    upload_versioned "${VERSION_PREFIX}/desktop/release.json" \
        "$DESKTOP_RELEASE" "application/json" || exit 1
    upload_versioned "${VERSION_PREFIX}/desktop/version.json" \
        "$DESKTOP_VERSION" "application/json" || exit 1
fi

echo "Checking for existing container..."
# Use docker ps with filter for exact name match
RUNNING_CONTAINER="$(docker ps --filter "name=^${CONTAINER_NAME}$" -q)"
if [ -n "$RUNNING_CONTAINER" ]; then
    echo "Stopping running container $RUNNING_CONTAINER..."
    docker stop "$RUNNING_CONTAINER"
    echo "Waiting for container to fully stop and release resources..."
    sleep 5 # Add a 5-second delay
    docker rm "$RUNNING_CONTAINER"
    echo "Container $RUNNING_CONTAINER stopped and removed."
fi

# Also check for stopped containers with the same name
STOPPED_CONTAINER="$(docker ps -a --filter "name=^${CONTAINER_NAME}$" -q)"
if [ -n "$STOPPED_CONTAINER" ]; then
    echo "Removing stopped container $STOPPED_CONTAINER..."
    docker rm "$STOPPED_CONTAINER"
    echo "Container $STOPPED_CONTAINER removed."
fi

# Docker restart policy. `always` means the daemon brings this container back
# after a crash, and again after a host reboot; `no` means it stays down until
# somebody deploys again.
#
# Which one is right depends entirely on whether the deployment is long-lived,
# and that is what SUBDOMAIN tells us:
#
#   Long-lived, listed below. Something depends on these being reachable at a
#   fixed hostname without anyone watching. `main` and `nightly` are both
#   staging deployments people test against; `nightly` is here because a
#   scheduled deploy is the only thing that would otherwise restart it, so a
#   crash at 07:05 UTC is a ~24-hour outage rather than a blip (OPE-361).
#   `green` and `blue` are the dev pools the same schedule fans out to, with
#   the exact same exposure -- worse, actually, since start.sh caps every
#   non-main dev container at 25h, so without `always` a single missed nightly
#   would leave them dead until the next successful one. Any deployment on the
#   production domain qualifies for the same reason and is matched separately,
#   since its subdomain is not fixed.
#
#   Everything else: a per-branch preview. deploy.yml deploys EVERY push on
#   EVERY branch to <branch>.openfront.dev, so these accumulate one container
#   per branch anyone has ever pushed. `no` is what lets them die quietly --
#   with `always` a host reboot would resurrect months of abandoned branch
#   containers, each holding its memory and its worker processes, and nothing
#   would ever clean them up. Their owner is present when they are deployed and
#   can redeploy, which is exactly the case `no` is for.
#
# To make another fixed hostname survive a crash, add its subdomain here.
#
# The markers below delimit the block that tests/UpdateRestartPolicy.test.ts
# extracts and runs against a table of subdomains -- the rest of this script
# talks to docker and ssh and cannot be executed in a test, but this decision
# can. Keep them in place.
# --- BEGIN restart policy (tested) ---
LONG_LIVED_SUBDOMAINS=" main nightly green blue "

if [[ "${LONG_LIVED_SUBDOMAINS}" == *" ${SUBDOMAIN} "* ]] || [ "${DOMAIN}" = openfront.io ]; then
    RESTART=always
else
    RESTART=no
fi
# --- END restart policy (tested) ---

echo "Starting new container for ${HOST} environment..."

# Ensure the traefik network exists
docker network create web 2> /dev/null || true

docker run -d \
    --restart="${RESTART}" \
    --env-file "$ENV_FILE" \
    --name "${CONTAINER_NAME}" \
    --network web \
    --label "traefik.enable=true" \
    --label "traefik.http.routers.${CONTAINER_NAME}.rule=Host(\`${SUBDOMAIN}.${DOMAIN}\`)" \
    --label "traefik.http.routers.${CONTAINER_NAME}.entrypoints=websecure" \
    --label "traefik.http.routers.${CONTAINER_NAME}.tls=true" \
    --label "traefik.http.services.${CONTAINER_NAME}.loadbalancer.server.port=80" \
    "${GHCR_IMAGE}"

if [ $? -eq 0 ]; then
    echo "Update complete! New ${CONTAINER_NAME} container is running."

    # Final cleanup after successful deployment
    echo "Performing final cleanup of unused Docker resources..."
    echo "Removing unused images (not referenced)..."
    docker image prune -a -f
    docker container prune -f
    echo "Cleanup complete."

    # Remove the environment file
    echo "Removing environment file ${ENV_FILE}..."
    rm -f "$ENV_FILE"
    echo "Environment file removed."
else
    echo "Failed to start container"
    exit 1
fi

# Tell the API which commit new players of this site should get. This is the
# single switch of multi-server v2 (docs/MultiServer.md): servers running
# `latest` are `open` and take new games, everything else drains, and the
# static Worker serves `latest`'s page at <site>/ and its /desktop/*.json.
#
# It runs LAST, after the new container is up, because the API refuses to flag
# a version no server has checked in for — that refusal (409) is the interlock
# that stops a deploy from pointing every player at a build that cannot serve
# them. The container registers within ~10s of boot, so a 409 immediately after
# `docker run` is expected and is retried, not an error. There is no separate
# health wait in this script; this retry loop is the closest thing to one, and
# CI's own "Wait for deployment to start" step polls /commit.txt afterwards.
#
# The markers below delimit the block that tests/UpdateFlagLatest.test.ts
# extracts and runs against a fake curl — the rest of this script talks to
# docker and ssh and cannot be executed in a test, but this decision can. Keep
# them in place.
# --- BEGIN flag latest (tested) ---
# Overridable so the test can drive the same loop without waiting 90 seconds.
: "${FLAG_LATEST_TIMEOUT:=90}"
: "${FLAG_LATEST_RETRY_DELAY:=5}"

# flag_latest <site> <version> <endpoint> <api_key> <cluster_state_source>
#
# Returns 0 when the deploy may report success, 1 when it must not.
#
# The asymmetry is deliberate. While the page and the servers still come from
# BOOTSTRAP_CONFIG, a missing `latest` changes nothing a player can see, so a
# warning is the honest outcome and failing the deploy would be noise. Once
# CLUSTER_STATE_SOURCE=api is in the env file the site's clients get their
# server list from the API, and a version that was never flagged means no
# server is `open`: nobody can start a game. A deploy that ends there has not
# succeeded and must not say it has.
flag_latest() {
    local site="$1" version="$2" endpoint="$3" api_key="$4" state_source="$5"
    local strict=no
    if [ "$state_source" = "api" ]; then
        strict=yes
    fi

    local deadline=$((SECONDS + FLAG_LATEST_TIMEOUT))
    local body code reason
    body="$(mktemp)"

    while :; do
        # No -f: the status code IS the answer here, so it must be read rather
        # than collapsed into a non-zero exit. A curl that cannot reach the API
        # at all (DNS, TLS, connect timeout) exits non-zero AND prints 000, so
        # the fallback must only fill in for a curl that printed nothing —
        # `|| echo 000` would append to curl's own 000 and yield "000000",
        # which falls through to the decide-now arm and kills the retry loop
        # on the one failure it exists to survive.
        if ! code="$(curl -sS --connect-timeout 10 --max-time 30 \
            -o "$body" -w "%{http_code}" \
            -X POST "${endpoint}/cluster/latest" \
            -H "X-API-Key: ${api_key}" \
            -H "Content-Type: application/json" \
            -d "{\"site\": \"${site}\", \"version\": \"${version}\"}")"; then
            code="${code:-000}"
        fi

        case "$code" in
            200 | 204)
                echo "✅ Flagged ${version} as latest for ${site}."
                rm -f "$body"
                return 0
                ;;
            404)
                # The API predates the registry. Never strict: there is nothing
                # to flag and nothing reading it, so this is the expected
                # answer everywhere until the API ships.
                echo "⚠️ ${endpoint}/cluster/latest is not deployed yet (HTTP 404); skipping the latest flag."
                rm -f "$body"
                return 0
                ;;
            409 | 000 | 5??)
                # 409: no server has checked in for this version yet — the
                # normal state for the first few seconds after docker run.
                # 000/5xx: the API is unreachable or broken; same treatment,
                # because the deploy is equally unfinished either way.
                if [ "$SECONDS" -ge "$deadline" ]; then
                    reason="HTTP ${code} after ${FLAG_LATEST_TIMEOUT}s of retries"
                    break
                fi
                echo "… ${endpoint}/cluster/latest returned HTTP ${code}; retrying in ${FLAG_LATEST_RETRY_DELAY}s"
                sleep "$FLAG_LATEST_RETRY_DELAY"
                ;;
            *)
                # 400/401/403 and friends: a bad key or a malformed request.
                # Retrying cannot fix it, so decide now.
                reason="HTTP ${code}"
                break
                ;;
        esac
    done

    echo "⚠️ Failed to flag ${version} as latest for ${site}: ${reason}"
    cat "$body" || true
    rm -f "$body"
    if [ "$strict" = "yes" ]; then
        echo "❌ CLUSTER_STATE_SOURCE=api: clients take their server list from the API, so an unflagged version means no server is open. Failing the deploy."
        return 1
    fi
    echo "   Continuing: this site still boots from the page's own values."
    return 0
}
# --- END flag latest (tested) ---

if [[ "$FULL_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
    if ! flag_latest "$SITE" "$FULL_COMMIT" "$R2_ENDPOINT" "$API_KEY" \
        "${CLUSTER_STATE_SOURCE:-}"; then
        exit 1
    fi
else
    echo "⚠️ Skipping the latest flag: commit.txt is not a full SHA ('$FULL_COMMIT')"
fi

echo "======================================================"
echo "✅ SERVER UPDATE COMPLETED SUCCESSFULLY"
echo "Container name: ${CONTAINER_NAME}"
echo "Image: ${FULL_IMAGE_NAME}"
echo "======================================================"
