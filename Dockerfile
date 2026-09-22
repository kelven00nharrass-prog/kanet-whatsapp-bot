FROM node:20-slim

# Instalar Chromium e dependências para Puppeteer / WA-Automate
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium \
       fonts-liberation \
       fonts-noto-color-emoji \
       ca-certificates \
       procps \
       curl \
       dumb-init \
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
