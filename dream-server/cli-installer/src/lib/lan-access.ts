// ── LAN Access Utility ──────────────────────────────────────────────────────
// Toggle port bindings between localhost-only (127.0.0.1) and LAN-accessible (0.0.0.0)

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as ui from './ui.ts';

/**
 * Patch all compose files in installDir to bind ports to 0.0.0.0 (enable)
 * or 127.0.0.1 (disable).
 *
 * @returns number of files patched
 */
export function setLanAccess(installDir: string, enable: boolean): number {
  const from = enable ? '127.0.0.1' : '0.0.0.0';
  const to = enable ? '0.0.0.0' : '127.0.0.1';

  const composeFiles = findComposeFiles(installDir);
  let patched = 0;

  for (const file of composeFiles) {
    const content = readFileSync(file, 'utf-8');
    // Match port bindings like "127.0.0.1:${PORT:-3000}:8080" or "127.0.0.1:3000:8080"
    const pattern = new RegExp(`"${escapeRegex(from)}:`, 'g');
    if (!pattern.test(content)) continue;

    const updated = content.replace(pattern, `"${to}:`);
    writeFileSync(file, updated);
    patched++;
  }

  return patched;
}

/**
 * Read the current LAN access state from .env
 */
export function isLanAccessEnabled(installDir: string): boolean {
  const envPath = join(installDir, '.env');
  if (!existsSync(envPath)) return false;

  const content = readFileSync(envPath, 'utf-8');
  const match = content.match(/^LAN_ACCESS=(.+)$/m);
  return match?.[1]?.trim() === 'true';
}

/**
 * Find all compose YAML files in the install directory (base + extensions)
 */
function findComposeFiles(installDir: string): string[] {
  const files: string[] = [];

  // Root compose files
  if (existsSync(installDir)) {
    for (const f of readdirSync(installDir)) {
      if (f.startsWith('docker-compose') && (f.endsWith('.yml') || f.endsWith('.yaml'))) {
        files.push(join(installDir, f));
      }
    }
  }

  // Extension compose files
  const extDir = join(installDir, 'extensions', 'services');
  if (existsSync(extDir)) {
    for (const service of readdirSync(extDir)) {
      const serviceDir = join(extDir, service);
      try {
        for (const f of readdirSync(serviceDir)) {
          if (f.startsWith('compose') && (f.endsWith('.yml') || f.endsWith('.yaml'))) {
            files.push(join(serviceDir, f));
          }
        }
      } catch {
        // Not a directory — skip
      }
    }
  }

  return files;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
