#!/bin/bash
# Dream Server CLI Installer - Quick Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/igorls/DreamServer/main/scripts/get-dream-installer.sh | bash
#
# This script:
#   1. Detects your OS and architecture
#   2. Downloads the correct binary from GitHub Releases
#   3. Verifies SHA256 checksum
#   4. Installs to /usr/local/bin (or ~/.local/bin if not root)
#   5. Verifies the binary works

set -euo pipefail

REPO="igorls/DreamServer"
BINARY_NAME="dream-installer"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

# ── Platform Detection ───────────────────────────────────────────────────────

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)   os="linux" ;;
    Darwin*)  os="macos" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *)        fail "Unsupported OS: $(uname -s)" ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)   arch="x64" ;;
    arm64|aarch64)  arch="arm64" ;;
    *)              fail "Unsupported architecture: $(uname -m)" ;;
  esac

  ARTIFACT="${BINARY_NAME}-${os}-${arch}"
  if [[ "$os" == "windows" ]]; then
    ARTIFACT="${BINARY_NAME}-windows-x64.exe"
  fi
}

# ── Install Directory ────────────────────────────────────────────────────────

detect_install_dir() {
  if [[ "$(id -u)" -eq 0 ]]; then
    INSTALL_DIR="/usr/local/bin"
  else
    INSTALL_DIR="${HOME}/.local/bin"
    mkdir -p "$INSTALL_DIR"
  fi
}

# ── Download & Verify ────────────────────────────────────────────────────────

download_and_verify() {
  local url="https://github.com/${REPO}/releases/latest/download/${ARTIFACT}"
  local checksum_url="${url}.sha256"
  local tmp_dir

  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  info "Downloading ${BOLD}${ARTIFACT}${NC}..."
  if ! curl -fSL --progress-bar -o "${tmp_dir}/${ARTIFACT}" "$url"; then
    fail "Download failed. Check https://github.com/${REPO}/releases"
  fi

  info "Verifying SHA256 checksum..."
  if curl -fsSL -o "${tmp_dir}/${ARTIFACT}.sha256" "$checksum_url" 2>/dev/null; then
    cd "$tmp_dir"
    if command -v sha256sum &>/dev/null; then
      if sha256sum --check "${ARTIFACT}.sha256" --quiet 2>/dev/null; then
        ok "Checksum verified"
      else
        fail "SHA256 verification failed — binary may be corrupted"
      fi
    elif command -v shasum &>/dev/null; then
      if shasum -a 256 --check "${ARTIFACT}.sha256" --quiet 2>/dev/null; then
        ok "Checksum verified"
      else
        fail "SHA256 verification failed — binary may be corrupted"
      fi
    else
      warn "No sha256sum/shasum found — skipping verification"
    fi
    cd - >/dev/null
  else
    warn "Checksum file not available — skipping verification"
  fi

  # Install
  chmod +x "${tmp_dir}/${ARTIFACT}"
  mv "${tmp_dir}/${ARTIFACT}" "${INSTALL_DIR}/${BINARY_NAME}"
  ok "Installed to ${BOLD}${INSTALL_DIR}/${BINARY_NAME}${NC}"
}

# ── PATH Check ───────────────────────────────────────────────────────────────

ensure_path() {
  if [[ ":${PATH}:" == *":${INSTALL_DIR}:"* ]]; then
    return 0
  fi

  warn "${INSTALL_DIR} is not in your PATH"

  # Try to add to shell profile
  local shell_rc=""
  case "${SHELL:-}" in
    */zsh)  shell_rc="${HOME}/.zshrc" ;;
    */bash) shell_rc="${HOME}/.bashrc" ;;
    */fish) shell_rc="${HOME}/.config/fish/config.fish" ;;
  esac

  if [[ -n "$shell_rc" ]]; then
    local path_line="export PATH=\"${INSTALL_DIR}:\$PATH\""
    if [[ "${SHELL:-}" == */fish ]]; then
      path_line="set -gx PATH ${INSTALL_DIR} \$PATH"
    fi

    if ! grep -qF "$INSTALL_DIR" "$shell_rc" 2>/dev/null; then
      echo "" >> "$shell_rc"
      echo "# Dream Server CLI" >> "$shell_rc"
      echo "$path_line" >> "$shell_rc"
      ok "Added ${INSTALL_DIR} to ${shell_rc}"
    fi
  fi

  info "Run: ${BOLD}export PATH=\"${INSTALL_DIR}:\$PATH\"${NC}  (or restart your terminal)"
}

# ── Verify ───────────────────────────────────────────────────────────────────

verify_install() {
  if "${INSTALL_DIR}/${BINARY_NAME}" --version &>/dev/null; then
    local version
    version=$("${INSTALL_DIR}/${BINARY_NAME}" --version 2>/dev/null || echo "unknown")
    ok "dream-installer ${version} ready"
  else
    warn "Binary installed but could not execute — check your system"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo -e "${BOLD}  Dream Server CLI Installer${NC}"
  echo -e "  ${BLUE}https://github.com/${REPO}${NC}"
  echo ""

  detect_platform
  detect_install_dir
  download_and_verify
  ensure_path
  verify_install

  echo ""
  echo -e "  ${GREEN}${BOLD}Get started:${NC}"
  echo -e "    ${BOLD}dream-installer install${NC}              # Full installation"
  echo -e "    ${BOLD}dream-installer install --lan-access${NC}  # With LAN access"
  echo -e "    ${BOLD}dream-installer --help${NC}                # All commands"
  echo ""
}

main "$@"
