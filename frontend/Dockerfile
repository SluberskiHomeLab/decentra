# Frontend: build React app with Vite, serve with nginx, proxy to backend

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

# Needed to generate a self-signed cert at container startup
RUN apk add --no-cache openssl

COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

EXPOSE 8443
ENTRYPOINT ["/docker-entrypoint.sh"]
