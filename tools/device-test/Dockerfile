ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
FROM ${PLAYWRIGHT_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc xdotool openbox x11-utils imagemagick tesseract-ocr && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY playwright.config.mjs ./
COPY fixtures.mjs device.mjs ./
COPY native-seed.mjs ./
COPY tests ./tests
COPY workflows ./workflows
COPY scenarios ./scenarios
ENTRYPOINT ["npm", "test"]

COPY desktop.sh ./
