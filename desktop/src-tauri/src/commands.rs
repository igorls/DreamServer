use crate::{docker, gpu, installer, platform};
use crate::state::{GpuInfo, InstallPhase, InstallState};
use serde::Serialize;
use std::sync::Mutex;

// ---- System Check ----

#[derive(Serialize)]
pub struct SystemCheckResult {
    pub system: platform::SystemInfo,
    pub requirements: Vec<platform::RequirementCheck>,
    pub docker: docker::DockerStatus,
}

#[tauri::command]
pub fn check_system() -> SystemCheckResult {
    let system = platform::check_system();
    let requirements = platform::check_requirements(&system);
    let docker = docker::check();

    SystemCheckResult { system, requirements, docker }
}

// ---- Prerequisites ----

#[derive(Serialize)]
pub struct PrerequisiteStatus {
    pub git_installed: bool,
    pub docker_installed: bool,
    pub docker_running: bool,
    pub wsl2_needed: bool,
    pub wsl2_installed: bool,
    pub all_met: bool,
}

#[tauri::command]
pub fn check_prerequisites() -> PrerequisiteStatus {
    let git = which::which("git").is_ok();
    let docker_status = docker::check();
    let wsl2_needed = cfg!(target_os = "windows");
    let wsl2_installed = if wsl2_needed {
        std::process::Command::new("wsl")
            .args(["--status"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        true
    };

    let all_met = git
        && docker_status.installed
        && docker_status.running
        && docker_status.compose_installed
        && (!wsl2_needed || wsl2_installed);

    PrerequisiteStatus {
        git_installed: git,
        docker_installed: docker_status.installed,
        docker_running: docker_status.running,
        wsl2_needed,
        wsl2_installed,
        all_met,
    }
}

// ---- Install Prerequisites ----

#[derive(Serialize)]
pub struct InstallPrereqResult {
    pub success: bool,
    pub message: String,
    pub reboot_required: bool,
}

#[tauri::command]
pub async fn install_prerequisites(component: String) -> InstallPrereqResult {
    match component.as_str() {
        "docker" => match docker::install_docker().await {
            Ok(msg) => InstallPrereqResult {
                success: true,
                message: msg,
                reboot_required: false,
            },
            Err(msg) => InstallPrereqResult {
                success: false,
                message: msg,
                reboot_required: false,
            },
        },
        #[cfg(target_os = "windows")]
        "wsl2" => match crate::platform::windows::install_wsl2() {
            Ok(needs_reboot) => InstallPrereqResult {
                success: true,
                message: if needs_reboot {
                    "WSL2 installed. A restart is required to complete setup.".into()
                } else {
                    "WSL2 is ready.".into()
                },
                reboot_required: needs_reboot,
            },
            Err(msg) => InstallPrereqResult {
                success: false,
                message: msg,
                reboot_required: false,
            },
        },
        _ => InstallPrereqResult {
            success: false,
            message: format!("Unknown component: {}", component),
            reboot_required: false,
        },
    }
}

// ---- GPU Detection ----

#[derive(Serialize)]
pub struct GpuResult {
    pub gpu: GpuInfo,
    pub recommended_tier: u8,
    pub tier_description: String,
}

#[tauri::command]
pub fn detect_gpu() -> GpuResult {
    let gpu = gpu::detect();
    let tier = gpu::recommend_tier(&gpu);
    let desc = tier_description(tier);

    GpuResult {
        gpu,
        recommended_tier: tier,
        tier_description: desc,
    }
}

fn tier_description(tier: u8) -> String {
    match tier {
        0 => "Cloud Mode — No local GPU detected. Uses cloud AI providers.".into(),
        1 => "Tier 1 — Qwen3-8B (8GB VRAM). Great for chat, code help, and general tasks.".into(),
        2 => "Tier 2 — Qwen3-14B (12GB+ VRAM). Stronger reasoning and longer context.".into(),
        3 => "Tier 3 — Qwen3-32B (24GB+ VRAM). Professional-grade for complex tasks.".into(),
        4 => "Tier 4 — Qwen3-72B (48GB+ VRAM). Enterprise-level, best quality.".into(),
        _ => "Unknown tier".into(),
    }
}

// ---- Installation ----

#[tauri::command]
pub async fn start_install(
    tier: u8,
    features: Vec<String>,
    install_dir: Option<String>,
) -> Result<String, String> {
    let dir = install_dir
        .map(std::path::PathBuf::from)
        .unwrap_or_else(installer::default_install_dir);

    let state = std::sync::Arc::new(Mutex::new(InstallState {
        phase: InstallPhase::Installing,
        install_dir: Some(dir.to_string_lossy().to_string()),
        selected_tier: Some(tier),
        selected_features: features.clone(),
        ..Default::default()
    }));

    let state_clone = state.clone();

    // Run installation in a blocking thread
    tokio::task::spawn_blocking(move || {
        installer::run_install(state_clone, dir, tier, features)
    })
    .await
    .map_err(|e| format!("Install task failed: {}", e))?
    .map(|_| "Installation complete!".to_string())
}

// ---- Progress ----

#[tauri::command]
pub fn get_install_progress() -> ProgressInfo {
    let state_path = state_file_path();
    if let Ok(data) = std::fs::read_to_string(&state_path) {
        if let Ok(state) = serde_json::from_str::<InstallState>(&data) {
            return ProgressInfo {
                phase: format!("{:?}", state.phase),
                percent: state.progress_pct,
                message: state.progress_message,
                error: state.error,
            };
        }
    }

    ProgressInfo {
        phase: "unknown".into(),
        percent: 0,
        message: "Waiting for installer...".into(),
        error: None,
    }
}

#[derive(Serialize)]
pub struct ProgressInfo {
    pub phase: String,
    pub percent: u8,
    pub message: String,
    pub error: Option<String>,
}

// ---- State ----

#[tauri::command]
pub fn get_install_state() -> InstallState {
    let state_path = state_file_path();
    if let Ok(data) = std::fs::read_to_string(&state_path) {
        if let Ok(state) = serde_json::from_str::<InstallState>(&data) {
            return state;
        }
    }
    InstallState::default()
}

// ---- Configuration ----

#[derive(Serialize)]
pub struct EnvConfig {
    pub ollama_port: u16,
    pub whisper_port: u16,
    pub llm_backend: String,
    pub llm_api_url: String,
}

#[tauri::command]
pub fn get_env_config() -> EnvConfig {
    let mut config = EnvConfig {
        ollama_port: 11434,
        whisper_port: 9000,
        llm_backend: "llamacpp".to_string(),
        llm_api_url: "http://localhost:8080/v1".to_string(),
    };

    if let Some(p) = find_dream_server_dir() {
        let env_file = p.join(".env");
        if env_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&env_file) {
                for line in content.lines() {
                    let text = line.trim();
                    if text.starts_with('#') || text.is_empty() {
                        continue;
                    }
                    if let Some((key, val)) = text.split_once('=') {
                        let k = key.trim();
                        let v = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        match k {
                            "OLLAMA_PORT" => { if let Ok(n) = v.parse() { config.ollama_port = n; } },
                            "WHISPER_PORT" => { if let Ok(n) = v.parse() { config.whisper_port = n; } },
                            "LLM_BACKEND" => config.llm_backend = v,
                            "LLM_API_URL" => config.llm_api_url = v,
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    config
}

// ---- Open DreamServer ----

#[tauri::command]
pub fn open_dreamserver() -> Result<(), String> {
    let url = "http://localhost:3000";
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    Ok(())
}

// ---- Docker Compose Service Management ----

#[derive(Serialize)]
pub struct DockerComposeResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

/// Run a docker compose action on a DreamServer catalog service ONLY.
/// Security: Strict whitelist — only known DreamServer services are allowed.
/// Actions: "up" (start), "stop", "restart", "ps" (status), "logs"
use tauri::{Emitter, Window};

#[tauri::command]
pub async fn docker_compose_action(
    window: Window,
    action: String,
    service: String,
) -> Result<DockerComposeResult, String> {
    // ── Security: Strict service whitelist ──────────────────
    // ONLY DreamServer catalog services are allowed.
    // This prevents the AI from touching any other containers on the host.
    const ALLOWED_SERVICES: &[&str] = &[
        // Core services (docker-compose.base.yml)
        "llama-server",
        "open-webui",
        "dashboard-api",
        "dashboard",
        // Extension services (extensions/services/*/compose.yaml)
        "tts",          // Kokoro TTS
        "whisper",      // Speech-to-text
        "comfyui",      // Image generation
        "n8n",          // Workflow automation
        "searxng",      // Web search
        "embeddings",   // Embedding models
        "qdrant",       // Vector database
        "perplexica",   // AI search
        "litellm",      // LLM proxy
        "langfuse",     // Observability
        "token-spy",      // Token usage
        "openclaw",       // OpenClaw
        "privacy-shield", // Privacy filtering
        "gitea",          // Code versioning
        "localai",        // LocalAI endpoint
    ];

    const ALLOWED_ACTIONS: &[&str] = &["up", "stop", "restart", "ps", "logs", "pull"];

    if !ALLOWED_SERVICES.contains(&service.as_str()) {
        return Ok(DockerComposeResult {
            success: false,
            output: String::new(),
            error: Some(format!(
                "Service '{}' is not in the DreamServer catalog. Allowed services: {}",
                service,
                ALLOWED_SERVICES.join(", ")
            )),
        });
    }
    
    if !ALLOWED_ACTIONS.contains(&action.as_str()) {
        return Ok(DockerComposeResult {
            success: false,
            output: String::new(),
            error: Some(format!(
                "Invalid action: {}. Allowed actions: {}",
                action,
                ALLOWED_ACTIONS.join(", ")
            )),
        });
    }

    // Find the dream-server directory relative to the install location
    let dream_dir = find_dream_server_dir();
    
    let dream_path = match dream_dir {
        Some(p) => p,
        None => return Ok(DockerComposeResult {
            success: false,
            output: String::new(),
            error: Some("Could not find dream-server directory. Is DreamServer installed?".into()),
        }),
    };

    // Detect GPU type for the overlay file
    let gpu = gpu::detect();
    let gpu_overlay = match gpu.vendor {
        crate::state::GpuVendor::Nvidia => "docker-compose.nvidia.yml",
        crate::state::GpuVendor::Amd => "docker-compose.amd.yml",
        crate::state::GpuVendor::Intel => "docker-compose.intel.yml",
        crate::state::GpuVendor::Apple => "docker-compose.apple.yml",
        crate::state::GpuVendor::None => "docker-compose.cpu.yml",
    };

    // Build compose file args
    let base_file = dream_path.join("docker-compose.base.yml");
    let overlay_file = dream_path.join(gpu_overlay);
    
    // Check for extension service compose file
    let ext_file = dream_path
        .join("extensions/services")
        .join(&service)
        .join("compose.yaml");

    let mut args = vec![
        "compose".to_string(),
        "-f".to_string(),
        base_file.to_string_lossy().to_string(),
    ];

    // Add GPU overlay if it exists
    if overlay_file.exists() {
        args.push("-f".to_string());
        args.push(overlay_file.to_string_lossy().to_string());
    }

    // Add extension file if it exists
    if ext_file.exists() {
        args.push("-f".to_string());
        args.push(ext_file.to_string_lossy().to_string());
    }

    // Add GPU-specific extension overlay (e.g., compose.nvidia.yaml for comfyui)
    let ext_gpu_overlay = dream_path
        .join("extensions/services")
        .join(&service)
        .join(format!("compose.{}.yaml", gpu_overlay
            .replace("docker-compose.", "")
            .replace(".yml", "")));
    if ext_gpu_overlay.exists() {
        args.push("-f".to_string());
        args.push(ext_gpu_overlay.to_string_lossy().to_string());
    }

    // Add the action
    match action.as_str() {
        "up" => {
            args.push("up".to_string());
            args.push("-d".to_string());
            args.push(service.clone());
        }
        "stop" => {
            args.push("stop".to_string());
            args.push(service.clone());
        }
        "restart" => {
            args.push("restart".to_string());
            args.push(service.clone());
        }
        "ps" => {
            args.push("ps".to_string());
            args.push("--format".to_string());
            args.push("json".to_string());
        }
        "logs" => {
            args.push("logs".to_string());
            args.push("--tail".to_string());
            args.push("50".to_string());
            args.push(service.clone());
        }
        "pull" => {
            args.push("pull".to_string());
            args.push(service.clone());
        }
        _ => return Ok(DockerComposeResult {
            success: false,
            output: String::new(),
            error: Some(format!("Unknown action: {}", action)),
        }),
    }

    let window_clone = window.clone();
    let service_clone = service.clone();
    
    // Run the command
    let result = tokio::task::spawn_blocking(move || {
        let mut child = match std::process::Command::new("docker")
            .args(&args)
            .current_dir(&dream_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => return Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())),
        };

        let stdout = child.stdout.take().expect("Failed to open stdout");
        let stderr = child.stderr.take().expect("Failed to open stderr");

        let w1 = window_clone.clone();
        let s1 = service_clone.clone();
        let t1 = std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            let mut out = String::new();
            for line in reader.lines() {
                if let Ok(l) = line {
                    println!("[DOCKER STDOUT] [{}] {}", s1, l);
                    let payload = serde_json::json!({ "service": &s1, "line": l, "type": "stdout" });
                    let _ = w1.emit("docker-log", payload);
                    out.push_str(&l);
                    out.push('\n');
                }
            }
            out
        });

        let w2 = window_clone;
        let s2 = service_clone;
        let t2 = std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            let mut out = String::new();
            for line in reader.lines() {
                if let Ok(l) = line {
                    eprintln!("[DOCKER STDERR] [{}] {}", s2, l);
                    let payload = serde_json::json!({ "service": &s2, "line": l, "type": "stderr" });
                    let _ = w2.emit("docker-log", payload);
                    out.push_str(&l);
                    out.push('\n');
                }
            }
            out
        });

        let status = match child.wait() {
            Ok(s) => s,
            Err(e) => return Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())),
        };

        let captured_stdout = t1.join().unwrap_or_default();
        let captured_stderr = t2.join().unwrap_or_default();

        Ok::<(std::process::ExitStatus, String, String), std::io::Error>((status, captured_stdout, captured_stderr))
    }).await;

    match result {
        Ok(Ok((status, stdout, stderr))) => {
            Ok(DockerComposeResult {
                success: status.success(),
                output: if stdout.is_empty() { stderr.clone() } else { stdout },
                error: if status.success() { None } else { Some(stderr) },
            })
        }
        Ok(Err(e)) => Ok(DockerComposeResult {
            success: false,
            output: String::new(),
            error: Some(format!("Failed to execute docker compose: {}", e)),
        }),
        Err(e) => Ok(DockerComposeResult {
            success: false,
            output: String::new(),
            error: Some(format!("Task join error: {}", e)),
        }),
    }
}

