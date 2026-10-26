.DEFAULT_GOAL := all
.DELETE_ON_ERROR:
ZIG ?= zig
PYTHON ?= python3
CURL ?= curl
PORT ?= 8816
GAMS_HOST_BIN ?= tools/gams.app/Contents/MacOS/gams
BUILD := build.nosync
SOKOL_URL ?= https://raw.githubusercontent.com/floooh/sokol/master
SHDC_URL ?= https://raw.githubusercontent.com/floooh/sokol-tools-bin/master/bin
GAMS_RELEASE_API ?= https://api.github.com/repos/kkgams/gams/releases/latest
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)
ifeq ($(UNAME_S),Darwin)
SHDC_PLATFORM := osx
else ifeq ($(UNAME_S),Linux)
SHDC_PLATFORM := linux
else
$(error Unsupported shader-tool host: $(UNAME_S))
endif
ifneq ($(filter $(UNAME_M),arm64 aarch64),)
SHDC_PLATFORM := $(SHDC_PLATFORM)_arm64
else ifneq ($(UNAME_M),x86_64)
$(error Unsupported shader-tool architecture: $(UNAME_M))
endif
SOKOL_SHDC := tools/sokol-shdc/$(SHDC_PLATFORM)/sokol-shdc
SOKOL_HEADERS := $(addprefix game/vendor/,sokol_app.h sokol_gfx.h sokol_log.h sokol_glue.h)
SHADER_SOURCES := $(shell find game -name '*.glsl' -type f | LC_ALL=C sort)
SHADER_HEADERS := $(addsuffix .h,$(SHADER_SOURCES))
SHADER_DEPS_DIR := $(BUILD)/shader-deps
SHADER_DEPFILES := $(addprefix $(SHADER_DEPS_DIR)/,$(addsuffix .d,$(SHADER_SOURCES)))
SHADERS_MISSING_DEPS := $(patsubst $(SHADER_DEPS_DIR)/%.d,%.h,$(filter-out $(wildcard $(SHADER_DEPFILES)),$(SHADER_DEPFILES)))
GAME_LOGIC_SOURCES := game/sim.c game/patterns.c game/bulletml/bulletml.c game/bulletml/pack.c
GAME_SOURCES := game/main.c $(GAME_LOGIC_SOURCES) game/render/render2d.c
CONTENT_PACK := $(BUILD)/content/bulletml.rspk
CONTENT_HEADER := $(BUILD)/content/bulletml-pack.h
CONTENT_INPUTS := $(wildcard content/bulletml/*.bulletml.json) content/gams/graphs/bulletml.ng.json $(wildcard content/gams/schema/*.rspk.json)
CONTENT_SCRIPTS := content/gams/pack.mjs content/gams/nodes/bulletml-slots-json.lua content/gams/nodes/build-bulletml-respack.lua
COMMON := $(GAME_SOURCES) game/app.h game/sim.h game/patterns.h game/bulletml/bulletml.h game/bulletml/pack.h game/font.h game/render/render2d.h $(CONTENT_HEADER) $(SHADER_HEADERS) $(SOKOL_HEADERS)
WEB_HEADERS := $(shell find game/web/wasm-include -type f)

.PHONY: all deps sokol sokol-shdc native web run play serve test smoke-native clean shaders content content-inputs
all: native web
deps: sokol sokol-shdc
sokol: $(SOKOL_HEADERS)
sokol-shdc: $(SOKOL_SHDC)

# No prerequisites: existing dependency files are the snapshot, never refreshed
# by normal builds. Download to a temporary file so failure leaves no target.
$(SOKOL_HEADERS):
	@mkdir -p "$(dir $@)"
	@set -eu; trap 'rm -f "$@.tmp"' EXIT; \
		$(CURL) --fail --location --silent --show-error "$(SOKOL_URL)/$(@F)" --output "$@.tmp"; \
		mv "$@.tmp" "$@"
$(SOKOL_SHDC):
	@mkdir -p "$(dir $@)"
	@set -eu; trap 'rm -f "$@.tmp"' EXIT; \
		$(CURL) --fail --location --silent --show-error "$(SHDC_URL)/$(SHDC_PLATFORM)/sokol-shdc" --output "$@.tmp"; \
		chmod +x "$@.tmp"; \
		mv "$@.tmp" "$@"

# Optional Host download, independent of standalone game builds. Existing app
# directories have no prerequisites and are never refreshed by ordinary Make.
tools/gams.app:
	@test "$(UNAME_S)" = Darwin && test "$(SHDC_PLATFORM)" = osx_arm64 || \
		{ echo 'GAMS release download requires macOS Apple Silicon' >&2; exit 1; }
	@mkdir -p tools "$(BUILD)"
	@set -eu; stage=$$(mktemp -d "$(BUILD)/gams-download.XXXXXX"); \
		trap 'rm -rf "$$stage"' EXIT; \
		$(CURL) --fail --location --silent --show-error "$(GAMS_RELEASE_API)" --output "$$stage/release.json"; \
		url=$$($(PYTHON) -c 'import json, sys; release = json.load(open(sys.argv[1])); assets = [a for a in release["assets"] if a["name"].startswith("GAMS-") and a["name"].endswith("-macos-aarch64.zip")]; assert len(assets) == 1, "Expected exactly one GAMS macOS Apple Silicon ZIP asset"; print(assets[0]["browser_download_url"])' "$$stage/release.json"); \
		$(CURL) --fail --location --silent --show-error "$$url" --output "$$stage/gams.zip"; \
		unzip -q "$$stage/gams.zip" -d "$$stage/unpacked"; \
		test -f "$$stage/unpacked/GAMS.app/Contents/Info.plist"; \
		test -x "$$stage/unpacked/GAMS.app/Contents/MacOS/gams"; \
		mv "$$stage/unpacked/GAMS.app" "$@"

# Missing local depfiles require one regeneration to restore include tracking.
ifneq ($(strip $(SHADERS_MISSING_DEPS)),)
.PHONY: shader-deps-missing
shader-deps-missing:
$(SHADERS_MISSING_DEPS): shader-deps-missing
endif

# Headers stay beside authored shaders and are intended for version control.
# Depfiles are build metadata; downloaded tool executables remain in tools/.
shaders: $(SHADER_HEADERS)
%.glsl.h: %.glsl $(SOKOL_SHDC) Makefile
	@mkdir -p "$(SHADER_DEPS_DIR)/$(dir $<)"
	$(SOKOL_SHDC) -i "$<" -o "$@" -l glsl300es:metal_macos -f sokol \
		--no-log-cmdline --dependency-file "$(SHADER_DEPS_DIR)/$<.d"

native: $(BUILD)/triangle
web: $(BUILD)/web/triangle.wasm $(BUILD)/web/index.html $(BUILD)/web/runner.js $(BUILD)/web/gl-bridge.js

$(BUILD)/triangle: Makefile $(COMMON) game/osx/main.c game/osx/sokol_impl.m
	@mkdir -p $(BUILD)
	@SDK=$$(xcrun --sdk macosx --show-sdk-path) && \
	$(ZIG) build-exe -cflags -Werror=strict-prototypes -- \
		game/osx/sokol_impl.m game/osx/main.c $(GAME_SOURCES) -I$(BUILD)/content \
		-lc -O ReleaseSafe --sysroot "$$SDK" -F/System/Library/Frameworks \
		-framework Metal -framework MetalKit -framework Cocoa \
		-framework QuartzCore -framework Foundation -femit-bin=$@

$(BUILD)/web/triangle.wasm: Makefile $(COMMON) game/web/main.c $(WEB_HEADERS)
	@mkdir -p $(BUILD)/web
	$(ZIG) build-exe game/web/main.c $(GAME_SOURCES) -I$(BUILD)/content -target wasm32-freestanding \
		-fno-entry -rdynamic -O ReleaseSafe -I game/web/wasm-include -femit-bin=$@

# Both targets embed the exact same resource bytes. The portable adapter follows
# the registered packaging graph/schema; GAMS can generate this same artifact.
$(CONTENT_PACK): $(CONTENT_INPUTS) $(CONTENT_SCRIPTS)
	node content/gams/pack.mjs

# Validate referenced inputs even on no-op builds: removing a required JSON file
# must not disappear from wildcard prerequisites and silently reuse stale bytes.
content-inputs:
	node content/gams/pack.mjs --check

$(CONTENT_HEADER): $(CONTENT_PACK) content/gams/embed.mjs content/gams/graphs/bulletml.ng.json | content-inputs
	node content/gams/embed.mjs "$(CONTENT_PACK)" "$@"

# Test-only app staging hooks are compiled into a separate WASM, never the game.
$(BUILD)/test/scene.wasm: Makefile $(COMMON) game/web/main.c test/scene.c $(WEB_HEADERS)
	@mkdir -p $(BUILD)/test
	$(ZIG) build-exe game/web/main.c test/scene.c $(GAME_LOGIC_SOURCES) game/render/render2d.c -I$(BUILD)/content -target wasm32-freestanding \
		-fno-entry -rdynamic -O ReleaseSafe -I game/web/wasm-include -femit-bin=$@

$(BUILD)/web/%: game/web/%
	@mkdir -p $(BUILD)/web
	cp $< $@

run: native
	./$(BUILD)/triangle

# Requires a macOS graphical session: draw three real Metal frames, then quit.
smoke-native: native
	./$(BUILD)/triangle --smoke-test
play serve: web
	$(PYTHON) -m http.server $(PORT) --bind 127.0.0.1 --directory $(BUILD)/web

# Optional real GAMS authoring lane: install Units by opening the Project first.
# The newer GAMS pack is preserved and embedded, not overwritten by a fallback.
content:
	GAMS_HOST_BIN="$(GAMS_HOST_BIN)" node content/gams/build.mjs
	$(MAKE) $(CONTENT_HEADER)

test: web $(BUILD)/test/scene.wasm
	node --test test/*.test.mjs

# Retain downloaded tools and committed/generated shader headers.
clean:
	rm -rf $(BUILD)

-include $(SHADER_DEPFILES)
