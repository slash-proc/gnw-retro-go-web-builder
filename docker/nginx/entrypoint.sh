#!/bin/sh
# Generate a self-signed cert on first start (if absent), then run nginx. Dev only.
set -e

CERT_DIR=/etc/nginx/certs
if [ ! -f "$CERT_DIR/dev.crt" ]; then
  mkdir -p "$CERT_DIR"
  command -v openssl >/dev/null 2>&1 || apk add --no-cache openssl >/dev/null 2>&1
  echo "nginx: generating self-signed dev certificate…"
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$CERT_DIR/dev.key" -out "$CERT_DIR/dev.crt" \
    -subj "/CN=gnw-builder.local" \
    -addext "subjectAltName=DNS:gnw-builder,DNS:gnw-builder.local,DNS:localhost,IP:127.0.0.1"
fi

exec nginx -g 'daemon off;'
