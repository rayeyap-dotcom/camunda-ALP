#!/usr/bin/env bash
# Starts backend + frontend together for local dev, after checking that the
# common failure modes (missing .env, missing deps, backend not actually
# healthy) are caught up front instead of showing up later as a blank UI.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_LOG="$ROOT_DIR/.backend-dev.log"
BACKEND_PID=""

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}==>${NC} $1"; }
ok()   { echo -e "${GREEN}[ok]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
fail() { echo -e "${RED}[fail]${NC} $1"; }

cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    info "Stopping backend (pid $BACKEND_PID)"
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "=== Camunda ALP dev startup ==="
echo

# --- 1. backend/.env must exist -------------------------------------------
info "Checking backend/.env"
if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  fail "backend/.env not found."
  echo "     Copy backend/.env.example to backend/.env and fill in real values"
  echo "     from the Camunda Console, then re-run this script."
  exit 1
fi
ok "backend/.env exists"

# --- 2. required backend keys (mirrors the alias fallbacks in server.js) --
# Doesn't fail the script — the server itself degrades gracefully and
# returns empty data for whichever surface is unconfigured — but flags it
# loudly up front instead of letting it show up later as "200 but no data".
check_any() {
  local label="$1"; shift
  local key val
  for key in "$@"; do
    val="$(grep -E "^${key}=" "$BACKEND_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
    if [[ -n "$val" ]]; then
      ok "$label ($key is set)"
      return 0
    fi
  done
  warn "$label -> none of [$*] are set in backend/.env — related endpoints will silently return empty data"
  return 0
}

info "Checking backend/.env required keys"
check_any "Camunda client ID" CAMUNDA_CLIENT_AUTH_CLIENTID CAMUNDA_CLIENT_ID ZEEBE_CLIENT_ID
check_any "Camunda client secret" CAMUNDA_CLIENT_AUTH_CLIENTSECRET CAMUNDA_CLIENT_SECRET ZEEBE_CLIENT_SECRET
check_any "Zeebe REST address (process instances / tasklist)" ZEEBE_REST_ADDRESS
check_any "Optimize base URL (dashboard)" CAMUNDA_OPTIMIZE_BASE_URL

# --- 3. frontend/.env -------------------------------------------------------
info "Checking frontend/.env"
if [[ ! -f "$FRONTEND_DIR/.env" ]]; then
  warn "frontend/.env not found — dashboard/process filters will fall back to defaults"
else
  ok "frontend/.env exists"
fi

# --- 4. dependencies ---------------------------------------------------------
info "Checking dependencies"
if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
  warn "backend/node_modules missing, running npm install"
  (cd "$BACKEND_DIR" && npm install)
fi
ok "backend dependencies installed"

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  warn "frontend/node_modules missing, running npm install"
  (cd "$FRONTEND_DIR" && npm install)
fi
ok "frontend dependencies installed"

# --- 5. ports free -----------------------------------------------------------
BACKEND_PORT="$(grep -E '^PORT=' "$BACKEND_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT=5173

info "Checking ports ${BACKEND_PORT} (backend) and ${FRONTEND_PORT} (frontend) are free"
for p in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -i ":$p" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $p is already in use — is a previous dev.sh / npm run dev still running?"
    lsof -i ":$p" -sTCP:LISTEN
    exit 1
  fi
done
ok "ports free"

# --- 6. start backend, streaming its logs live, wait for real health -------
echo
info "Starting backend — logs below are live, also saved to $(basename "$BACKEND_LOG")"
(cd "$BACKEND_DIR" && exec npm run dev) > >(sed -u 's/^/[backend] /' | tee "$BACKEND_LOG") 2>&1 &
BACKEND_PID=$!

info "Waiting for backend to report healthy on http://localhost:${BACKEND_PORT}/api/health"
READY=0
for _ in $(seq 1 30); do
  if curl -s -o /dev/null -w '%{http_code}' "http://localhost:${BACKEND_PORT}/api/health" 2>/dev/null | grep -q '^200$'; then
    READY=1
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    fail "Backend process exited before becoming healthy — see [backend] log lines above."
    exit 1
  fi
  sleep 1
done

if [[ "$READY" -ne 1 ]]; then
  fail "Backend did not become healthy within 30s — see [backend] log lines above."
  exit 1
fi
ok "Backend healthy at http://localhost:${BACKEND_PORT}"

# --- 7. start frontend (foreground), also labeled -----------------------
echo
info "Starting frontend — logs below are live. Ctrl+C stops both backend and frontend."
echo
cd "$FRONTEND_DIR" && npm run dev 2>&1 | sed -u 's/^/[frontend] /'
