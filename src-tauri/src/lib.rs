use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct SidecarChild(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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

            // Store child handle for cleanup on exit
            app.manage(SidecarChild(std::sync::Mutex::new(Some(child))));

            // Wait briefly for server to start, then navigate to it
            let window = app.get_webview_window("main").unwrap();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                let _ = window.eval("window.location.replace('http://localhost:3200')");
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
