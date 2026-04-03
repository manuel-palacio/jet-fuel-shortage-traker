#!/bin/sh
# entrypoint.sh — runs at container start on Fly.io
# Reads Fly.io secrets (env vars) and writes them into a config.js
# that the browser loads at runtime.
#
# Set secrets with:
#   fly secrets set EIA_API_KEY=your_key_here
#   fly secrets set FRED_API_KEY=your_key_here
#
# Keys are visible to the browser (client-side JS). This is appropriate
# for free public API keys like EIA / FRED. For sensitive keys, proxy
# the API calls through a server-side endpoint instead.

cat > /usr/share/nginx/html/config.js <<EOF
// Auto-generated at container start — do not edit or commit.
window.FUELWATCH_CONFIG = {
  EIA_API_KEY:  "${EIA_API_KEY:-}",
  FRED_API_KEY: "${FRED_API_KEY:-}"
};
EOF

echo "config.js written (EIA_API_KEY set: $([ -n "$EIA_API_KEY" ] && echo yes || echo no), FRED_API_KEY set: $([ -n "$FRED_API_KEY" ] && echo yes || echo no))"

# Hand off to nginx
exec nginx -g "daemon off;"
