#!/bin/bash
# web/phone-tunnel.sh — ON THE MAC (the machine running VS Code), not in the container.
# Puts the page the container serves on 8090 (web/dev.sh phone) on https://ctr-dev.suuuper.app,
# for a phone : an frp client of its own (Docker), next to the one on the home server, through the
# same frps on the VPS. Ctrl-C closes the tunnel ; nothing stays running.
#
#   bash web/phone-tunnel.sh            check everything, then open the tunnel (foreground)
#   bash web/phone-tunnel.sh --check    check only : the files, the page on 8090, the DNS, https
#
# What it needs once, in web/.phone-tunnel/ of the main clone (gitignored, never in a site : the
# same as web/.relay-key ; CTR_TUNNEL_DIR elsewhere) — the home frpc's own files,
# copied from the machine where frpc already runs (the script says how when one is missing) :
#   frpc.toml   that frpc's config : serverAddr, auth.token, transport.tls.serverName are read
#               from it (its proxies are not)
#   ca.crt, client.crt, client.key   that frpc's mTLS files
# Settings : CTR_PHONE_HOST (ctr-dev.suuuper.app), CTR_PHONE_FRP_PORT (8098, frps' allowPorts
# 8096-8199 : free on the VPS as of 2026-11-16), CTR_PAGE_PORT (8090).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
# the main clone's web/ even when this runs from a worktree (.claude/worktrees/<name>/web) : read off
# the path — git cannot say it on the Mac, a worktree's .git file names the container's path
DIR=${CTR_TUNNEL_DIR:-${here%%/.claude/worktrees/*}}
[ -n "${CTR_TUNNEL_DIR:-}" ] || { [ "$DIR" = "$here" ] && DIR=$here/.phone-tunnel || DIR=$DIR/web/.phone-tunnel; }
HOST=${CTR_PHONE_HOST:-ctr-dev.suuuper.app}
FPORT=${CTR_PHONE_FRP_PORT:-8098}
PAGE=${CTR_PAGE_PORT:-8090}
# frp's latest release when this was written (v0.72.0, 2026-11-04) ; the frps on the VPS runs
# snowdreamtech/frps:latest — frp keeps a client and a server of nearby versions compatible
IMAGE=snowdreamtech/frpc:0.72.0-alpine
NAME=ctr-phone-tunnel

ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; }
step() { printf '\n[%s] %s\n' "$1" "$2"; }

check_only=0
case "${1:-}" in
  --check) check_only=1 ;;
  '') ;;
  -h | --help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "usage: bash web/phone-tunnel.sh [--check]" >&2; exit 2 ;;
esac

if [ -f /.dockerenv ] || [ -n "${REMOTE_CONTAINERS:-}" ] || [ -d /workspace/.devcontainer ]; then
  echo "phone-tunnel.sh runs on the Mac (its Terminal), not in the devcontainer : the container's" >&2
  echo "firewall keeps frp's port 7000 closed. In the Mac's Terminal, from the workspace folder :" >&2
  echo "  bash apps/ctr-web/web/phone-tunnel.sh" >&2
  exit 2
fi

# ---- 1. the files ----
step 1/5 "the home frpc's files in $DIR"
# the files as copied : beside frpc.toml, or in its certs/ (the home compose's layout) ; a folder
# chmod 600'd along with its files cannot be opened : given back its x
for d in "$DIR" "$DIR/certs"; do [ -d "$d" ] && chmod 700 "$d"; done
find_file() { if [ -s "$DIR/$1" ]; then echo "$DIR/$1"; elif [ -s "$DIR/certs/$1" ]; then echo "$DIR/certs/$1"; fi; }
missing=''
for f in frpc.toml ca.crt client.crt client.key; do
  if [ -n "$(find_file "$f")" ]; then ok "${f}$( [ "$(find_file "$f")" = "$DIR/certs/$f" ] && echo ' (certs/)')"; else bad "$f missing"; missing="$missing $f"; fi
done
CA=$(find_file ca.crt); CRT=$(find_file client.crt); KEY=$(find_file client.key)
if [ -n "$missing" ]; then
  cat <<EOF

  Copy them from the machine where frpc already runs (the home server : the folder of its compose
  file, where frpc.toml and certs/ are). From this Mac, with that machine's name or IP :
    mkdir -p "$DIR" && chmod 700 "$DIR"
    scp <user>@<home-server>:<compose folder>/frpc.toml "$DIR/"
    scp <user>@<home-server>:'<compose folder>/certs/{ca.crt,client.crt,client.key}' "$DIR/"
    find "$DIR" -type f -exec chmod 600 {} +
  Then run this script again.
EOF
  exit 1
fi
read_key() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"\{0,1\}\([^\"]*\)\"\{0,1\}[[:space:]]*$/\1/p" "$DIR/frpc.toml" | head -1; }
SERVER=$(read_key serverAddr)
SPORT=$(read_key serverPort)
TOKEN=$(read_key 'auth\.token')
SNI=$(read_key 'transport\.tls\.serverName')
[ -n "$SERVER" ] && ok "serverAddr $SERVER:${SPORT:-7000}" || { bad "no serverAddr in $DIR/frpc.toml"; exit 1; }
[ -n "$TOKEN" ] && ok "auth.token (${#TOKEN} characters)" || { bad "no auth.token in $DIR/frpc.toml"; exit 1; }
[ -n "$SNI" ] || SNI=$SERVER

# ---- 2. the page on this Mac ----
step 2/5 "the page on this Mac, localhost:$PAGE (VS Code forwards the container's port)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$PAGE/index.html" || true)
if [ "$code" = 200 ]; then ok "http://localhost:$PAGE answers"
else
  bad "http://localhost:$PAGE : ${code:-no answer}"
  echo "  In the container : bash apps/ctr-web/web/dev.sh phone ; in VS Code's Ports panel, $PAGE forwarded."
  [ "$check_only" = 1 ] || exit 1
fi

# ---- 3. Docker ----
step 3/5 "Docker"
if docker info > /dev/null 2>&1; then ok "docker answers"; else bad "docker does not answer : start Docker Desktop"; exit 1; fi

# ---- 4. DNS and the VPS's route ----
step 4/5 "$HOST : DNS and the VPS's route"
ip=$(dig +short "$HOST" A 2>/dev/null | tail -1 || true)
vps=$(dig +short "$SERVER" A 2>/dev/null | tail -1 || true)
if [ -n "$ip" ] && [ "$ip" = "$vps" ]; then ok "$HOST → $ip (the VPS, DNS only)"
elif [ -n "$ip" ]; then bad "$HOST → $ip, the VPS ($SERVER) is $vps : a proxied (orange) record ? It must be DNS only (grey)"
else
  bad "$HOST does not resolve"
  echo "  Cloudflare : $HOST  A  ${vps:-<the VPS IP>}, proxy OFF (grey cloud)."
fi
cat <<EOF
  The VPS's route, once (Traefik watches the folder, nothing to restart) —
  docker/traefik/dynamic/03-ctr-dev.yml in server-kevledev-mini, copied to the VPS :
    http:
      routers:
        ctr-dev:
          rule: "Host(\`$HOST\`)"
          entryPoints:
            - websecure
          service: ctr-dev
          middlewares:
            - crowdsec@file
          tls:
            certResolver: acme-ssl
      services:
        ctr-dev:
          loadBalancer:
            servers:
              - url: "http://frps:$FPORT"
EOF

# ---- 5. the tunnel ----
https_check() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST/index.html" || true
}
# why https://$HOST does not answer 200, in one line : what to fix
https_why() {
  local strict=$1 loose
  if [ -z "$(dig +short "$HOST" A 2>/dev/null | tail -1)" ]; then
    echo "$HOST does not resolve : the Cloudflare record (step 4), A to the VPS, grey cloud ; a new record can take a few minutes"
    return
  fi
  loose=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST/index.html" || true)
  case "$strict/$loose" in
    000/000) echo "nothing answers on https at $(dig +short "$HOST" A | tail -1) : is it the VPS ? (step 4)" ;;
    000/404) echo "Traefik answers with its default certificate and no route for $HOST : docker/traefik/dynamic/03-ctr-dev.yml is not on the VPS (step 4)" ;;
    000/200 | 000/502) echo "the route is there, its certificate is not issued yet (acme-ssl : a minute or two after the first request) : run --check again in a minute" ;;
    502/* | 000/*) echo "Traefik routes $HOST but frps:$FPORT does not answer ($strict, $loose without the certificate check) : the tunnel is not open, or frpc is not on remotePort $FPORT" ;;
    *) echo "HTTP $strict (without the certificate check : $loose)" ;;
  esac
}
if [ "$check_only" = 1 ]; then
  step 5/5 "https://$HOST (the tunnel is not opened by --check)"
  c=$(https_check)
  if [ "$c" = 200 ]; then ok "https://$HOST answers 200 (a tunnel is already open)"; else bad "https://$HOST : ${c:-no answer} — $(https_why "$c")"; fi
  exit 0
fi

step 5/5 "the tunnel : $IMAGE, proxy ctr-dev, VPS port $FPORT → this Mac's $PAGE"
CONF=$(mktemp -t ctr-phone-tunnel)
trap 'rm -f "$CONF"' EXIT
chmod 600 "$CONF"
# frp reads its config as a Go template : no double brace may appear in it
cat > "$CONF" <<EOF
serverAddr = "$SERVER"
serverPort = ${SPORT:-7000}
auth.method = "token"
auth.token = "$TOKEN"
transport.tls.enable = true
transport.tls.trustedCaFile = "/etc/frp/ca.crt"
transport.tls.certFile = "/etc/frp/client.crt"
transport.tls.keyFile = "/etc/frp/client.key"
transport.tls.serverName = "$SNI"
loginFailExit = true

[[proxies]]
name = "ctr-dev"
type = "tcp"
localIP = "host.docker.internal"
localPort = $PAGE
remotePort = $FPORT
EOF
docker rm -f "$NAME" > /dev/null 2>&1 || true
docker run -d --name "$NAME" \
  -v "$CONF:/etc/frp/frpc.toml:ro" -v "$CA:/etc/frp/ca.crt:ro" \
  -v "$CRT:/etc/frp/client.crt:ro" -v "$KEY:/etc/frp/client.key:ro" \
  "$IMAGE" > /dev/null
trap 'docker rm -f "$NAME" > /dev/null 2>&1 || true; rm -f "$CONF"; echo; echo "phone-tunnel.sh : tunnel closed"' EXIT INT TERM

printf '  connecting'
for _ in $(seq 1 30); do
  logs=$(docker logs "$NAME" 2>&1 || true)
  if echo "$logs" | grep -q 'start proxy success'; then echo; ok "frps took the proxy"; break; fi
  if ! docker ps -q --filter "name=^$NAME$" | grep -q .; then echo; bad "frpc stopped :"; echo "$logs" | tail -5 | sed 's/^/    /'; exit 1; fi
  printf '.'
  sleep 1
done
echo "$logs" | grep -q 'start proxy success' || { echo; bad "no « start proxy success » in 30 s :"; docker logs "$NAME" 2>&1 | tail -5 | sed 's/^/    /'; exit 1; }
c=$(https_check)
if [ "$c" = 200 ]; then ok "https://$HOST answers 200"
else bad "https://$HOST : ${c:-no answer} — $(https_why "$c")"; fi

cat <<EOF

On the phone : https://$HOST/?measure
The tunnel stays open while this runs ; Ctrl-C closes it.
EOF
docker logs -f "$NAME" 2>&1 | grep --line-buffered -iE 'error|warn|closed|login' || true
