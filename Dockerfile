FROM node:22-bookworm-slim

# Install FFmpeg (for real Google Flow Multi-Scene .mp4 video stitching & audio mixing) and CA certificates
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (including tsx & vite for build and TypeScript server execution)
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

# Copy application source and build production frontend bundle
COPY . .
RUN npm run build

# Ensure runtime directories for SQLite DB and generated AI media exist
RUN mkdir -p /app/data /app/uploads/images /app/uploads/videos /app/uploads/audio

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start"]
