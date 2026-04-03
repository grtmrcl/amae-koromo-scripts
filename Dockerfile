FROM node:18-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN pip config set global.index-url https://pypi.flatt.tech/simple/
RUN npm ci --omit=dev --legacy-peer-deps

COPY . .

ENV NODE_ENV=production

CMD ["node", "index.js"]
