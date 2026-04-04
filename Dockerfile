FROM node:18-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm config set registry https://npm.flatt.tech
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts

COPY . .

# env.js が存在しない場合は env.js.example からコピー
RUN [ -f env.js ] || cp env.js.example env.js

ENV NODE_ENV=production

CMD ["node", "devServer.js"]
