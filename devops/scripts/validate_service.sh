#!/bin/bash
# CodeDeploy Hook: ValidateService — Well Labs Water Accounting (SPA)
set -euo pipefail
exec >> /var/log/welllabs-deploy.log 2>&1

echo ""
echo "========================================"
echo "  [ValidateService] $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

MAX_RETRIES=6
RETRY_INTERVAL=5

# ── 1. Nginx service health ──────────────────────────────────
echo "[1/3] Checking Nginx service..."
if ! systemctl is-active --quiet nginx; then
  echo "✗ FAIL: Nginx is NOT active."
  systemctl status nginx --no-pager || true
  exit 1
fi
echo "  → Nginx is active."

# ── 2. HTTP response from Nginx ──────────────────────────────
# Port 80 serves the app directly — accept 2xx and 3xx as healthy.
echo "[2/3] Polling http://127.0.0.1/ ..."
ATTEMPT=0
until HTTP_CODE=$(curl --silent -o /dev/null -w "%{http_code}" \
      --max-time 5 http://127.0.0.1/ 2>/dev/null); do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "${ATTEMPT}" -ge "${MAX_RETRIES}" ]; then
    echo "✗ FAIL: curl error after $((MAX_RETRIES * RETRY_INTERVAL))s."
    exit 1
  fi
  sleep "${RETRY_INTERVAL}"
done

if [[ ! "${HTTP_CODE}" =~ ^(200|301|302)$ ]]; then
  echo "✗ FAIL: Nginx returned HTTP ${HTTP_CODE}."
  exit 1
fi
echo "  → HTTP ${HTTP_CODE} OK."

# ── 3. Symlink and build integrity ───────────────────────────
echo "[3/3] Checking symlink and build files..."

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