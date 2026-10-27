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
OVERLAY_DIR := plugin/racegow_overlay
OVERLAY_ZIP := $(DIST_DIR)/racegow_overlay-$(VERSION).zip
VENV        := .venv
PY          := $(VENV)/bin/python
COMPOSE     := docker compose -f dev/docker-compose.yml
RH_VERSION  ?= 4.4.0
RH_SRC      := dev/rh-src/$(RH_VERSION)

.PHONY: help setup build check lint format test py-test zip zip-overlay deploy deploy-overlay clean ci \
        rig-up rig-down rig-restart rig-logs dev e2e e2e-install e2e-docker coverage coverage-scrape rig-main-up rig-main-down e2e-main

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

e2e: build ## Browser e2e against the rig (`make rig-up` first; RH_URL=… to point elsewhere; E2E_ARGS=… for playwright)
	cd frontend && npm run e2e -- $(E2E_ARGS)

e2e-install: ## Install Playwright's Chromium (once per machine; CI does this)
	cd frontend && npx playwright install --with-deps chromium

PW_IMAGE := mcr.microsoft.com/playwright:v1.64.1-noble
e2e-docker: build ## Same suite, browser from the Playwright image (for a box without Chromium's libraries)
	docker run --rm --network host --user $$(id -u):$$(id -g) -e HOME=/tmp -e CI="$$CI" -e RH_URL="$${RH_URL:-http://localhost:5050}" \
	  -v "$$(pwd)/frontend:/work" -w /work/e2e $(PW_IMAGE) npx playwright test $(E2E_ARGS)

$(RH_SRC)/.ok: ## RotorHazard's source at the pinned tag (gitignored; for the coverage check)
	rm -rf $(RH_SRC) && git clone --quiet --depth 1 --branch v$(RH_VERSION) https://github.com/RotorHazard/RotorHazard $(RH_SRC)
	touch $@

coverage: $(RH_SRC)/.ok ## Check rh-coverage.tsv classifies every control on RotorHazard's admin pages (#28)
	python3 -I dev/rh_controls.py check $(RH_SRC) rh-coverage.tsv

coverage-scrape: $(RH_SRC)/.ok ## Print RotorHazard's admin-page controls (page, id, kind, label)
	python3 -I dev/rh_controls.py scrape $(RH_SRC)

py-test-rig: ## Plugin tests inside the running rig (RotorHazard's own Python + Flask)
	docker exec gridfpv-rh-dev rm -rf /tmp/gridfpv-tests
	docker cp plugin gridfpv-rh-dev:/tmp/gridfpv-tests
	docker exec gridfpv-rh-dev sh -c 'cd /tmp/gridfpv-tests && python3 -m unittest discover -s tests -v'

zip: build ## Package the plugin (with the built UI) as $(ZIP)
	rm -rf $(DIST_DIR)/stage && mkdir -p $(DIST_DIR)/stage/gridfpv
	cp -r $(PLUGIN_DIR)/*.py $(PLUGIN_DIR)/manifest.json $(PLUGIN_DIR)/README.md $(STATIC_DIR) $(DIST_DIR)/stage/gridfpv/
	find $(DIST_DIR)/stage -name '__pycache__' -type d -prune -exec rm -rf {} +
	rm -f $(ZIP) && cd $(DIST_DIR)/stage && python3 -m zipfile -c ../$(notdir $(ZIP)) gridfpv
	rm -rf $(DIST_DIR)/stage
	@echo "packaged $(ZIP):" && python3 -m zipfile -l $(ZIP)

zip-overlay: build ## Package the overlay-only RaceGOW plugin (same UI, branding) as $(OVERLAY_ZIP)
	rm -rf $(DIST_DIR)/stage && mkdir -p $(DIST_DIR)/stage/racegow_overlay
	cp -r $(OVERLAY_DIR)/*.py $(OVERLAY_DIR)/manifest.json $(OVERLAY_DIR)/README.md $(OVERLAY_DIR)/branding $(STATIC_DIR) $(DIST_DIR)/stage/racegow_overlay/
	find $(DIST_DIR)/stage -name '__pycache__' -type d -prune -exec rm -rf {} +
	rm -f $(OVERLAY_ZIP) && cd $(DIST_DIR)/stage && python3 -m zipfile -c ../$(notdir $(OVERLAY_ZIP)) racegow_overlay
	rm -rf $(DIST_DIR)/stage
	@echo "packaged $(OVERLAY_ZIP):" && python3 -m zipfile -l $(OVERLAY_ZIP)

ci: setup lint check test build zip zip-overlay ## Everything CI runs

clean: ## Remove build output, the venv and node_modules
	rm -rf $(STATIC_DIR) $(DIST_DIR) $(VENV) frontend/node_modules frontend/*/*/node_modules frontend/*/*/dist

MGP_VERSION := v4.0.2
# The release zip, not the git source: the toolkit's compiled verification module only
# ships in the release asset (what RotorHazard's community store installs).
dev/plugins/multigp_toolkit/manifest.json: ## Fetch the MultiGP Toolkit release (dev rig only; gitignored)
	rm -rf dev/plugins/.mgp-rel dev/plugins/multigp_toolkit && mkdir -p dev/plugins/.mgp-rel
	curl -sSL -o dev/plugins/.mgp-rel/multigp_toolkit.zip https://github.com/i-am-grub/multigp-toolkit/releases/download/$(MGP_VERSION)/multigp_toolkit.zip
	cd dev/plugins/.mgp-rel && python3 -m zipfile -e multigp_toolkit.zip x
	cp -r dev/plugins/.mgp-rel/x/multigp_toolkit/custom_plugins/multigp_toolkit dev/plugins/multigp_toolkit
	rm -rf dev/plugins/.mgp-rel

