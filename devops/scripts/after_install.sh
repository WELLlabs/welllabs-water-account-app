#!/bin/bash
# CodeDeploy Hook: AfterInstall — Well Labs Water Accounting (SPA + FastAPI)
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
API_VENV="${APP_BASE}/api-venv"
# Production has historically used conf.d — keep updating that path only
NGINX_CONF="/etc/nginx/conf.d/welllabs.conf"
NGINX_UPLOAD_LIMITS="/etc/nginx/conf.d/00-upload-limits.conf"
SYSTEMD_UNIT="/etc/systemd/system/welllabs-api.service"
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
echo "[1/7] Deploying to: ${RELEASE_DIR}"

# ── 2. Copy artifact into release directory ──────────────────
echo "[2/7] Copying artifact into release directory..."
cp -a "${PACKAGE_DIR}/." "${RELEASE_DIR}/"

# Verify expected build output exists
if [ ! -f "${RELEASE_DIR}/build/index.html" ]; then
  echo "ERROR: build/index.html not found. Build may have failed."
  exit 1
fi
echo "  → build/index.html confirmed."

if [ ! -f "${RELEASE_DIR}/api/main.py" ]; then
  echo "ERROR: api/main.py not found. Artifact is missing FastAPI sources."
  exit 1
fi
echo "  → api/main.py confirmed."

# Ensure api is importable as a package
touch "${RELEASE_DIR}/api/__init__.py"

# ── 3. Install / update Nginx configuration (conf.d — legacy path) ─
echo "[3/7] Installing Nginx configuration to ${NGINX_CONF}..."

# Drop any sites-* copy from a prior failed deploy to avoid duplicate zones
rm -f /etc/nginx/sites-enabled/welllabs /etc/nginx/sites-available/welllabs

# Backup live conf before overwrite
if [ -f "${NGINX_CONF}" ]; then
  cp "${NGINX_CONF}" "${NGINX_CONF}.bak.$(date +%Y%m%d_%H%M%S)"
  echo "  → Backed up existing ${NGINX_CONF}"
fi

cp "${RELEASE_DIR}/devops/nginx/welllabs.conf" "${NGINX_CONF}"
# http-context body size (survives even if a server block omits the directive)
cp "${RELEASE_DIR}/devops/nginx/00-upload-limits.conf" "${NGINX_UPLOAD_LIMITS}"
rm -f /etc/nginx/sites-enabled/default

if ! nginx -t; then
  echo "ERROR: Nginx config invalid — restoring previous conf if backup exists..."
  LATEST_BAK=$(ls -1t "${NGINX_CONF}".bak.* 2>/dev/null | head -1 || true)
  if [ -n "${LATEST_BAK}" ] && [ -f "${LATEST_BAK}" ]; then
    cp "${LATEST_BAK}" "${NGINX_CONF}"
    echo "  → Restored ${LATEST_BAK}"
  fi
  rm -f "${NGINX_UPLOAD_LIMITS}"
  exit 1
fi

systemctl reload nginx
echo "  → Nginx config installed and reloaded (client_max_body_size 512m via server + 00-upload-limits, /api → :8001)."

# ── 4. Python runtime + shared venv for FastAPI ──────────────
echo "[4/7] Ensuring Python venv and API dependencies..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip

if [ ! -x "${API_VENV}/bin/python" ]; then
  echo "  → Creating venv at ${API_VENV}"
  python3 -m venv "${API_VENV}"
fi

"${API_VENV}/bin/pip" install --upgrade pip -q
"${API_VENV}/bin/pip" install -r "${RELEASE_DIR}/api/requirements.txt" -q
chown -R ubuntu:ubuntu "${API_VENV}"
echo "  → API dependencies installed."

# ── 5. Install systemd unit for FastAPI ──────────────────────
echo "[5/7] Installing systemd unit welllabs-api.service..."
cp "${RELEASE_DIR}/devops/systemd/welllabs-api.service" "${SYSTEMD_UNIT}"
systemctl daemon-reload
systemctl enable welllabs-api.service
echo "  → systemd unit installed and enabled."

# ── 6. Atomic symlink swap ───────────────────────────────────
echo "[6/7] Swapping symlink: current → ${RELEASE_NAME}"
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

chown -R ubuntu:ubuntu "${RELEASES_DIR}" 2>/dev/null || true
# Use the real path (not the symlink) for chmod to avoid following to wrong dir
chmod -R 755 "${RELEASE_DIR}/build"

# ── 7. Prune old releases ────────────────────────────────────
echo "[7/7] Pruning old releases (keeping last ${KEEP_RELEASES})..."
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
