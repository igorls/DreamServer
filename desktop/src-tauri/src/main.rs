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
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
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
            // ── System tray ─────────────────────────────────────
            let show_i = MenuItem::with_id(app, "show", "Show DreamServer", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let stop_i = MenuItem::with_id(app, "stop_all", "Stop All Services", true, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &sep1, &stop_i, &sep2, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DreamServer — Running")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "stop_all" => {
                            // Fire-and-forget: stop all docker compose services
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let result = commands::stop_all_services().await;
                                if result.success {
                                    println!("[tray] All services stopped");
                                } else {
                                    eprintln!("[tray] Stop failed: {}", result.message);
                                }
                                // Update tooltip to reflect state
                                if let Some(tray) = app_handle.tray_by_id("main") {
                                    let _ = tray.set_tooltip(Some("DreamServer — Stopped"));
                                }
                            });
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on tray icon → show/focus window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Proxy sidecar ───────────────────────────────────
            // Strips X-Frame-Options for embedded tools.
            // Non-fatal: if the proxy fails to start, embedded tools won't work but the app
            // remains usable (chat, settings, etc. still function).
            match app.shell().sidecar("dreamserver-proxy") {
                Ok(sidecar) => {
                    match sidecar.spawn() {
                        Ok((mut rx, child)) => {
                            app.manage(ProxyChild(Mutex::new(Some(child))));

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
            commands::get_env_config,
            commands::detect_existing_install,
            commands::stop_all_services,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Run with event handler for close-to-tray + exit cleanup
    app.run(|app_handle, event| {
        match event {
            // Close button → hide window instead of quitting
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window(&label) {
                    let _ = window.hide();
                }
            }
            // True exit → kill sidecar
            tauri::RunEvent::Exit => {
                if let Some(proxy) = app_handle.try_state::<ProxyChild>() {
                    proxy.kill();
                }
            }
            _ => {}
        }
    });
}
