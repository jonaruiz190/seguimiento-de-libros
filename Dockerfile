FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY data ./data
COPY server ./server

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["npm", "start"]
