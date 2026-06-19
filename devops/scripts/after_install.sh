#!/bin/bash
# CodeDeploy Hook: AfterInstall — Well Labs Water Accounting (SPA)
set -euo pipefail
exec >> /var/log/welllabs-deploy.log 2>&1

echo ""
echo "============================================================"
echo " AfterInstall started : $(date)"
echo "============================================================"

APP_BASE="/opt/welllabs"
RELEASES_DIR="${APP_BASE}/releases"
PACKAGE_DIR="${APP_BASE}/package"
CURRENT_LINK="${APP_BASE}/current"
NGINX_AVAILABLE="/etc/nginx/sites-available/welllabs"
NGINX_ENABLED="/etc/nginx/sites-enabled/welllabs"
KEEP_RELEASES=3

# ── 1. Read & validate release name ─────────────────────────
# Read from /run (root-owned, 600) — not world-writable /tmp
RELEASE_NAME=$(cat /run/welllabs_release_name)

# Strict validation: only allow release_YYYYMMDD_HHmmss format
if [[ ! "${RELEASE_NAME}" =~ ^release_[0-9]{8}_[0-9]{6}$ ]]; then
  echo "ERROR: Invalid or tampered release name: '${RELEASE_NAME}'"
  exit 1
fi

RELEASE_DIR="${RELEASES_DIR}/${RELEASE_NAME}"
echo "[1/5] Deploying to: ${RELEASE_DIR}"

# ── 2. Copy artifact into release directory ──────────────────
echo "[2/5] Copying artifact into release directory..."
cp -a "${PACKAGE_DIR}/." "${RELEASE_DIR}/"

# Verify expected build output exists
if [ ! -f "${RELEASE_DIR}/build/index.html" ]; then
  echo "ERROR: build/index.html not found. Build may have failed."
  exit 1
fi
echo "  → build/index.html confirmed."

── 3. Install / update Nginx configuration ─────────────────
──────────────────────────────────────────────────────────────────────────────
Nginx & systemd configs
──────────────────────────────────────────────────────────────────────────────
echo "Installing Nginx & systemd configs..."

cp /etc/nginx/conf.d/welllabs.conf /etc/nginx/conf.d/welllabs.conf.bak 2>/dev/null || true

cp "$RELEASE_DIR/devops/nginx/welllabs.conf" /etc/nginx/conf.d/welllabs.conf
rm -f /etc/nginx/conf.d/default.conf
rm -f /etc/nginx/sites-enabled/default

if ! nginx -t; then
  echo "ERROR: Nginx config invalid — restoring previous config..."
  mv /etc/nginx/conf.d/welllabs.conf.bak /etc/nginx/conf.d/welllabs.conf
  exit 1
fi
rm -f /etc/nginx/conf.d/welllabs.conf.bak

# ── 4. Atomic symlink swap ───────────────────────────────────
echo "[4/5] Swapping symlink: current → ${RELEASE_NAME}"
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

chown -R ubuntu:ubuntu "${RELEASES_DIR}" 2>/dev/null || true
# Use the real path (not the symlink) for chmod to avoid following to wrong dir
chmod -R 755 "${RELEASE_DIR}/build"

# ── 5. Prune old releases ────────────────────────────────────
echo "[5/5] Pruning old releases (keeping last ${KEEP_RELEASES})..."
RELEASE_COUNT=$(ls -1 "${RELEASES_DIR}" | wc -l)
if [ "${RELEASE_COUNT}" -gt "${KEEP_RELEASES}" ]; then
  # Collect names into an array first — avoids pipe subshell losing set -e
  mapfile -t OLD_RELEASES < <(ls -1t "${RELEASES_DIR}" | tail -n +"$((KEEP_RELEASES + 1))")
  for OLD in "${OLD_RELEASES[@]}"; do
    # Validate before rm -rf to prevent path traversal
    if [[ "${OLD}" =~ ^release_[0-9]{8}_[0-9]{6}$ ]]; then
      echo "  → Removing: ${OLD}"
      rm -rf "${RELEASES_DIR:?}/${OLD}"
    else
      echo "  → Skipping unexpected entry: ${OLD}"
    fi
  done
else
  echo "  → ${RELEASE_COUNT} release(s) present, nothing to prune."
fi

echo ""
echo "✓ AfterInstall complete. Symlink → ${RELEASE_NAME}"
