#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APT_UPDATED=0

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

info() {
  echo "[setup] $*"
}

warn() {
  echo "[setup] WARN: $*" >&2
}

run_with_heartbeat() {
  local label="$1"
  shift

  local heartbeat_seconds="${SETUP_HEARTBEAT_SECONDS:-20}"
  local started_at
  started_at="$(date +%s)"
  local command_pid=""
  local monitor_pid=""
  local exit_code=0

  "$@" &
  command_pid=$!

  (
    while kill -0 "$command_pid" >/dev/null 2>&1; do
      sleep "$heartbeat_seconds"
      if kill -0 "$command_pid" >/dev/null 2>&1; then
        local now elapsed
        now="$(date +%s)"
        elapsed=$((now - started_at))
        info "$label is still running (${elapsed}s elapsed)..."
      fi
    done
  ) &
  monitor_pid=$!

  wait "$command_pid" || exit_code=$?
  kill "$monitor_pid" >/dev/null 2>&1 || true
  wait "$monitor_pid" 2>/dev/null || true

  if [ "$exit_code" -ne 0 ]; then
    warn "$label failed (exit code $exit_code)."
    return "$exit_code"
  fi

  local completed_at elapsed_total
  completed_at="$(date +%s)"
  elapsed_total=$((completed_at - started_at))
  info "$label finished in ${elapsed_total}s."
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi
  if has_cmd sudo; then
    sudo "$@"
    return
  fi
  warn "Root privileges are required to run: $*"
  return 1
}

detect_package_manager() {
  for candidate in apt-get dnf yum pacman brew; do
    if has_cmd "$candidate"; then
      echo "$candidate"
      return
    fi
  done
  echo ""
}

apt_update_once() {
  if [ "$APT_UPDATED" -eq 0 ]; then
    run_as_root apt-get update
    APT_UPDATED=1
  fi
}

install_node_and_npm() {
  local package_manager="$1"
  case "$package_manager" in
    apt-get)
      apt_update_once
      run_as_root apt-get install -y nodejs npm
      ;;
    dnf)
      run_as_root dnf install -y nodejs npm
      ;;
    yum)
      run_as_root yum install -y nodejs npm
      ;;
    pacman)
      run_as_root pacman -Sy --noconfirm nodejs npm
      ;;
    brew)
      brew install node
      ;;
    *)
      return 1
      ;;
  esac
}

install_clamav() {
  local package_manager="$1"
  case "$package_manager" in
    apt-get)
      apt_update_once
      run_as_root apt-get install -y clamav clamav-freshclam
      if has_cmd freshclam; then
        run_as_root freshclam || true
      fi
      ;;
    dnf)
      run_as_root dnf install -y clamav clamav-update
      ;;
    yum)
      run_as_root yum install -y clamav clamav-update
      ;;
    pacman)
      run_as_root pacman -Sy --noconfirm clamav
      ;;
    brew)
      brew install clamav
      ;;
    *)
      return 1
      ;;
  esac
}

has_supported_browser() {
  for candidate in \
    google-chrome-stable \
    google-chrome \
    chromium-browser \
    chromium \
    /usr/bin/google-chrome-stable \
    /usr/bin/google-chrome \
    /usr/bin/chromium-browser \
    /usr/bin/chromium \
    /snap/bin/chromium
  do
    if has_cmd "$candidate"; then
      return 0
    fi
  done
  return 1
}

install_system_browser() {
  local package_manager="$1"
  case "$package_manager" in
    apt-get)
      apt_update_once
      run_as_root apt-get install -y chromium-browser || run_as_root apt-get install -y chromium
      ;;
    dnf)
      run_as_root dnf install -y chromium
      ;;
    yum)
      run_as_root yum install -y chromium
      ;;
    pacman)
      run_as_root pacman -Sy --noconfirm chromium
      ;;
    brew)
      warn "Automatic browser install is not configured for Homebrew."
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

run_browser_smoke_test() {
  node - <<'NODE'
const { launchBrowser } = require('./src/scraper/browser');

(async () => {
  const browser = await launchBrowser({ headless: 'new' });
  await browser.close();
})();
NODE
}

ensure_browser_launchable() {
  local package_manager="$1"
  info "Validating browser runtime for Puppeteer..."
  if run_with_heartbeat "browser smoke test" run_browser_smoke_test; then
    info "Browser runtime check passed."
    return
  fi

  warn "Browser smoke test failed."
  if has_supported_browser; then
    warn "A system browser exists but launch still failed."
    warn "Try rerunning with SOYSCRAPER_BROWSER_PATH set to your browser binary."
    return
  fi

  if [ -z "$package_manager" ]; then
    warn "No supported package manager detected for browser install."
    warn "Install Chromium/Chrome manually, then rerun setup."
    return
  fi

  info "No system browser detected. Installing one via $package_manager..."
  if install_system_browser "$package_manager"; then
    if run_with_heartbeat "browser smoke test after browser install" run_browser_smoke_test; then
      info "Browser runtime check passed after installing system browser."
      return
    fi
  fi

  warn "Could not verify a working browser runtime."
  warn "Install Chromium/Chrome manually and rerun setup."
}

main() {
  info "Starting SoyScraper setup..."
  local package_manager
  package_manager="$(detect_package_manager)"

  if ! has_cmd node || ! has_cmd npm; then
    if [ -z "$package_manager" ]; then
      warn "Could not detect a supported package manager."
      warn "Install Node.js + npm manually, then rerun this script."
      exit 1
    fi
    info "Installing Node.js and npm via $package_manager..."
    install_node_and_npm "$package_manager"
  fi

  if ! has_cmd node || ! has_cmd npm; then
    warn "Node.js or npm is still missing after install attempt."
    exit 1
  fi

  info "Node.js detected: $(node --version)"
  info "npm detected: $(npm --version)"

  info "Installing project dependencies (this can take a few minutes on first run)..."
  run_with_heartbeat "npm install" npm install

  if has_cmd clamscan; then
    info "ClamAV already installed: $(clamscan --version | head -n 1)"
  elif [ -n "$package_manager" ]; then
    info "Installing ClamAV (required by default strict-media-safety mode)..."
    if install_clamav "$package_manager" && has_cmd clamscan; then
      info "ClamAV installed: $(clamscan --version | head -n 1)"
    else
      warn "ClamAV installation did not complete."
      warn "Install ClamAV manually or run with SOYSCRAPER_REQUIRE_VIRUS_SCAN=false"
    fi
  else
    warn "Could not detect package manager for ClamAV install."
    warn "Install ClamAV manually or run with SOYSCRAPER_REQUIRE_VIRUS_SCAN=false"
  fi

  ensure_browser_launchable "$package_manager"

  cat <<'EOF'

Setup complete.

Run downloader:
  npm start

Run web UI:
  npm run webui
EOF
}

main "$@"
