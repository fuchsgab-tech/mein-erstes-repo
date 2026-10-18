FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

# Viele Hoster hängen ein leeres Volume ein, das root gehört. Deshalb startet der Container als root,
# übernimmt /data für den Benutzer „node“ und lässt Node dann selbst zu „node“ wechseln (ohne Zusatzpakete).
# Klappt das nicht (z. B. Netzlaufwerk ohne chown), läuft Zeitgarten mit Hinweis als root weiter.
RUN mkdir -p /data && chown node:node /data \
  && printf '%s\n' \
    '#!/bin/sh' \
    'if [ "$(id -u)" = "0" ]; then' \
    '  mkdir -p "$DATA_DIR"' \
    '  chown -R node:node "$DATA_DIR" 2>/dev/null' \
    '  if [ "$(stat -c %u "$DATA_DIR")" = "$(id -u node)" ]; then' \
    '    exec node -e "process.initgroups(\"node\", \"node\"); process.setgid(\"node\"); process.setuid(\"node\"); import(\"/app/server/index.js\")"' \
    '  fi' \
    '  echo "Hinweis: $DATA_DIR gehört nicht dem Benutzer node – Zeitgarten läuft als root." >&2' \
    'fi' \
    'exec node /app/server/index.js' \
    > /usr/local/bin/zeitgarten-start \
  && chmod 755 /usr/local/bin/zeitgarten-start

ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["/usr/local/bin/zeitgarten-start"]
