.PHONY: build start stop logs shell clean setup-ssh setup-dra init-schema

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

restart: stop build start init-schema

redeploy: destroy build start init-schema