/// Find the dream-server directory.
/// Checks the persisted installer state first, then well-known CLI installer paths.
pub fn find_dream_server_dir() -> Option<std::path::PathBuf> {
    // Priority 1: saved install state from the desktop installer
    let state_path = state_file_path();
    if let Ok(data) = std::fs::read_to_string(&state_path) {
        if let Ok(state) = serde_json::from_str::<InstallState>(&data) {
            if let Some(dir) = state.install_dir {
                let p = std::path::PathBuf::from(dir);
                if p.join("docker-compose.base.yml").exists() {
                    return Some(p);
                }
            }
        }
    }

    // Priority 2: well-known CLI installer locations
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Public".into());
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let home_path = std::path::PathBuf::from(&home);

    let candidates = vec![
        // CLI installer default: ~/DreamServer/dream-server
        home_path.join("DreamServer/dream-server"),
        // Flat: ~/dream-server
        home_path.join("dream-server"),
        // Hidden: ~/.dream-server
        home_path.join(".dream-server"),
    ];

    for candidate in candidates {
        if candidate.join("docker-compose.base.yml").exists() {
            return Some(candidate);
        }
    }
    None
}

// ---- Helpers ----

fn state_file_path() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\ProgramData".into());
        std::path::PathBuf::from(base)
            .join("dreamserver")
            .join("installer-state.json")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        std::path::PathBuf::from(home)
            .join("Library/Application Support/dreamserver/installer-state.json")
    }
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            format!("{}/.local/share", home)
        });
        std::path::PathBuf::from(base)
            .join("dreamserver")
            .join("installer-state.json")
    }
}

