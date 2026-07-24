#!/bin/bash
# CodeDeploy Hook: ValidateService — Well Labs Water Accounting (SPA + FastAPI)
set -euo pipefail
exec >> /var/log/welllabs-deploy.log 2>&1

echo ""
echo "========================================"
echo "  [ValidateService] $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

MAX_RETRIES=8
RETRY_INTERVAL=5

# ── 1. Nginx service health ──────────────────────────────────
echo "[1/4] Checking Nginx service..."
if ! systemctl is-active --quiet nginx; then
  echo "✗ FAIL: Nginx is NOT active."
  systemctl status nginx --no-pager || true
  exit 1
fi
echo "  → Nginx is active."

# ── 2. FastAPI systemd + direct health ───────────────────────
echo "[2/4] Checking welllabs-api service..."
if ! systemctl is-active --quiet welllabs-api; then
  echo "✗ FAIL: welllabs-api is NOT active."
  systemctl status welllabs-api --no-pager || true
  journalctl -u welllabs-api -n 40 --no-pager || true
  exit 1
fi
echo "  → welllabs-api is active."

ATTEMPT=0
HTTP_API="000"
while [ "${HTTP_API}" != "200" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "${ATTEMPT}" -gt "${MAX_RETRIES}" ]; then
    echo "✗ FAIL: uvicorn /fwa-api/health not ready after $((MAX_RETRIES * RETRY_INTERVAL))s (last HTTP ${HTTP_API})."
    journalctl -u welllabs-api -n 40 --no-pager || true
    exit 1
  fi
  HTTP_API=$(curl --silent -o /dev/null -w "%{http_code}" \
        --max-time 5 http://127.0.0.1:8010/fwa-api/health 2>/dev/null || echo "000")
  if [ "${HTTP_API}" != "200" ]; then
    echo "  → attempt ${ATTEMPT}/${MAX_RETRIES}: HTTP ${HTTP_API}, retrying..."
    sleep "${RETRY_INTERVAL}"
  fi
done
echo "  → uvicorn /fwa-api/health HTTP ${HTTP_API} OK."

# ── 3. HTTP response from Nginx (SPA + proxied API) ──────────
# Port 80 serves the app directly — accept 2xx and 3xx as healthy.
echo "[3/4] Polling http://127.0.0.1/ and /fwa-api/health via Nginx..."
ATTEMPT=0
HTTP_CODE="000"
while [[ ! "${HTTP_CODE}" =~ ^(200|301|302)$ ]]; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "${ATTEMPT}" -gt "${MAX_RETRIES}" ]; then
    echo "✗ FAIL: Nginx SPA not ready after $((MAX_RETRIES * RETRY_INTERVAL))s (last HTTP ${HTTP_CODE})."
    exit 1
  fi
  HTTP_CODE=$(curl --silent -o /dev/null -w "%{http_code}" \
        --max-time 5 http://127.0.0.1/ 2>/dev/null || echo "000")
  if [[ ! "${HTTP_CODE}" =~ ^(200|301|302)$ ]]; then
    echo "  → attempt ${ATTEMPT}/${MAX_RETRIES}: HTTP ${HTTP_CODE}, retrying..."
    sleep "${RETRY_INTERVAL}"
  fi
done
echo "  → SPA HTTP ${HTTP_CODE} OK."

ATTEMPT=0
HTTP_PROXY="000"
while [ "${HTTP_PROXY}" != "200" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "${ATTEMPT}" -gt "${MAX_RETRIES}" ]; then
    echo "✗ FAIL: Nginx /fwa-api/health not ready after $((MAX_RETRIES * RETRY_INTERVAL))s (last HTTP ${HTTP_PROXY})."
    exit 1
  fi
  HTTP_PROXY=$(curl --silent -o /dev/null -w "%{http_code}" \
        --max-time 5 http://127.0.0.1/fwa-api/health 2>/dev/null || echo "000")
  if [ "${HTTP_PROXY}" != "200" ]; then
    echo "  → attempt ${ATTEMPT}/${MAX_RETRIES}: HTTP ${HTTP_PROXY}, retrying..."
    sleep "${RETRY_INTERVAL}"
  fi
done
echo "  → Nginx /fwa-api/health HTTP ${HTTP_PROXY} OK."

# ── 4. Symlink and build integrity ───────────────────────────
echo "[4/4] Checking symlink and build files..."

# Read and validate release name (strict format, from secure location)
EXPECTED_RELEASE=$(cat /run/welllabs_release_name 2>/dev/null || echo "")
if [[ ! "${EXPECTED_RELEASE}" =~ ^release_[0-9]{8}_[0-9]{6}$ ]]; then
  echo "✗ FAIL: Release name is missing or invalid: '${EXPECTED_RELEASE}'"
  exit 1
fi

CURRENT_LINK=$(readlink /opt/welllabs/current 2>/dev/null || echo "")
if [ -z "${CURRENT_LINK}" ]; then
  echo "✗ FAIL: /opt/welllabs/current symlink is missing."
  exit 1
fi

# Use string equality, not glob, to avoid accidental wildcard expansion
if [ "${CURRENT_LINK}" != "/opt/welllabs/releases/${EXPECTED_RELEASE}" ]; then
  echo "✗ FAIL: symlink points to '${CURRENT_LINK}', expected '${EXPECTED_RELEASE}'."
  exit 1
fi

if [ ! -f "${CURRENT_LINK}/build/index.html" ]; then
  echo "✗ FAIL: build/index.html missing in the current release."
  exit 1
fi
echo "  → Symlink → ${EXPECTED_RELEASE} (index.html confirmed)."

echo ""
echo "========================================"
echo "  ✓ Deployment VALIDATED!"
echo "    Release : ${EXPECTED_RELEASE}"
echo "    Time    : $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
