#!/bin/bash
# CodeDeploy Hook: ApplicationStart — Well Labs Water Accounting (SPA)
set -euo pipefail
exec >> /var/log/welllabs-deploy.log 2>&1

echo ""
echo "========================================"
echo "  [ApplicationStart] $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# Ensure Nginx is running and picks up the latest conf
echo "[1/1] Checking Nginx service..."

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