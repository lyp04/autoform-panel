FROM node:22-slim

WORKDIR /app

# No dependencies to install; the server branch uses only built-in node modules.
COPY . .

ENV AUTOFORM_ENV_FILE=/app/config/env

EXPOSE 18788

VOLUME ["/app/data"]

CMD ["node", "server.mjs"]
