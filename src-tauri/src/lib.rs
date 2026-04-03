use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_window_state::AppHandleExt;
use std::process::Command;

struct SidecarChild(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

/// Common paths where Claude Code CLI might be installed
fn claude_paths() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![
        "claude".to_string(),
        format!("{}/.local/bin/claude", home),
        format!("{}/.claude/bin/claude", home),
        "/usr/local/bin/claude".to_string(),
        "/opt/homebrew/bin/claude".to_string(),
    ]
}

/// Check if Claude Code CLI is installed and return (path, version) or empty
fn detect_claude() -> (String, String) {
    for path in claude_paths() {
        if let Some(version) = Command::new(&path)
            .arg("--version")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
        {
            if !version.is_empty() {
                return (path, version);
            }
        }
    }
    (String::new(), String::new())
}

fn is_japanese() -> bool {
    for key in &["LANG", "LC_ALL", "LC_MESSAGES"] {
        if let Ok(val) = std::env::var(key) {
            if val.starts_with("ja") { return true; }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("defaults").args(["read", "-g", "AppleLanguages"]).output() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                if text.contains("ja") { return true; }
            }
        }
    }
    false
}

#[tauri::command]
fn check_claude_status() -> serde_json::Value {
    let (path, version) = detect_claude();
    serde_json::json!({
        "installed": !version.is_empty(),
        "version": version,
        "path": path,
    })
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    tauri::process::restart(&app.env());
}

#[tauri::command]
async fn install_claude(app: tauri::AppHandle) -> Result<String, String> {
    use std::io::{BufRead, BufReader};

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new("/bin/bash")
            .args(["-c", "curl -fsSL https://claude.ai/install.sh | bash 2>&1"])
            .stdout(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;

        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        let mut full_output = String::new();

        for line in reader.lines() {
            if let Ok(line) = line {
                full_output.push_str(&line);
                full_output.push('\n');
                let _ = app.emit("install-progress", &line);
            }
        }

        let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;
        if status.success() {
            Ok(full_output.trim().to_string())
        } else {
            Err(format!("Install failed:\n{}", full_output))
        }
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))?;

    result
}

#[tauri::command]
async fn login_claude() -> Result<String, String> {
    let (claude_path, _) = detect_claude();
    if claude_path.is_empty() {
        return Err("Claude Code not found. Install it first.".to_string());
    }

    // Run in a blocking thread so the UI stays responsive
    let result = tauri::async_runtime::spawn_blocking(move || {
        Command::new(&claude_path)
            .args(["auth", "login", "--claudeai"])
            .output()
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))?
    .map_err(|e| format!("Failed to run login: {}", e))?;

    let stdout = String::from_utf8_lossy(&result.stdout).to_string();
    let stderr = String::from_utf8_lossy(&result.stderr).to_string();

    if result.status.success() {
        Ok(format!("{}\n{}", stdout, stderr).trim().to_string())
    } else {
        Err(format!("Login failed:\n{}\n{}", stdout, stderr))
    }
}

#[tauri::command]
fn copy_command_to_clipboard(app: tauri::AppHandle, command: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        let mut child = Command::new("/usr/bin/pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("pbcopy failed: {}", e))?;
        if let Some(ref mut stdin) = child.stdin {
            stdin.write_all(command.as_bytes()).map_err(|e| e.to_string())?;
        }
        child.wait().map_err(|e| e.to_string())?;
    }
    let _ = app;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![check_claude_status, copy_command_to_clipboard, install_claude, login_claude, restart_app])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let (claude_path, claude_version) = if std::env::var("FORCE_SETUP").is_ok() {
                (String::new(), String::new())
            } else {
                detect_claude()
            };
            let claude_installed = !claude_version.is_empty();
            let ja = is_japanese();

            let window = app.get_webview_window("main").unwrap();

            // Inject state into the frontend page (loaded from frontend/index.html by Tauri)
            let state_js = format!(
                "window._feedCuratorState = {{ installed: {}, version: '{}', ja: {} }};",
                claude_installed, claude_version.replace('\'', "\\'"), ja
            );
            let w = window.clone();
            let app_handle = app.handle().clone();

            if claude_installed {
                // Set PATH in the current process so sidecar inherits it
                let claude_dir = std::path::Path::new(&claude_path)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                if !claude_dir.is_empty() {
                    let current_path = std::env::var("PATH").unwrap_or_default();
                    std::env::set_var("PATH", format!("{}:{}", claude_dir, current_path));
                }

                let sidecar = app
                    .shell()
                    .sidecar("feed-curator")
                    .expect("failed to find feed-curator sidecar")
                    .args(["serve", "--port", "3200"]);

                let (_rx, child) = sidecar.spawn().expect("failed to spawn sidecar");
                app.manage(SidecarChild(std::sync::Mutex::new(Some(child))));

                std::thread::spawn(move || {
                    // Inject state first
                    let _ = w.eval(&state_js);
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = w.eval("if (typeof initPage === 'function') initPage();");
                    // Wait for server to start, then navigate
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let _ = w.eval("window.location.replace('http://localhost:3200')");
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let _ = w.eval(r#"
                        document.addEventListener('click', function(e) {
                            var link = e.target.closest('a[href]');
                            if (!link) return;
                            var href = link.getAttribute('href');
                            if (href && !href.startsWith('/') && !href.startsWith('http://localhost')) {
                                e.preventDefault();
                                e.stopPropagation();
                                if (window.__TAURI__ && window.__TAURI__.opener) {
                                    window.__TAURI__.opener.openUrl(href);
                                } else {
                                    // Fallback: use fetch to a local endpoint that opens the URL
                                    fetch('/api/open-url', {
                                        method: 'POST',
                                        headers: {'Content-Type': 'application/json'},
                                        body: JSON.stringify({url: href})
                                    }).catch(function() {
                                        window.open(href, '_blank');
                                    });
                                }
                            }
                        }, true);
                    "#);
                });
            } else {
                // Claude not installed — show setup screen (frontend/index.html with state injection)
                app.manage(SidecarChild(std::sync::Mutex::new(None)));
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    let _ = w.eval(&state_js);
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = w.eval("if (typeof initPage === 'function') initPage();");
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                tauri::RunEvent::ExitRequested { .. } => {
                    app.save_window_state(tauri_plugin_window_state::StateFlags::all()).ok();
                    if let Some(state) = app.try_state::<SidecarChild>() {
                        if let Ok(mut guard) = state.0.lock() {
                            if let Some(child) = guard.take() {
                                let _ = child.kill();
                            }
                        }
                    }
                }
                tauri::RunEvent::Exit => {
                    if let Some(state) = app.try_state::<SidecarChild>() {
                        if let Ok(mut guard) = state.0.lock() {
                            if let Some(child) = guard.take() {
                                let _ = child.kill();
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}
