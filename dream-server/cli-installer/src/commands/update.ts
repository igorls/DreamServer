// ── Update Command ──────────────────────────────────────────────────────────
// Pull latest code, self-update binary, restart services.

import { exec, execStream } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import * as ui from '../lib/ui.ts';
import { VERSION } from '../lib/config.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface UpdateOptions {
  dir?: string;
  skipSelfUpdate?: boolean;
}

const RELEASE_URL = 'https://github.com/Light-Heart-Labs/DreamServer/releases/latest/download/dream-installer-linux-x64';

export async function update(opts: UpdateOptions): Promise<void> {
  const installDir = opts.dir || `${process.env.HOME}/dream-server`;

  if (!existsSync(join(installDir, '.env'))) {
    ui.fail('No Dream Server installation found');
    ui.info('Run: dream-installer install');
    process.exit(1);
  }

  ui.header('Dream Server Update');
  console.log('');

  // Step 1: Self-update the CLI binary
  if (!opts.skipSelfUpdate) {
    await selfUpdate();
  }

  // Step 2: Pull latest code
  ui.step('Pulling latest code...');
  if (existsSync(join(installDir, '.git'))) {
    const exitCode = await execStream(['git', 'pull', '--ff-only'], { cwd: installDir });
    if (exitCode === 0) {
      ui.ok('Code updated');
    } else {
      ui.warn('git pull failed — may have local changes');
      ui.info('Try: cd ' + installDir + ' && git stash && git pull');
    }
  } else {
    ui.warn('Not a git repo — skipping code update');
  }

  // Step 3: Restart services
  console.log('');
  ui.step('Restarting services...');

  let composeCmd: string[];
  try {
    composeCmd = await getComposeCommand();
  } catch {
    ui.fail('Docker not available');
    return;
  }

  // Pull new images
  ui.step('Checking for image updates...');
  await execStream([...composeCmd, 'pull'], { cwd: installDir });

  // Rebuild local images
  ui.step('Rebuilding local images...');
  await execStream([...composeCmd, 'build', '--pull'], { cwd: installDir });

  // Restart with new code/images
  ui.step('Restarting containers...');
  const exitCode = await execStream(
    [...composeCmd, 'up', '-d', '--remove-orphans'],
    { cwd: installDir },
  );

  if (exitCode === 0) {
    ui.ok('All services restarted');
  } else {
    ui.warn('Some services may have failed — check: docker compose ps');
  }

  console.log('');
  ui.ok('Update complete');
  console.log('');
}

async function selfUpdate(): Promise<void> {
  ui.step('Checking for CLI updates...');

  // Get the path to the currently running binary
  const currentBinary = process.execPath;

  try {
    // Check latest release via GitHub API (just HEAD request for speed)
    const resp = await fetch(RELEASE_URL, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      ui.info(`No release binary found (${resp.status}) — skipping self-update`);
      return;
    }

    // Download to temp, then replace
    const tmpPath = '/tmp/dream-installer-update';
    ui.step('Downloading latest CLI...');

    const downloadExitCode = await execStream(
      ['curl', '-fSL', '--connect-timeout', '10', '-o', tmpPath, RELEASE_URL],
    );

    if (downloadExitCode !== 0) {
      ui.warn('Failed to download update — continuing with current version');
      return;
    }

    // Make executable and replace
    await exec(['chmod', '+x', tmpPath]);
    await exec(['mv', tmpPath, currentBinary]);
    ui.ok(`CLI updated to latest version`);
    ui.info('New version will take effect on next run');
  } catch (e) {
    ui.info('Self-update unavailable — continuing with current version');
  }
}
