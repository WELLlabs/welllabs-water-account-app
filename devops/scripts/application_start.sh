#!/bin/bash
# CodeDeploy Hook: ApplicationStart — Well Labs Water Accounting (SPA + FastAPI)
set -euo pipefail
exec >> /var/log/welllabs-deploy.log 2>&1

echo ""
echo "========================================"
echo "  [ApplicationStart] $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# ── 1. Restart FastAPI (picks up new code under /opt/welllabs/current) ─
echo "[1/2] Restarting welllabs-api (uvicorn)..."
if systemctl restart welllabs-api; then
  echo "  → welllabs-api restarted."
else
  echo "ERROR: failed to restart welllabs-api"
  systemctl status welllabs-api --no-pager || true
  journalctl -u welllabs-api -n 40 --no-pager || true
  exit 1
fi

# Brief wait so health checks in ValidateService are more likely to pass
sleep 2

# ── 2. Ensure Nginx is running and picks up the latest conf ──
echo "[2/2] Checking Nginx service..."

if ! systemctl is-active --quiet nginx; then
    echo "  → Nginx was not running. Starting..."
    systemctl start nginx
    systemctl enable nginx
else
    echo "  → Nginx is already active — reloading..."
    if nginx -t; then
      systemctl reload nginx
    else
      echo "WARNING: nginx -t failed; left running config unchanged."
    fi
fi

RELEASE_NAME=$(cat /run/welllabs_release_name 2>/dev/null || echo "unknown")

echo ""
echo "✓ ApplicationStart complete."
echo "  Live release: ${RELEASE_NAME}"
