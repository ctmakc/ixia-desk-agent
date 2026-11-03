# One container per task. Chromium + Playwright driver, no keys, run as non-root.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
RUN npm init -y >/dev/null && npm install --omit=dev playwright-core@1.64.1 >/dev/null && npm cache clean --force >/dev/null
COPY runner.mjs /app/runner.mjs
USER pwuser
ENTRYPOINT ["node", "/app/runner.mjs"]
