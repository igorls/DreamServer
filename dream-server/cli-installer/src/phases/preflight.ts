// ── Phase 01: Preflight ─────────────────────────────────────────────────────

import { type InstallContext } from '../lib/config.ts';
import { exec, execStream, commandExists } from '../lib/shell.ts';
import { IS_WINDOWS, IS_MACOS, getOsName, getDockerInstallHint, getDockerDaemonFixHint } from '../lib/platform.ts';
import { resetCache as resetDockerCache } from '../lib/docker.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, readFileSync } from 'node:fs';

export interface PreflightResult {
  os: string;
  distro: string;
  arch: string;
  hasDocker: boolean;
  hasDockerCompose: boolean;
  hasGit: boolean;
  hasCurl: boolean;
  hasNvidiaSmi: boolean;
  dockerRunning: boolean;
  tailscaleIp: string | null;
}

export async function preflight(ctx: InstallContext): Promise<PreflightResult> {
  ui.phase(1, 6, 'Preflight', '~5s');
  ui.step('Scanning system...');

  // Root check — Linux/macOS only (Windows has no getuid)
  if (!IS_WINDOWS && process.getuid?.() === 0 && !process.env.SUDO_USER) {
    ui.fail('Do not run as root. Use sudo instead: sudo dream-installer install');
    process.exit(1);
  }

  // OS Detection
  const os = getOsName();
  let distro = '';
  if (IS_WINDOWS) {
    try {
      const result = await exec(
        ['powershell', '-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).Caption'],
        { throwOnError: false, timeout: 5000 },
      );
      if (result.exitCode === 0 && result.stdout.trim()) {
        distro = result.stdout.trim();
      }
    } catch { /* Windows version detection failed — not critical */ }
  } else if (IS_MACOS) {
    try {
      const [nameResult, verResult] = await Promise.all([
        exec(['sw_vers', '-productName'], { throwOnError: false, timeout: 3000 }),
        exec(['sw_vers', '-productVersion'], { throwOnError: false, timeout: 3000 }),
      ]);
      const name = nameResult.exitCode === 0 ? nameResult.stdout.trim() : 'macOS';
      const ver = verResult.exitCode === 0 ? verResult.stdout.trim() : '';
      distro = ver ? `${name} ${ver}` : name;
    } catch { /* macOS version detection failed — not critical */ }
  } else if (existsSync('/etc/os-release')) {
    const content = await Bun.file('/etc/os-release').text();
    const match = content.match(/^PRETTY_NAME="?(.+?)"?$/m);
    if (match) distro = match[1];
  }
  ctx.system.os = os;
  ctx.system.distro = distro;
  ctx.system.arch = process.arch;
  ui.ok(`OS: ${distro || os} (${process.arch})`);

  // Tool checks
  const [hasGit, hasCurl, hasNvidiaSmi] = await Promise.all([
    commandExists('git'),
    commandExists('curl'),
    commandExists('nvidia-smi'),
  ]);

  // Fix stale Docker Desktop context — if Docker Desktop was previously installed
  // but only Docker Engine is active, the CLI may point to a non-existent socket.
  if (!IS_WINDOWS && !IS_MACOS) {
    await fixStaleDockerContext();
  }

  // Docker: verify we can actually talk to the daemon, not just that the binary exists
  let hasDocker = false;
  let hasDockerCompose = false;
  let dockerRunning = false;

  try {
    const { getComposeCommand } = await import('../lib/docker.ts');
    const composeCmd = await getComposeCommand();
    hasDocker = true;
    hasDockerCompose = true;
    dockerRunning = true;
    ui.ok(`Docker ready (${composeCmd.join(' ')})`);
  } catch (e) {
    // Check if Docker binary exists at all
    const hasBinary = await commandExists('docker');
    if (!hasBinary) {
      // Attempt auto-installation on Linux (mirrors 05-docker.sh)
      if (!IS_WINDOWS && !IS_MACOS && !ctx.dryRun) {
        ui.info('Docker not found — attempting automatic installation...');
        const installed = await autoInstallDocker();
        if (installed) {
          hasDocker = true;
          // Reset cached compose command — the first check cached a failure
          resetDockerCache();
          // After fresh install, group membership won't apply to the running
          // process, so we must use sudo for the remainder of this session.
          // The sudo password is still cached from the install step.
          try {
            const { getComposeCommand } = await import('../lib/docker.ts');
            const composeCmd = await getComposeCommand();
            hasDockerCompose = true;
            dockerRunning = true;
            ui.ok(`Docker installed and ready (${composeCmd.join(' ')})`);
          } catch {
            ui.warn('Docker installed but daemon not responding via compose detection');
            ui.info('This is expected on a fresh install — trying direct sudo access...');
            // Fallback: verify daemon is reachable via sudo (password cached from install)
            const directExit = await execStream(['sudo', 'docker', 'info'], { timeout: 10_000 });
            if (directExit === 0) {
              hasDockerCompose = true;
              dockerRunning = true;
              // Force sudo compose as the compose command for this session
              resetDockerCache();
              // Warm the cache — getComposeCommand will now find sudo docker works
              try {
                const { getComposeCommand } = await import('../lib/docker.ts');
                const composeCmd = await getComposeCommand();
                ui.ok(`Docker installed and ready (${composeCmd.join(' ')})`);
              } catch {
                ui.ok('Docker installed and daemon reachable via sudo');
              }
            } else {
              ui.warn('Docker installed but daemon not responding — may need a re-login');
              ui.info('Fix: sudo systemctl start docker && sudo usermod -aG docker $USER && newgrp docker');
            }
          }
        } else {
          ui.fail('Docker auto-installation failed');
          ui.info(getDockerInstallHint());
        }
      } else {
        ui.fail('Docker not found');
        ui.info(getDockerInstallHint());
      }
    } else {
      hasDocker = true;
      // Binary exists but daemon access failed — try to start it
      if (!IS_WINDOWS && !ctx.dryRun) {
        ui.info('Docker daemon not responding — attempting to start...');
        // Use execStream so sudo password prompt is visible to the user
        const startExit = await execStream(['sudo', 'systemctl', 'start', 'docker'], { timeout: 30_000 });
        if (startExit === 0) {
          // Daemon started, now re-check compose access
          resetDockerCache();
          try {
            const { getComposeCommand } = await import('../lib/docker.ts');
            const composeCmd = await getComposeCommand();
            hasDockerCompose = true;
            dockerRunning = true;
            ui.ok(`Docker daemon started (${composeCmd.join(' ')})`);
          } catch {
            // Daemon running but user can't access — try adding to group
            const user = process.env.SUDO_USER || process.env.USER || '';
            if (user) {
              await execStream(['sudo', 'usermod', '-aG', 'docker', user]);
            }
            // Use sudo for this session
            const directExit = await execStream(['sudo', 'docker', 'info'], { timeout: 10_000 });
            if (directExit === 0) {
              hasDockerCompose = true;
              dockerRunning = true;
              resetDockerCache();
              ui.ok('Docker daemon started (sudo docker compose)');
              ui.info('Run "newgrp docker" after install to use Docker without sudo');
            } else {
              ui.fail('Docker daemon started but access denied');
              ui.info('Fix: sudo usermod -aG docker $USER && newgrp docker');
            }
          }
        } else {
          ui.fail('Cannot connect to Docker daemon and failed to start it');
          console.log('');
          ui.info('Fix with one of:');
          for (const hint of getDockerDaemonFixHint()) {
            console.log(`     ${hint}`);
          }
        }
      } else {
        ui.fail('Cannot connect to Docker daemon');
        console.log('');
        ui.info('Fix with one of:');
        for (const hint of getDockerDaemonFixHint()) {
          console.log(`     ${hint}`);
        }
      }
    }
    if (!dockerRunning && !ctx.dryRun && !ctx.force) {
      console.log('');
      ui.fail('Docker access is required. Fix the issue above and re-run.');
      process.exit(1);
    }
  }

  // NVIDIA Container Toolkit — required for Docker GPU passthrough
  if (hasNvidiaSmi && hasDocker && !IS_MACOS && !IS_WINDOWS) {
    const hasNvidiaCTK = await commandExists('nvidia-ctk');
    if (!hasNvidiaCTK) {
      ui.warn('NVIDIA GPU detected but nvidia-container-toolkit is not installed');
      ui.info('Docker requires nvidia-container-toolkit to pass GPUs to containers');
      if (!ctx.dryRun) {
        const installed = await autoInstallNvidiaCTK();
        if (installed) {
          ui.ok('NVIDIA Container Toolkit installed');
        } else {
          ui.warn('Auto-install failed — GPU containers may not start');
          ui.info('Install manually: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html');
        }
      }
    } else {
      ui.ok('NVIDIA Container Toolkit ready');
    }
  }

  if (hasGit) ui.ok('git installed');
  else ui.warn('git not found — will attempt install');

  if (hasCurl) ui.ok('curl installed');
  else ui.warn('curl not found');

  // Tailscale detection
  let tailscaleIp: string | null = null;
  const hasTailscale = await commandExists('tailscale');
  if (hasTailscale) {
    try {
      const result = await exec(['tailscale', 'ip', '-4'], { throwOnError: false, timeout: 3000 });
      if (result.exitCode === 0 && result.stdout.trim()) {
        tailscaleIp = result.stdout.trim();
        ui.ok(`Tailscale detected (${tailscaleIp})`);
      }
    } catch { /* not connected */ }
    if (!tailscaleIp) {
      ui.info('Tailscale installed but not connected');
    }
  }

  return { os, distro, arch: process.arch, hasDocker, hasDockerCompose, hasGit, hasCurl, hasNvidiaSmi, dockerRunning, tailscaleIp };
}

