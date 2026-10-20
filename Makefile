# gridfpv-rh — task runner. `make help` lists targets.
#
# Two halves: the frontend (npm workspace under frontend/, built into the plugin folder)
# and the plugin (plain Python, tested with a stub rhapi). `make ci` is what CI runs.

SHELL := /bin/bash
.DEFAULT_GOAL := help

PLUGIN_DIR  := plugin/gridfpv
STATIC_DIR  := $(PLUGIN_DIR)/static
DIST_DIR    := dist
VERSION     := $(shell python3 -c 'import json;print(json.load(open("$(PLUGIN_DIR)/manifest.json"))["version"])')
ZIP         := $(DIST_DIR)/gridfpv-$(VERSION).zip
VENV        := .venv
PY          := $(VENV)/bin/python
COMPOSE     := docker compose -f dev/docker-compose.yml

.PHONY: help setup build check lint format test py-test zip clean ci \
        rig-up rig-down rig-restart rig-logs dev

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'

setup: $(VENV)/.ok ## Install frontend deps and the Python test venv
	cd frontend && npm ci

$(VENV)/.ok: plugin/requirements-dev.txt
	python3 -m venv $(VENV)
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -r plugin/requirements-dev.txt
	touch $@

build: ## Build the SPA into $(STATIC_DIR)
	cd frontend && npm run build

check: ## Type-check the frontend and byte-compile the plugin
	# The app's types resolve against the component library's built dist/, so build it first.
	cd frontend && npm run build --workspace @gridfpv/components && npm run check
	python3 -m py_compile $(PLUGIN_DIR)/__init__.py

lint: ## ESLint + Prettier (check only)
	cd frontend && npm run lint

format: ## Prettier (write)
	cd frontend && npm run format

test: py-test ## Frontend + plugin tests
	cd frontend && npm test

py-test: $(VENV)/.ok ## Plugin tests only (needs python3-venv; or use py-test-rig)
	$(PY) -m unittest discover -s plugin/tests -v

py-test-rig: ## Plugin tests inside the running rig (RotorHazard's own Python + Flask)
	docker exec gridfpv-rh-dev rm -rf /tmp/gridfpv-tests
	docker cp plugin gridfpv-rh-dev:/tmp/gridfpv-tests
	docker exec gridfpv-rh-dev sh -c 'cd /tmp/gridfpv-tests && python3 -m unittest discover -s tests -v'

zip: build ## Package the plugin (with the built UI) as $(ZIP)
	rm -rf $(DIST_DIR)/stage && mkdir -p $(DIST_DIR)/stage/gridfpv
	cp -r $(PLUGIN_DIR)/__init__.py $(PLUGIN_DIR)/manifest.json $(PLUGIN_DIR)/README.md $(STATIC_DIR) $(DIST_DIR)/stage/gridfpv/
	find $(DIST_DIR)/stage -name '__pycache__' -type d -prune -exec rm -rf {} +
	rm -f $(ZIP) && cd $(DIST_DIR)/stage && python3 -m zipfile -c ../$(notdir $(ZIP)) gridfpv
	rm -rf $(DIST_DIR)/stage
	@echo "packaged $(ZIP):" && python3 -m zipfile -l $(ZIP)

ci: setup lint check test build zip ## Everything CI runs

clean: ## Remove build output, the venv and node_modules
	rm -rf $(STATIC_DIR) $(DIST_DIR) $(VENV) frontend/node_modules frontend/*/*/node_modules frontend/*/*/dist

rig-up: ## Start RotorHazard 4.4.0 (mock nodes) on :5050 with the plugin mounted
	$(COMPOSE) up -d --build
	@echo "RotorHazard: http://localhost:$${RH_PORT:-5050}   GridFPV: http://localhost:$${RH_PORT:-5050}/grid   (admin / rotorhazard)"

rig-down: ## Stop the rig
	$(COMPOSE) down

rig-restart: ## Restart RotorHazard (picks up Python changes to the plugin)
	$(COMPOSE) restart rotorhazard

rig-logs: ## Follow RotorHazard's log
	$(COMPOSE) logs -f rotorhazard

dev: ## Vite dev server with hot reload, proxying socket.io to the rig on :5050
	cd frontend && npm run dev
