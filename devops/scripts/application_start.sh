#!/bin/bash
# CodeDeploy Hook: ApplicationStart — Well Labs Water Accounting (SPA)
set -euo pipefail
exec >> /var/log/welllabs-deploy.log 2>&1

echo ""
echo "========================================"
echo "  [ApplicationStart] $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# Ensure Nginx is running
echo "[1/1] Checking Nginx service..."

if ! systemctl is-active --quiet nginx; then
    echo "  → Nginx was not running. Starting..."
    systemctl start nginx
    systemctl enable nginx
else
    echo "  → Nginx is already active."
fi

RELEASE_NAME=$(cat /run/welllabs_release_name 2>/dev/null || echo "unknown")

echo ""
echo "✓ ApplicationStart complete."
echo "  Live release: ${RELEASE_NAME}"