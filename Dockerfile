# FuelWatch — static site served by nginx on Fly.io
# Build: docker build -t fuelwatch .
# Run locally: docker run -p 8080:80 -e EIA_API_KEY=your_key fuelwatch
#
# Fly.io secrets (injected as env vars at container start):
#   fly secrets set EIA_API_KEY=your_key_here
#   fly secrets set FRED_API_KEY=your_key_here

FROM nginx:alpine

# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy static files
COPY public /usr/share/nginx/html

# nginx config — gzip, security headers, SPA fallback
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    charset utf-8;\n\
    gzip on;\n\
    gzip_types text/plain text/css application/javascript application/json;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    add_header X-Frame-Options SAMEORIGIN;\n\
    add_header X-Content-Type-Options nosniff;\n\
    add_header Referrer-Policy no-referrer-when-downgrade;\n\
}\n' > /etc/nginx/conf.d/default.conf

# Entrypoint writes Fly.io secrets into /config.js at container start
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
