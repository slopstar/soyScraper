#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Unsupported system: apt-get was not found."
  echo "Install ClamAV manually, then rerun the downloader."
  exit 1
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "This installer needs root privileges and sudo is not available."
    exit 1
  fi
fi

echo "Installing ClamAV packages..."
$SUDO apt-get update
$SUDO apt-get install -y clamav clamav-freshclam

if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl stop clamav-freshclam >/dev/null 2>&1 || true
fi

echo "Updating virus definitions (freshclam)..."
if ! $SUDO freshclam; then
  echo "freshclam failed. You can retry manually: sudo freshclam"
fi

if ! command -v clamscan >/dev/null 2>&1; then
  echo "clamscan is still missing after installation."
  exit 1
fi

echo "Installed scanner: $(clamscan --version)"
