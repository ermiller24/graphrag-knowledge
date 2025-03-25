.PHONY: build start stop logs shell clean setup-ssh setup-dra

# Build the Docker containers
build:
	docker compose build

# Build without using cache
build-no-cache:
	docker compose build --no-cache

# Start the shell container
start:
	docker compose up -d

# Stop containers
stop:
	docker compose down

# View container logs
logs:
	docker compose logs -f

# Full rebuild: Clean everything and start fresh
rebuild: build-no-cache

redeploy: stop build start