// ---- Service Catalog ----

#[derive(Serialize)]
pub struct CatalogFeature {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub vram_gb: Option<u32>,
    pub setup_time: Option<String>,
}

#[derive(Serialize)]
pub struct CatalogService {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: Option<String>,
    pub depends_on: Vec<String>,
    pub gpu_backends: Vec<String>,
    pub port: u16,
    pub external_port: u16,
    pub health_endpoint: String,
    pub has_compose: bool,
    pub features: Vec<CatalogFeature>,
}

#[derive(Serialize)]
pub struct CatalogResult {
    pub services: Vec<CatalogService>,
    pub dream_server_found: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn list_service_catalog() -> CatalogResult {
    let dream_dir = find_dream_server_dir();

    let dream_path = match dream_dir {
        Some(p) => p,
        None => {
            return CatalogResult {
                services: vec![],
                dream_server_found: false,
                error: Some(
                    "Could not find dream-server directory. Is DreamServer installed?".into(),
                ),
            }
        }
    };

    let extensions_dir = dream_path.join("extensions/services");
    if !extensions_dir.exists() {
        return CatalogResult {
            services: vec![],
            dream_server_found: true,
            error: Some("Extensions directory not found.".into()),
        };
    }

    let mut services = Vec::new();

    let entries = match std::fs::read_dir(&extensions_dir) {
        Ok(e) => e,
        Err(e) => {
            return CatalogResult {
                services: vec![],
                dream_server_found: true,
                error: Some(format!("Failed to read extensions directory: {}", e)),
            }
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.yaml");
        if !manifest_path.exists() {
            continue;
        }

        let manifest_str = match std::fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let yaml: serde_yaml::Value = match serde_yaml::from_str(&manifest_str) {
            Ok(v) => v,
            Err(e) => {
                eprintln!(
                    "[catalog] Failed to parse {}: {}",
                    manifest_path.display(),
                    e
                );
                continue;
            }
        };

        let svc = match yaml.get("service") {
            Some(s) => s,
            None => continue,
        };

        let id = svc
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let name = svc
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&id)
            .to_string();
        let category = svc
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("optional")
            .to_string();
        let description = svc.get("description").and_then(|v| v.as_str()).map(|s| s.trim().to_string());
        let port = svc
            .get("port")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u16;
        let external_port = svc
            .get("external_port_default")
            .and_then(|v| v.as_u64())
            .unwrap_or(port as u64) as u16;
        let health = svc
            .get("health")
            .and_then(|v| v.as_str())
            .unwrap_or("/")
            .to_string();

        let depends_on: Vec<String> = svc
            .get("depends_on")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let gpu_backends: Vec<String> = svc
            .get("gpu_backends")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        // Check if compose.yaml exists (service can be started)
        let compose_path = path.join("compose.yaml");
        let has_compose = compose_path.exists();

        // Parse features
        let mut features = Vec::new();
        if let Some(feats) = yaml.get("features").and_then(|v| v.as_sequence()) {
            for feat in feats {
                let feat_id = feat
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let feat_name = feat
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let feat_desc = feat
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let feat_cat = feat
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let vram_gb = feat
                    .get("requirements")
                    .and_then(|r| r.get("vram_gb"))
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32);
                let setup_time = feat
                    .get("setup_time")
                    .and_then(|v| v.as_str())
                    .map(String::from);

                features.push(CatalogFeature {
                    id: feat_id,
                    name: feat_name,
                    description: feat_desc,
                    category: feat_cat,
                    vram_gb,
                    setup_time,
                });
            }
        }

        if id.is_empty() {
            continue;
        }

        services.push(CatalogService {
            id,
            name,
            category,
            description,
            depends_on,
            gpu_backends,
            port,
            external_port,
            health_endpoint: health,
            has_compose,
            features,
        });
    }

