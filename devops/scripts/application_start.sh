#!/bin/bash
# CodeDeploy Hook: ApplicationStart — Well Labs Water Accounting (SPA)
set -euo pipefail
exec >> /var/log/welllabs-deploy.log 2>&1

echo ""
echo "========================================"
echo "  [ApplicationStart] $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# ── 1. Ensure Nginx is running ──────────────────────────────
echo "[1/2] Checking Nginx service..."
if ! systemctl is-active --quiet nginx; then
  echo "  → Nginx was not running. Starting..."
  systemctl start nginx
  systemctl enable nginx
else
  echo "  → Nginx is active."
fi

# ── 2. Validate config then graceful reload ─────────────────
# nginx -t fails fast on bad config → CodeDeploy triggers rollback
# systemctl reload sends SIGHUP → workers drain before reloading
echo "[2/2] Graceful Nginx reload..."
nginx -t 2>&1
systemctl reload nginx
echo "  → Nginx reloaded. New static files are now live."

RELEASE_NAME=$(cat /run/welllabs_release_name 2>/dev/null || echo "unknown")
echo ""
echo "✓ ApplicationStart complete. Live release: ${RELEASE_NAME}"