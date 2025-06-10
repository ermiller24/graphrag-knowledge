.PHONY: build start stop logs shell clean setup-ssh setup-dra init-schema start-api stop-api logs-api api-restart

# Build the Docker containers
build:
	docker compose build

# Build without using cache
build-no-cache:
	docker compose build --no-cache

# Start the shell container
start:
	docker compose up -d

# Initialize database schema (run after start)
init-schema:
	docker exec graphrag-knowledge-mcp node scripts/init-schema.ts

# Stop containers
stop:
	docker compose down

destroy:
	docker compose down --volumes --remove-orphans

# View container logs
logs:
	docker compose logs -f

# Full rebuild: Clean everything and start fresh
rebuild: build-no-cache

restart: stop build start

redeploy: destroy build start init-schema

mcp-restart:
	docker compose down mcp && \
	docker compose up -d --build mcp

# REST API specific commands
start-api:
	docker compose up -d rest-api

stop-api:
	docker compose down rest-api

logs-api:
	docker compose logs -f rest-api

api-restart:
	docker compose down rest-api && \
	docker compose up -d --build rest-api

# Start both MCP and REST API services
start-all:
	docker compose up -d

# Test the REST API health endpoint
test-api:
	curl -f http://localhost:3001/api/v1/health || echo "API not responding"