    // Sort: recommended first, then alphabetically
    services.sort_by(|a, b| {
        let cat_order = |c: &str| if c == "recommended" { 0 } else { 1 };
        cat_order(&a.category)
            .cmp(&cat_order(&b.category))
            .then(a.name.cmp(&b.name))
    });

    CatalogResult {
        services,
        dream_server_found: true,
        error: None,
    }
}

// ---- Existing install detection ----

#[derive(Serialize)]
pub struct ExistingInstall {
    pub found: bool,
    pub path: Option<String>,
    pub has_env: bool,
    pub services_running: bool,
}

#[tauri::command]
pub fn detect_existing_install() -> ExistingInstall {
    match find_dream_server_dir() {
        Some(dir) => {
            let has_env = dir.join(".env").exists();
            let services_running = if has_env {
                // Quick check: is docker compose reporting any running containers?
                std::process::Command::new("docker")
                    .args(["compose", "-f", "docker-compose.base.yml", "ps", "-q"])
                    .current_dir(&dir)
                    .output()
                    .map(|o| o.status.success() && !o.stdout.is_empty())
                    .unwrap_or(false)
            } else {
                false
            };
            ExistingInstall {
                found: true,
                path: Some(dir.to_string_lossy().to_string()),
                has_env,
                services_running,
            }
        }
        None => ExistingInstall {
            found: false,
            path: None,
            has_env: false,
            services_running: false,
        },
    }
}

