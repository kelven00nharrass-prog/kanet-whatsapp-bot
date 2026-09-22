FROM node:20-bullseye-slim

# Instalar dependências para Chromium / Puppeteer / WA-Automate
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    procps \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Variáveis de ambiente para Puppeteer / Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=10000

WORKDIR /app

# Instalar PM2 globalmente
RUN npm install -g pm2

# Copiar dependências e instalar
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copiar os ficheiros do projeto
COPY . .

# Expor porta
EXPOSE 10000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:10000/health || curl -f http://localhost:10000/ || exit 0

# Iniciar o bot com PM2
CMD ["pm2-runtime", "kanet-loader.js", "--name", "kanet-bot"]
