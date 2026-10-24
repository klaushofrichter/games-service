#!/usr/bin/env bash
# Puts the values from this repo's local .env where the deployment needs them, without printing any value:
#   GitHub secret  KUBE_SETUP_DEPLOY_TOKEN      <- GITHUB_KUBE_SETUP_PAT    (the deploy pushes the cluster repository's manifest)
#   k8s Secret     games-runner/runner-pat      <- GITHUB_GAMES_SERVICE_PAT (key `token`: the runner registers itself)
#   k8s Secret     games/games-oauth            <- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
#                                                  ALLOWED_EMAILS, COOKIE_SECRET, CONSOLE_URL, and ADMIN_TOKEN,
#                                                  GAME_REPO_TOKEN, CF_TURN_KEY_ID + CF_TURN_API_TOKEN if set
#
#   scripts/sync-secrets.sh --check     validate .env and list what would be set (default)
#   scripts/sync-secrets.sh --github    set the GitHub secret (needs `gh` signed in with admin on the repo)
#   scripts/sync-secrets.sh --cluster   create or update both Kubernetes Secrets (needs kubectl for the cluster
#                                       and the namespaces games and games-runner, created by the cluster repository)
#   scripts/sync-secrets.sh --all       both
# After changing games-oauth, restart the pod: kubectl -n games rollout restart deployment/games-cloud
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=klaushofrichter/games-service
ENV_FILE=${ENV_FILE:-.env}
MODE=${1:---check}
PUBLIC_URL=https://games.skylar.technology
# The console's own host (D-204, D-205): sign-in returns there.
CONSOLE_URL=https://games-console.skylar.technology