// ---- Stop all services ----

#[derive(Serialize)]
pub struct StopAllResult {
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub async fn stop_all_services() -> StopAllResult {
    let dir = match find_dream_server_dir() {
        Some(d) => d,
        None => {
            return StopAllResult {
                success: false,
                message: "DreamServer directory not found.".into(),
            };
        }
    };

    let result = tokio::task::spawn_blocking(move || {
        let gpu = gpu::detect();
        let gpu_overlay = match gpu.vendor {
            crate::state::GpuVendor::Nvidia => "docker-compose.nvidia.yml",
            crate::state::GpuVendor::Amd => "docker-compose.amd.yml",
            crate::state::GpuVendor::Intel => "docker-compose.intel.yml",
            crate::state::GpuVendor::Apple => "docker-compose.apple.yml",
            crate::state::GpuVendor::None => "docker-compose.cpu.yml",
        };

        std::process::Command::new("docker")
            .args(["compose", "-f", "docker-compose.base.yml", "-f", gpu_overlay, "down"])
            .current_dir(&dir)
            .output()
    })
    .await;

    match result {
        Ok(Ok(output)) => {
            if output.status.success() {
                StopAllResult {
                    success: true,
                    message: "All services stopped.".into(),
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                StopAllResult {
                    success: false,
                    message: format!("docker compose down failed: {}", stderr),
                }
            }
        }
        Ok(Err(e)) => StopAllResult {
            success: false,
            message: format!("Failed to run docker compose: {}", e),
        },
        Err(e) => StopAllResult {
            success: false,
            message: format!("Task error: {}", e),
        },
    }
}
