#!/bin/bash
# CodeDeploy Hook: BeforeInstall — Well Labs Water Accounting (SPA)
set -euo pipefail
exec >> /var/log/welllabs-deploy.log 2>&1

echo ""
echo "========================================"
echo "  [BeforeInstall] $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# ── 1. Create required directories ──────────────────────────
echo "[1/4] Creating base directories..."
mkdir -p /opt/welllabs/{releases,logs}
# NOTE: 'current' must NOT be pre-created as a directory.
# after_install.sh creates it as a symlink via: ln -sfn <release_dir> /opt/welllabs/current

# ── 2. Unblock apt/dpkg locks ───────────────────────────────
echo "[2/4] Stopping unattended-upgrades if active..."
systemctl stop unattended-upgrades || true

echo "Waiting for apt/dpkg locks to release..."
for i in {1..20}; do
  if ! pgrep -f "unattended-upgrades" >/dev/null && \
     ! pgrep -f "apt-get" >/dev/null && \
     ! pgrep -f "dpkg" >/dev/null; then
    break
  fi
  echo "  Lock active. Waiting 5s (attempt $i/20)..."
  sleep 5
done

# ── 3. Fix any interrupted dpkg state ──────────────────────
echo "[3/4] Fixing any interrupted packages..."
DEBIAN_FRONTEND=noninteractive dpkg --configure -a || true

# ── 4. Create timestamped release slot ──────────────────────
RELEASE_NAME="release_$(date +%Y%m%d_%H%M%S)"
RELEASE_DIR="/opt/welllabs/releases/${RELEASE_NAME}"
mkdir -p "${RELEASE_DIR}"

# Write release name to a root-owned, mode-600 file
# (prevents low-privilege tampering of the path used in after_install.sh)
printf '%s' "${RELEASE_NAME}" > /run/welllabs_release_name
chmod 600 /run/welllabs_release_name

echo "[4/4] Release slot created: ${RELEASE_DIR}"
echo ""
echo "✓ BeforeInstall complete."