/**
 * Attempt to install Docker Engine automatically on Linux.
 * Mirrors the bash installer's 05-docker.sh behavior.
 */
async function autoInstallDocker(): Promise<boolean> {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const tmpDir = mkdtempSync(join(tmpdir(), 'dream-docker-'));
  const tmpFile = join(tmpDir, 'install-docker.sh');

  try {
    // Download Docker's official install script (curl output is non-interactive, pipe is fine)
    const dl = await exec(
      ['curl', '-fsSL', 'https://get.docker.com', '-o', tmpFile],
      { throwOnError: false, timeout: 30_000 },
    );
    if (dl.exitCode !== 0) {
      ui.warn('Could not download Docker install script');
      return false;
    }

    // Run the install script with sudo — use execStream so the password prompt
    // and install progress are visible to the user in the terminal
    ui.step('Installing Docker Engine (this may take a minute)...');
    const installExit = await execStream(
      ['sudo', 'sh', tmpFile],
      { timeout: 300_000 },
    );

    if (installExit !== 0) {
      return false;
    }

    // Add current user to docker group
    const user = process.env.SUDO_USER || process.env.USER || '';
    if (user) {
      await execStream(['sudo', 'usermod', '-aG', 'docker', user]);
    }

    // Start and enable Docker daemon
    await execStream(['sudo', 'systemctl', 'start', 'docker'], { timeout: 15_000 });
    await execStream(['sudo', 'systemctl', 'enable', 'docker'], { timeout: 5_000 });

    ui.ok('Docker Engine installed');
    return true;
  } catch {
    return false;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * Attempt to install NVIDIA Container Toolkit on Linux.
 * Uses the official NVIDIA repository method.
 * See: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html
 */
async function autoInstallNvidiaCTK(): Promise<boolean> {
  try {
    ui.step('Installing NVIDIA Container Toolkit...');

    // Add NVIDIA Container Toolkit repository — use execStream for sudo prompts
    const addRepoExit = await execStream(
      ['sudo', 'sh', '-c',
        'curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg ' +
        '&& curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | ' +
        'sed "s#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g" | ' +
        'tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null'],
      { timeout: 30_000 },
    );

    if (addRepoExit !== 0) {
      ui.warn('Could not add NVIDIA Container Toolkit repository');
      return false;
    }

    // Install the toolkit
    const updateExit = await execStream(
      ['sudo', 'apt-get', 'update', '-qq'],
      { timeout: 60_000 },
    );
    if (updateExit !== 0) return false;

    const installPkgExit = await execStream(
      ['sudo', 'apt-get', 'install', '-y', '-qq', 'nvidia-container-toolkit'],
      { timeout: 120_000 },
    );
    if (installPkgExit !== 0) return false;

    // Configure Docker runtime
    await execStream(
      ['sudo', 'nvidia-ctk', 'runtime', 'configure', '--runtime=docker'],
      { timeout: 10_000 },
    );

    // Restart Docker to pick up the new runtime
    await execStream(
      ['sudo', 'systemctl', 'restart', 'docker'],
      { timeout: 15_000 },
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Detect and fix stale Docker Desktop context.
 *
 * When Docker Desktop is uninstalled (or was never properly removed), the user's
 * ~/.docker/config.json may still point to `desktop-linux` context, which uses a
 * socket at ~/.docker/desktop/docker.sock that no longer exists.  Meanwhile,
 * Docker Engine is running just fine on /var/run/docker.sock.
 *
 * If we detect this mismatch, reset the context to `default` so docker commands
 * use the standard /var/run/docker.sock path.
 */
async function fixStaleDockerContext(): Promise<void> {
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');

  const dockerConfigPath = join(homedir(), '.docker', 'config.json');
  if (!existsSync(dockerConfigPath)) return;

  try {
    const raw = readFileSync(dockerConfigPath, 'utf-8');
    const config = JSON.parse(raw);
    if (config.currentContext !== 'desktop-linux') return;

    // Check if the Desktop socket actually exists
    const desktopSocket = join(homedir(), '.docker', 'desktop', 'docker.sock');
    if (existsSync(desktopSocket)) return; // Docker Desktop is actually running

    // Desktop socket is missing but the standard socket exists — fix the context
    if (!existsSync('/var/run/docker.sock')) return;

    ui.warn('Stale Docker Desktop context detected — resetting to default');
    ui.info('Docker Desktop socket missing, using Docker Engine on /var/run/docker.sock');

    // Reset via docker context use, or edit the config file directly
    const contextResult = await exec(
      ['docker', 'context', 'use', 'default'],
      { throwOnError: false, timeout: 5_000, env: { ...process.env, DOCKER_HOST: 'unix:///var/run/docker.sock' } },
    );
    if (contextResult.exitCode === 0) {
      ui.ok('Docker context reset to default');
    } else {
      // Fallback: edit config.json directly
      config.currentContext = 'default';
      const { writeFileSync } = await import('node:fs');
      writeFileSync(dockerConfigPath, JSON.stringify(config, null, '\t') + '\n');
      ui.ok('Docker config updated to use default context');
    }
  } catch {
    // Non-critical — don't block the installer
  }
}
