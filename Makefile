.PHONY: help backend-install backend-test backend-run mobile-test infra-init infra-plan up down

help:
	@echo "FlexPay — common tasks"
	@echo "  make backend-install   # pip install backend (+dev)"
	@echo "  make backend-test      # pytest"
	@echo "  make backend-run       # uvicorn reload"
	@echo "  make mobile-test       # flutter test"
	@echo "  make up                # docker compose up (pg, redis, api)"
	@echo "  make down              # docker compose down"
	@echo "  make infra-init        # terraform init"
	@echo "  make infra-plan        # terraform plan (env=staging)"

backend-install:
	cd backend && python -m venv .venv && .venv/bin/pip install -e ".[dev]"

backend-test:
	cd backend && .venv/bin/pytest -q

backend-run:
	cd backend && .venv/bin/uvicorn app.main:app --reload

mobile-test:
	cd mobile && flutter test

up:
	docker compose up -d --build

down:
	docker compose down

infra-init:
	cd infra/terraform && terraform init

infra-plan:
	cd infra/terraform && terraform plan -var env=staging
