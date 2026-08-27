FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache bash curl

COPY package.json ./
RUN npm install

COPY . .
RUN chmod +x scripts/start.sh

EXPOSE 8545

CMD ["npm", "start"]
