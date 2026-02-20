#!/bin/bash
set -e

echo "=== Iron Gate Development Setup ==="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "Error: pnpm is required. Run: npm install -g pnpm"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Warning: Docker not found. DB and Redis won't be available."; }

echo "  Node.js: $(node -v)"
echo "  pnpm: $(pnpm -v)"
echo ""

# Install dependencies
echo "Installing dependencies..."
pnpm install
echo ""

# Copy environment file
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi
echo ""

# Start infrastructure
if command -v docker >/dev/null 2>&1; then
  echo "Starting infrastructure services (PostgreSQL + Redis)..."
  docker compose -f infra/docker/docker-compose.dev.yml up -d
  echo "Waiting for services to be ready..."
  sleep 5
  echo ""
fi

echo "=== Setup Complete ==="
echo ""
echo "Available commands:"
echo "  pnpm dev                    - Start all services"
echo "  pnpm dev --filter=extension - Extension only"
echo "  pnpm dev --filter=api       - API only"
echo "  pnpm dev --filter=dashboard - Dashboard only"
echo ""
echo "Infrastructure:"
echo "  PostgreSQL: localhost:5432"
echo "  Redis:      localhost:6379"
echo ""
