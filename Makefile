.PHONY: install backend-install frontend-install lint format format-check test run shell-test backend-lint backend-format backend-format-check backend-test frontend-lint frontend-format frontend-format-check frontend-test frontend-e2e-install frontend-e2e-test

ifneq (,$(wildcard .env))
include .env
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env)
endif

FRONTEND_PORT ?= 3000
FRONTEND_HOST ?= 0.0.0.0
BACKEND_PORT ?= 8000
BACKEND_VENV_BIN := backend/.venv/bin
PYTHON := $(BACKEND_VENV_BIN)/python
PIP := $(PYTHON) -m pip
PYTEST := $(BACKEND_VENV_BIN)/pytest
RUFF := $(BACKEND_VENV_BIN)/ruff
PNPM := pnpm --dir frontend
CHROMIUM_DETECT := bash scripts/find-chromium.sh

install: backend-install frontend-install

backend-install:
	python3 -m venv backend/.venv
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements.txt -r backend/requirements-dev.txt

frontend-install:
	$(PNPM) install --frozen-lockfile

lint: backend-lint frontend-lint

format: backend-format frontend-format

format-check: backend-format-check frontend-format-check

test: backend-test frontend-test shell-test
	$(MAKE) frontend-e2e-install
	$(MAKE) frontend-e2e-test

run:
	./run-dev.sh --frontend-host "$(FRONTEND_HOST)" --frontend-port "$(FRONTEND_PORT)" --backend-port "$(BACKEND_PORT)"

shell-test:
	bash tests/run-dev.test.sh
	bash tests/find-chromium.test.sh
	bash -n run-dev.sh tests/run-dev.test.sh
	bash -n scripts/find-chromium.sh tests/find-chromium.test.sh

backend-lint:
	@test -x $(RUFF) || { echo "Missing $(RUFF). Run: make backend-install"; exit 1; }
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .

backend-format:
	@test -x $(RUFF) || { echo "Missing $(RUFF). Run: make backend-install"; exit 1; }
	cd backend && .venv/bin/ruff check --fix . && .venv/bin/ruff format .

backend-format-check:
	@test -x $(RUFF) || { echo "Missing $(RUFF). Run: make backend-install"; exit 1; }
	cd backend && .venv/bin/ruff format --check .

backend-test:
	@test -x $(PYTEST) || { echo "Missing $(PYTEST). Run: make backend-install"; exit 1; }
	cd backend && .venv/bin/pytest tests/ -q

frontend-lint:
	$(PNPM) lint
	$(PNPM) format:check

frontend-format:
	$(PNPM) format

frontend-format-check:
	$(PNPM) format:check

frontend-test:
	$(PNPM) test

frontend-e2e-install:
	@if browser="$$( $(CHROMIUM_DETECT) 2>/dev/null )"; then \
		echo "Using existing Chrome/Chromium: $$browser"; \
	else \
		dry_run="$$( $(PNPM) exec playwright install --dry-run chromium )" || exit $$?; \
		missing_locations="$$( printf '%s\n' "$$dry_run" | sed -n 's/^  Install location:[[:space:]]*//p' | while IFS= read -r location; do if [ ! -e "$$location" ]; then printf '%s\n' "$$location"; fi; done )"; \
		if [ -z "$$missing_locations" ]; then \
			echo "Using existing Playwright browser cache."; \
		else \
			echo "No existing Chrome/Chromium found for this Playwright version; installing fallback."; \
			$(PNPM) exec playwright install chromium; \
		fi; \
	fi

frontend-e2e-test:
	PLAYWRIGHT_RUN_ID="$$(date +%s)-$$$$" $(PNPM) test:e2e
