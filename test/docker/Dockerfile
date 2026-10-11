FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends gnome-keyring dbus dbus-x11 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /cli
COPY package.json package-lock.json ./
RUN npm ci
COPY bin ./bin
COPY test ./test
COPY scripts/test-credential-store.mjs ./scripts/test-credential-store.mjs
CMD ["bash", "-ec", "npm test && dbus-run-session -- bash -ec 'printf %s dummy-keyring-password | gnome-keyring-daemon --unlock >/dev/null; npm run test:credentials' && node scripts/test-credential-store.mjs --unavailable"]
