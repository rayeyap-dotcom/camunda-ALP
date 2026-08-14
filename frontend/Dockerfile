FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Vite bakes VITE_-prefixed vars into the bundle at build time, so they must
# be supplied as build args (docker build --build-arg) rather than runtime env.
ARG VITE_API_BASE_URL
ARG VITE_DASHBOARD_ID
ARG VITE_COLLECTION_ID
ARG VITE_PROCESS_ID
ARG VITE_PROCESS_INSTANCE_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_DASHBOARD_ID=$VITE_DASHBOARD_ID \
    VITE_COLLECTION_ID=$VITE_COLLECTION_ID \
    VITE_PROCESS_ID=$VITE_PROCESS_ID \
    VITE_PROCESS_INSTANCE_KEY=$VITE_PROCESS_INSTANCE_KEY

RUN npm run build

FROM node:20-alpine

WORKDIR /app
RUN npm install -g serve

COPY --from=build /app/dist ./dist

EXPOSE 8080

# Cloud Run injects PORT at runtime (default 8080); shell form so it expands,
# exec replaces the shell so serve receives SIGTERM directly on scale-down.
CMD ["sh", "-c", "exec serve -s dist -l tcp://0.0.0.0:${PORT:-8080}"]
