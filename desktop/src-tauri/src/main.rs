// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod docker;
mod gpu;
mod installer;
mod platform;
mod state;

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

/// Holds the proxy sidecar child process handle
#[allow(dead_code)]
struct ProxyChild(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

impl ProxyChild {
    fn kill(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
                println!("[proxy] Sidecar process killed");
            }
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // Spawn the embed proxy sidecar — strips X-Frame-Options for embedded tools.
            // Non-fatal: if the proxy fails to start, embedded tools won't work but the app
            // remains usable (chat, settings, etc. still function).
            match app.shell().sidecar("dreamserver-proxy") {
                Ok(sidecar) => {
                    match sidecar.spawn() {
                        Ok((mut rx, child)) => {
                            app.manage(ProxyChild(Mutex::new(Some(child))));

                            // Log proxy output in a background thread
                            tauri::async_runtime::spawn(async move {
                                use tauri_plugin_shell::process::CommandEvent;
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(line) => {
                                            let line = String::from_utf8_lossy(&line);
                                            println!("[PROXY] {}", line.trim());
                                        }
                                        CommandEvent::Stderr(line) => {
                                            let line = String::from_utf8_lossy(&line);
                                            eprintln!("[PROXY ERR] {}", line.trim());
                                        }
                                        CommandEvent::Terminated(status) => {
                                            eprintln!("[PROXY] Process terminated: {:?}", status);
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            });

                            println!("[proxy] Sidecar launched successfully");
                        }
                        Err(e) => {
                            eprintln!("[proxy] WARNING: Failed to spawn sidecar: {}. Embedded tools may not work.", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[proxy] WARNING: Failed to create sidecar command: {}. Embedded tools may not work.", e);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_system,
            commands::check_prerequisites,
            commands::install_prerequisites,
            commands::detect_gpu,
            commands::start_install,
            commands::get_install_progress,
            commands::get_install_state,
            commands::open_dreamserver,
            commands::docker_compose_action,
            commands::list_service_catalog,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Run with explicit exit handler to kill the sidecar
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(proxy) = app_handle.try_state::<ProxyChild>() {
                proxy.kill();
            }
        }
    });
}
