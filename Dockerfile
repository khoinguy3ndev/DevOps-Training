FROM node:24

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY tsconfig.json ./

COPY src ./src

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]