[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE here" >&2; exit 1; }
git check-ignore -q "$ENV_FILE" || { echo "$ENV_FILE is not git-ignored; refusing to continue" >&2; exit 1; }

# Parse KEY=value lines without `source` (values may contain shell characters). The whole rest of the line is the
# value, so an inline "# comment" would become part of a token: reject that instead of shipping it.
declare -A V
problems=()
n=0
while IFS= read -r line || [ -n "$line" ]; do
  n=$((n + 1))
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    k=${BASH_REMATCH[1]} v=${BASH_REMATCH[2]}
    [[ "$v" =~ [[:space:]]# ]] && problems+=("$k has an inline comment; put comments on their own line")
    [[ "$v" =~ ^[\"\'] ]] && problems+=("$k is quoted; write the bare value")
    [[ "$v" =~ [[:space:]]$ ]] && problems+=("$k has trailing whitespace")
    V[$k]=$v
  else
    # Only the line number: the line itself might be a bare token.
    problems+=("line $n is not KEY=value")
  fi
done < "$ENV_FILE"

need() { for k in "$@"; do [ -n "${V[$k]:-}" ] || problems+=("$k is missing"); done; }
need GITHUB_KUBE_SETUP_PAT GITHUB_GAMES_SERVICE_PAT GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI ALLOWED_EMAILS COOKIE_SECRET CONSOLE_URL
[ "${V[CONSOLE_URL]:-}" = "$CONSOLE_URL" ] || problems+=("CONSOLE_URL must be $CONSOLE_URL")
[ "${V[GOOGLE_REDIRECT_URI]:-}" = "$CONSOLE_URL/auth/google/callback" ] || problems+=("GOOGLE_REDIRECT_URI must be $CONSOLE_URL/auth/google/callback")
[[ "${V[GOOGLE_CLIENT_ID]:-}" == 40017202035-*.apps.googleusercontent.com ]] || problems+=("GOOGLE_CLIENT_ID should be a skylar-technology client (40017202035-....apps.googleusercontent.com)")
[ "${#V[COOKIE_SECRET]}" -ge 32 ] 2>/dev/null || problems+=("COOKIE_SECRET must be at least 32 characters (openssl rand -hex 32)")
[ -z "${V[ADMIN_TOKEN]:-}" ] || [ "${#V[ADMIN_TOKEN]}" -ge 16 ] || problems+=("ADMIN_TOKEN must be at least 16 characters, or left out")
for k in GITHUB_KUBE_SETUP_PAT GITHUB_GAMES_SERVICE_PAT; do
  [[ "${V[$k]:-}" == github_pat_* || "${V[$k]:-}" == ghp_* ]] || problems+=("$k does not look like a GitHub token")
done
[ -z "${V[GAME_REPO_TOKEN]:-}" ] || [[ "${V[GAME_REPO_TOKEN]}" == github_pat_* || "${V[GAME_REPO_TOKEN]}" == ghp_* ]] || problems+=("GAME_REPO_TOKEN does not look like a GitHub token")
# Cloudflare TURN (D-209): the key's id and its API token, both or neither.
if [ -n "${V[CF_TURN_KEY_ID]:-}${V[CF_TURN_API_TOKEN]:-}" ] && { [ -z "${V[CF_TURN_KEY_ID]:-}" ] || [ -z "${V[CF_TURN_API_TOKEN]:-}" ]; }; then
  problems+=("Cloudflare TURN needs both CF_TURN_KEY_ID and CF_TURN_API_TOKEN, or neither")
fi
[ -z "${V[GAME_REPOS]:-}" ] || problems+=("GAME_REPOS is not synced to the cluster: the list is deploy/game-repos.json (D-098); remove it from .env")

if ((${#problems[@]})); then printf 'problem: %s\n' "${problems[@]}" >&2; exit 1; fi
OAUTH_KEYS=(GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI ALLOWED_EMAILS COOKIE_SECRET CONSOLE_URL)
[ -n "${V[ADMIN_TOKEN]:-}" ] && OAUTH_KEYS+=(ADMIN_TOKEN)
# Extra-game repositories (D-097): the read token for private ones. Optional. The list itself is not a secret: it is
# deploy/game-repos.json, baked into the image (D-098).
[ -n "${V[GAME_REPO_TOKEN]:-}" ] && OAUTH_KEYS+=(GAME_REPO_TOKEN)
# Relays for remote players behind a phone's or a strict network's NAT (D-209). Optional.
[ -n "${V[CF_TURN_KEY_ID]:-}" ] && OAUTH_KEYS+=(CF_TURN_KEY_ID CF_TURN_API_TOKEN)
echo ".env ok. Keys (values not shown):"
echo "  GitHub secret KUBE_SETUP_DEPLOY_TOKEN  <- GITHUB_KUBE_SETUP_PAT"
echo "  games-runner/runner-pat (token)        <- GITHUB_GAMES_SERVICE_PAT"
echo "  games/games-oauth                      <- ${OAUTH_KEYS[*]}"

do_github() {
  # Through stdin, so the token never appears in a process list.
  printf '%s' "${V[GITHUB_KUBE_SETUP_PAT]}" | gh secret set KUBE_SETUP_DEPLOY_TOKEN --repo "$REPO"
  echo "set GitHub secret KUBE_SETUP_DEPLOY_TOKEN on $REPO"
}

do_cluster() {
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  chmod 700 "$tmp"
  for k in "${OAUTH_KEYS[@]}"; do printf '%s=%s\n' "$k" "${V[$k]}"; done > "$tmp/oauth.env"
  printf '%s' "${V[GITHUB_GAMES_SERVICE_PAT]}" > "$tmp/token"
  # Rendered client-side and applied, so a re-run updates instead of failing on "already exists".
  kubectl -n games create secret generic games-oauth --from-env-file="$tmp/oauth.env" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "applied Secret games/games-oauth (${OAUTH_KEYS[*]})"
  kubectl -n games-runner create secret generic runner-pat --from-file=token="$tmp/token" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "applied Secret games-runner/runner-pat (token)"
  echo "restart to pick up changes: kubectl -n games rollout restart deployment/games-cloud"
}

case "$MODE" in
  --check) ;;
  --github) do_github ;;
  --cluster) do_cluster ;;
  --all) do_github; do_cluster ;;
  *) echo "usage: $0 [--check|--github|--cluster|--all]" >&2; exit 2 ;;
esac
