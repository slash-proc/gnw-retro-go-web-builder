# Dev/build image. Nothing is installed on the host — all npm work happens here.
FROM node:20-slim

# git + python3 power the validation oracles: thumb-asm (git show the keystone
# cache + the pure-Python assembler) and gnw-patch (run the upstream patcher as a
# byte-exact reference — needs pycryptodome/pyelftools/colorama).
#
# pyyaml and littlefs-python were MISSING until 2026-09-07, which meant two of the
# byte-exactness commands the project documents as standard — fs-builders' frogfs.mjs
# (needs mkfrogfs.py, which imports yaml) and littlefs.mjs's lfs_oracle.py cross-mount —
# could not run in the sanctioned environment at all. A mutation audit found them dark.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages \
        pycryptodome==3.20.0 pyelftools==0.31 colorama==0.4.6 \
        pyyaml==6.0.2 littlefs-python==0.17.1

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
