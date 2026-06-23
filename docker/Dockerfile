# Dev/build image. Nothing is installed on the host — all npm work happens here.
FROM node:20-slim

# git + python3 power the validation oracles: thumb-asm (git show the keystone
# cache + the pure-Python assembler) and gnw-patch (run the upstream patcher as a
# byte-exact reference — needs pycryptodome/pyelftools/colorama).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages \
        pycryptodome==3.20.0 pyelftools==0.31 colorama==0.4.6

WORKDIR /app

# Install deps first for layer caching. Workspace package.jsons are needed so
# `npm ci` can resolve the workspace graph.
COPY package.json package-lock.json ./
COPY packages/swd-transport/package.json packages/swd-transport/
COPY packages/thumb-asm/package.json     packages/thumb-asm/
COPY packages/gnw-patch/package.json     packages/gnw-patch/
COPY packages/gnw-flasher/package.json   packages/gnw-flasher/
COPY packages/fs-builders/package.json   packages/fs-builders/
COPY packages/builder-core/package.json  packages/builder-core/
COPY apps/web/package.json               apps/web/
COPY backend/package.json                backend/
COPY frontend/package.json               frontend/

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "dev"]
