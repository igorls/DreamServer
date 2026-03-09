// ── Phase 05: Services ──────────────────────────────────────────────────────

import { type InstallContext } from '../lib/config.ts';
import { exec, execStream } from '../lib/shell.ts';
import * as ui from '../lib/ui.ts';

export async function services(ctx: InstallContext): Promise<void> {
  ui.phase(6, 6, 'Launch Services', '~2min');

  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would run: docker compose up -d');
    return;
  }

  // Build compose command
  const composeCmd = await getComposeCommand();
  if (!composeCmd) {
    ui.fail('Neither "docker compose" nor "docker-compose" found');
    process.exit(1);
  }

  ui.step('Starting containers...');
  const exitCode = await execStream(
    [...composeCmd, 'up', '-d', '--remove-orphans'],
    { cwd: ctx.installDir },
  );

  if (exitCode !== 0) {
    // Don't hard-exit — check what actually happened
    ui.warn('docker compose up exited with errors');
    console.log('');
    await showContainerStatus(ctx, composeCmd);
    showRecoveryHelp(ctx, composeCmd);
    // Continue to show success with caveats
  } else {
    ui.ok('All containers started');
  }

  console.log('');

  // Health check
  await healthCheck(ctx, composeCmd);

  // Success summary
  showSuccess(ctx, exitCode !== 0);
}

async function getComposeCommand(): Promise<string[] | null> {
  // Try without sudo first
  try {
    await exec(['docker', 'compose', 'version'], { timeout: 5000 });
    // Verify we can actually connect to the daemon
    const info = await exec(['docker', 'info'], { throwOnError: false, timeout: 5000 });
    if (info.exitCode === 0) return ['docker', 'compose'];
  } catch { /* try sudo */ }

  // Fall back to sudo (user not in docker group)
  try {
    const result = await exec(['sudo', 'docker', 'compose', 'version'], { timeout: 5000 });
    if (result.exitCode === 0) {
      ui.info('Using sudo for Docker (user not in docker group)');
      return ['sudo', 'docker', 'compose'];
    }
  } catch { /* try standalone */ }

  // Try standalone docker-compose
  try {
    await exec(['docker-compose', '--version'], { timeout: 5000 });
    return ['docker-compose'];
  } catch {
    return null;
  }
}

interface ContainerInfo {
  name: string;
  status: string;
  state: string;
}

async function showContainerStatus(ctx: InstallContext, composeCmd: string[]): Promise<void> {
  try {
    const { stdout } = await exec(
      [...composeCmd, 'ps', '--format', 'json'],
      { cwd: ctx.installDir, throwOnError: false, timeout: 10000 },
    );

    if (!stdout.trim()) {
      await showContainerStatusFallback(ctx, composeCmd);
      return;
    }

    const running: string[] = [];
    const failed: string[] = [];

    // Parse containers — handle both JSON array and one-per-line formats
    let containers: Record<string, unknown>[] = [];
    const trimmed = stdout.trim();
    if (trimmed.startsWith('[')) {
      // JSON array format
      try { containers = JSON.parse(trimmed); } catch { /* fallback below */ }
    } else {
      // One JSON object per line
      for (const line of trimmed.split('\n')) {
        try { containers.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }

    if (containers.length === 0) {
      await showContainerStatusFallback(ctx, composeCmd);
      return;
    }

    for (const c of containers) {
      // Docker Compose v2 uses PascalCase, some versions use lowercase
      const name = ((c.Name ?? c.name ?? '') as string).replace(/^dream-/, '');
      const state = ((c.State ?? c.state ?? '') as string).toLowerCase();
      const status = (c.Status ?? c.status ?? '') as string;

      if (state === 'running') {
        running.push(name);
      } else {
        failed.push(`${name} (${status || state})`);
      }
    }

    if (running.length > 0) {
      ui.ok(`Running (${running.length}): ${running.join(', ')}`);
    }
    if (failed.length > 0) {
      for (const f of failed) {
        ui.fail(f);
      }
    }
  } catch {
    await showContainerStatusFallback(ctx, composeCmd);
  }
}

async function showContainerStatusFallback(ctx: InstallContext, composeCmd: string[]): Promise<void> {
  try {
    const { stdout } = await exec(
      [...composeCmd, 'ps'],
      { cwd: ctx.installDir, throwOnError: false, timeout: 10000 },
    );
    if (stdout.trim()) {
      console.log('');
      console.log(stdout);
    }
  } catch {
    ui.info('Could not get container status');
  }
}

function showRecoveryHelp(ctx: InstallContext, composeCmd: string[]) {
  const cmd = composeCmd.join(' ');
  console.log('');
  ui.info('To inspect failed containers:');
  console.log(`     cd ${ctx.installDir}`);
  console.log(`     ${cmd} logs <service-name>`);
  console.log('');
  ui.info('To retry:');
  console.log(`     cd ${ctx.installDir}`);
  console.log(`     ${cmd} up -d`);
}

async function healthCheck(ctx: InstallContext, composeCmd: string[]): Promise<void> {
  ui.step('Checking service health...');

  const checks = [
    { name: 'Open WebUI', url: 'http://localhost:3000' },
  ];

  for (const check of checks) {
    let healthy = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const resp = await fetch(check.url, { signal: AbortSignal.timeout(3000) });
        if (resp.ok || resp.status === 401) {
          healthy = true;
          break;
        }
      } catch { /* retry */ }
      await Bun.sleep(2000);
    }

    if (healthy) ui.ok(`${check.name} online`);
    else ui.warn(`${check.name} still starting (may take a few minutes)`);
  }
}

function showSuccess(ctx: InstallContext, hadErrors: boolean) {
  const localIP = getLocalIP();

  if (hadErrors) {
    ui.header('Installation Partially Complete');
    console.log('');
    ui.warn('Some services failed to start. Core services may still be functional.');
  } else {
    ui.header('Installation Complete');
  }

  console.log('');
  ui.table([
    ['Dashboard', 'http://localhost:3001'],
    ['Chat', 'http://localhost:3000'],
  ]);

  if (localIP) {
    console.log('');
    ui.info('LAN access:');
    ui.table([
      ['Dashboard', `http://${localIP}:3001`],
      ['Chat', `http://${localIP}:3000`],
    ]);
  }

  if (ctx.tailscaleIp) {
    console.log('');
    ui.ok('Tailscale access (secure, no port forwarding):');
    ui.table([
      ['Dashboard', `http://${ctx.tailscaleIp}:3001`],
      ['Chat', `http://${ctx.tailscaleIp}:3000`],
    ]);
  }

  console.log('');
  ui.info('Your data never leaves this machine.');

  if (hadErrors) {
    console.log('');
    ui.info(`Manage services: cd ${ctx.installDir}`);
  }

  console.log('');
}

function getLocalIP(): string | null {
  try {
    const nets = require('node:os').networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}
