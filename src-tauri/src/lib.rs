use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct SidecarChild(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Launch the feed-curator sidecar
            let sidecar = app
                .shell()
                .sidecar("feed-curator")
                .expect("failed to find feed-curator sidecar")
                .args(["serve", "--port", "3200"]);

            let (_rx, child) = sidecar.spawn().expect("failed to spawn sidecar");
            app.manage(SidecarChild(std::sync::Mutex::new(Some(child))));

            // Wait for server to start, then navigate and inject link handler
            let window = app.get_webview_window("main").unwrap();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                let _ = window.eval("window.location.replace('http://localhost:3200')");
                // Inject external link handler after page loads
                std::thread::sleep(std::time::Duration::from_secs(1));
                let _ = window.eval(r#"
                    document.addEventListener('click', function(e) {
                        var link = e.target.closest('a[href]');
                        if (!link) return;
                        var href = link.getAttribute('href');
                        if (href && !href.startsWith('/') && !href.startsWith('http://localhost')) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (window.__TAURI__) {
                                window.__TAURI__.opener.openUrl(href);
                            }
                        }
                    }, true);
                "#);
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<SidecarChild>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
