# FuelWatch — static site served by nginx on Fly.io
# Build: docker build -t fuelwatch .
# Run locally: docker run -p 8080:80 fuelwatch

FROM nginx:alpine

# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy static files
COPY public /usr/share/nginx/html

# Optional: lightweight nginx config with gzip and correct MIME types
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
    # Security headers\n\
    add_header X-Frame-Options SAMEORIGIN;\n\
    add_header X-Content-Type-Options nosniff;\n\
    add_header Referrer-Policy no-referrer-when-downgrade;\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
