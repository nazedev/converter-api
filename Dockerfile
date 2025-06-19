FROM node:lts-buster

RUN apt-get update && \
  apt-get install -y --no-install-recommends \
  ffmpeg \
  imagemagick \
  webp && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=7860
EXPOSE 7860

CMD ["node", "app.js"]