rig-multigp: dev/plugins/multigp_toolkit/manifest.json ## Ensure the MultiGP Toolkit is fetched for the rig

rig-up: dev/plugins/multigp_toolkit/manifest.json ## Start RotorHazard 4.4.0 (mock nodes) on :5050 with the plugins mounted
	$(COMPOSE) up -d --build --wait
	@echo "RotorHazard: http://localhost:$${RH_PORT:-5050}   GridFPV: http://localhost:$${RH_PORT:-5050}/grid   (admin / rotorhazard)"

rig-down: ## Stop the rig
	$(COMPOSE) down

rig-restart: ## Restart RotorHazard (picks up Python changes to the plugin)
	$(COMPOSE) restart rotorhazard

rig-logs: ## Follow RotorHazard's log
	$(COMPOSE) logs -f rotorhazard

RH_MAIN_PORT ?= 5051
rig-main-up: ## A second rig from RotorHazard *main* on :$(RH_MAIN_PORT) (#34; socket auth is on there)
	docker build -q -t gridfpv-rotorhazard:main --build-arg RH_VERSION=main dev/rotorhazard
	-docker rm -f gridfpv-rh-main >/dev/null 2>&1
	docker run -d --name gridfpv-rh-main -p $(RH_MAIN_PORT):5000 -e GRIDFPV_RH_DEMO=1 \
	  -v "$$(pwd)/dev/rotorhazard/mock_data_1.csv:/opt/RotorHazard/src/server/mock_data_1.csv:ro" \
	  -v "$$(pwd)/$(PLUGIN_DIR):/opt/RotorHazard/src/server/plugins/gridfpv:ro" \
	  -v "$$(pwd)/dev/plugins/gridfpv_mock:/opt/RotorHazard/src/server/plugins/gridfpv_mock:ro" \
	  gridfpv-rotorhazard:main
	@for i in $$(seq 1 30); do curl -fsS -o /dev/null http://localhost:$(RH_MAIN_PORT)/ 2>/dev/null && break; sleep 5; done; \
	  curl -fsS -o /dev/null http://localhost:$(RH_MAIN_PORT)/ || { docker logs gridfpv-rh-main | tail -50; exit 1; }
	@echo "RotorHazard main: http://localhost:$(RH_MAIN_PORT)   e2e: RH_URL=http://localhost:$(RH_MAIN_PORT) make e2e-main"

# The two layers of the suite against main (#34). The rig layer (socket.io from Node, which
# sends basic auth on the handshake) must pass; the UI layer (writes from the browser) stays
# red until T8's socket-session fix, so it runs short and never gates. Each writes one line
# to $(E2E_SUMMARY) (CI points it at the job summary).
E2E_SUMMARY ?= /dev/stdout
e2e-main: build ## Both layers against the main rig; a PASS/FAIL line per layer (rig layer is the exit status)
	@rig=PASS; RH_URL=http://localhost:$(RH_MAIN_PORT) $(MAKE) --no-print-directory e2e E2E_ARGS="race-loop" || rig=FAIL; \
	 ui=PASS; RH_URL=http://localhost:$(RH_MAIN_PORT) $(MAKE) --no-print-directory e2e E2E_ARGS="--grep-invert rig-driven --retries=0 --timeout=20000" || ui=FAIL; \
	 { echo "RotorHazard main rig layer: $$rig"; echo "RotorHazard main UI layer: $$ui (expected FAIL until T8, #34)"; } | tee -a $(E2E_SUMMARY); \
	 [ "$$rig" = PASS ]

rig-main-down: ## Stop the main rig
	-docker rm -f gridfpv-rh-main

rig-passes: ## Inject a few gate passes into a mock seat (SEAT=0 N=4 BOUNCY=0) for the tuning screen
	docker cp dev/passes.py gridfpv-rh-dev:/tmp/passes.py
	docker exec gridfpv-rh-dev python3 -I /tmp/passes.py $${SEAT:-0} $${N:-4} $${BOUNCY:-0}

deploy: zip ## Install the zip on a timer over SSH and restart RotorHazard (TIMER=host [SUDO_PASS=…])
	@[ -n "$(TIMER)" ] || { echo "usage: make deploy TIMER=<ssh host>"; exit 1; }
	REMOVE_PLUGINS=racegow_overlay dev/deploy.sh $(TIMER) $(ZIP) gridfpv

deploy-overlay: zip-overlay ## Install the overlay-only plugin on a timer, removing the full plugin (TIMER=host [SUDO_PASS=…])
	@[ -n "$(TIMER)" ] || { echo "usage: make deploy-overlay TIMER=<ssh host>"; exit 1; }
	REMOVE_PLUGINS=gridfpv dev/deploy.sh $(TIMER) $(OVERLAY_ZIP) racegow_overlay

dev: ## Vite dev server with hot reload, proxying socket.io to the rig on :5050
	cd frontend && npm run dev
