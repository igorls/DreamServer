import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setLanAccess, isLanAccessEnabled } from '../src/lib/lan-access.ts';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('lan-access.ts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-lan-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createComposeFile(name: string, content: string): string {
    const path = join(tmpDir, name);
    writeFileSync(path, content);
    return path;
  }

  function createExtensionCompose(service: string, content: string): string {
    const dir = join(tmpDir, 'extensions', 'services', service);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compose.yaml');
    writeFileSync(path, content);
    return path;
  }

  const SAMPLE_COMPOSE = `services:
  open-webui:
    ports:
      - "127.0.0.1:\${WEBUI_PORT:-3000}:8080"
  dashboard:
    ports:
      - "127.0.0.1:\${DASHBOARD_PORT:-3001}:3001"
`;

  const SAMPLE_EXTENSION = `services:
  searxng:
    ports:
      - "127.0.0.1:\${SEARXNG_PORT:-8888}:8080"
`;

  test('setLanAccess(enable) replaces 127.0.0.1 with 0.0.0.0', () => {
    createComposeFile('docker-compose.base.yml', SAMPLE_COMPOSE);
    const patched = setLanAccess(tmpDir, true);

    expect(patched).toBe(1);
    const content = readFileSync(join(tmpDir, 'docker-compose.base.yml'), 'utf-8');
    expect(content).toContain('"0.0.0.0:${WEBUI_PORT:-3000}:8080"');
    expect(content).toContain('"0.0.0.0:${DASHBOARD_PORT:-3001}:3001"');
    expect(content).not.toContain('127.0.0.1');
  });

  test('setLanAccess(disable) replaces 0.0.0.0 with 127.0.0.1', () => {
    const enabledCompose = SAMPLE_COMPOSE.replace(/127\.0\.0\.1/g, '0.0.0.0');
    createComposeFile('docker-compose.base.yml', enabledCompose);
    const patched = setLanAccess(tmpDir, false);

    expect(patched).toBe(1);
    const content = readFileSync(join(tmpDir, 'docker-compose.base.yml'), 'utf-8');
    expect(content).toContain('"127.0.0.1:${WEBUI_PORT:-3000}:8080"');
    expect(content).not.toContain('0.0.0.0');
  });

  test('patches extension compose files', () => {
    createComposeFile('docker-compose.base.yml', SAMPLE_COMPOSE);
    createExtensionCompose('searxng', SAMPLE_EXTENSION);

    const patched = setLanAccess(tmpDir, true);
    expect(patched).toBe(2);

    const extContent = readFileSync(join(tmpDir, 'extensions', 'services', 'searxng', 'compose.yaml'), 'utf-8');
    expect(extContent).toContain('"0.0.0.0:${SEARXNG_PORT:-8888}:8080"');
  });

  test('is idempotent — enable twice has no effect', () => {
    createComposeFile('docker-compose.base.yml', SAMPLE_COMPOSE);

    setLanAccess(tmpDir, true);
    const after1 = readFileSync(join(tmpDir, 'docker-compose.base.yml'), 'utf-8');

    const patched2 = setLanAccess(tmpDir, true);
    const after2 = readFileSync(join(tmpDir, 'docker-compose.base.yml'), 'utf-8');

    expect(patched2).toBe(0); // nothing to patch
    expect(after1).toBe(after2);
  });

  test('returns 0 when no compose files exist', () => {
    const patched = setLanAccess(tmpDir, true);
    expect(patched).toBe(0);
  });

  test('isLanAccessEnabled reads from .env', () => {
    writeFileSync(join(tmpDir, '.env'), 'LAN_ACCESS=true\nOTHER=value');
    expect(isLanAccessEnabled(tmpDir)).toBe(true);
  });

  test('isLanAccessEnabled returns false when disabled', () => {
    writeFileSync(join(tmpDir, '.env'), 'LAN_ACCESS=false');
    expect(isLanAccessEnabled(tmpDir)).toBe(false);
  });

  test('isLanAccessEnabled returns false when no .env exists', () => {
    expect(isLanAccessEnabled(tmpDir)).toBe(false);
  });
});
