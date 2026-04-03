use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_window_state::AppHandleExt;
use std::process::Command;

struct SidecarChild(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

/// Check if Claude Code CLI is installed and return version or empty string
fn detect_claude() -> String {
    Command::new("claude")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn check_claude_status() -> serde_json::Value {
    let version = detect_claude();
    serde_json::json!({
        "installed": !version.is_empty(),
        "version": version,
    })
}

/// Instead of opening a terminal, copy the command to clipboard
/// and show instructions. More reliable across sandbox environments.
#[tauri::command]
fn copy_command_to_clipboard(app: tauri::AppHandle, command: String) -> Result<(), String> {
    // Write to clipboard via pbcopy (macOS) or equivalent
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
    let _ = app; // suppress unused warning on other platforms
    Ok(())
}

fn is_japanese() -> bool {
    for key in &["LANG", "LC_ALL", "LC_MESSAGES"] {
        if let Ok(val) = std::env::var(key) {
            if val.starts_with("ja") { return true; }
        }
    }
    false
}

fn setup_html(claude_version: &str) -> String {
    let installed = !claude_version.is_empty();
    let ja = is_japanese();
    format!(r#"<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Feed Curator</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         display: flex; align-items: center; justify-content: center;
         height: 100vh; background: #faf9fb; color: #333; }}
  .setup {{ text-align: center; max-width: 480px; padding: 40px; }}
  .logo {{ font-size: 48px; margin-bottom: 16px; }}
  h1 {{ font-size: 24px; margin-bottom: 8px; color: #1a1a2e; }}
  p {{ color: #666; margin-bottom: 24px; line-height: 1.6; }}
  .status {{ display: inline-flex; align-items: center; gap: 8px;
             padding: 8px 16px; border-radius: 8px; margin-bottom: 24px;
             font-size: 14px; }}
  .status.ok {{ background: #d4edda; color: #155724; }}
  .status.missing {{ background: #f8d7da; color: #721c24; }}
  .btn {{ display: inline-block; padding: 12px 24px; border-radius: 8px;
          border: none; font-size: 16px; cursor: pointer;
          font-weight: 600; margin: 4px; }}
  .btn-primary {{ background: #7c3aed; color: white; }}
  .btn-primary:hover {{ background: #6d28d9; }}
  .btn-secondary {{ background: #e5e7eb; color: #374151; }}
  .btn-secondary:hover {{ background: #d1d5db; }}
  .cmd {{ background: #1a1a2e; color: #a5b4fc; padding: 12px 16px;
          border-radius: 8px; font-family: monospace; font-size: 13px;
          margin: 16px 0; text-align: left; }}
  .spinner {{ display: none; margin: 16px auto; }}
  .steps {{ text-align: left; margin: 16px 0; }}
  .steps li {{ margin: 8px 0; color: #555; }}
  .steps li.done {{ color: #155724; }}
</style>
</head>
<body>
<div class="setup" id="setup">
  <div class="logo">📰</div>
  <h1>Feed Curator</h1>
  {}
</div>
<script>
  async function checkClaude() {{
    try {{
      const result = await window.__TAURI__.core.invoke('check_claude_status');
      return result;
    }} catch {{ return {{ installed: false, version: '' }}; }}
  }}

  var _ja = {ja};
  async function copyCmd(cmd, statusId) {{
    var status = document.getElementById(statusId);
    var okMsg = _ja ? 'コピーしました！ターミナルに貼り付けて実行してください。' : 'Copied! Paste in Terminal and run.';
    var errMsg = _ja ? 'コピーに失敗しました。手動でコピーしてください。' : 'Copy failed. Please copy manually.';
    try {{
      await window.__TAURI__.core.invoke('copy_command_to_clipboard', {{ command: cmd }});
      status.textContent = okMsg;
      status.style.color = '#155724';
    }} catch(e) {{
      try {{
        await navigator.clipboard.writeText(cmd);
        status.textContent = okMsg;
        status.style.color = '#155724';
      }} catch(e2) {{
        status.textContent = errMsg;
        status.style.color = '#721c24';
      }}
    }}
  }}

  async function installClaude() {{
    await copyCmd('curl -fsSL https://claude.ai/install.sh | bash', 'install-status');
  }}

  async function loginClaude() {{
    await copyCmd('claude', 'login-status');
  }}

  async function retry() {{
    const status = await checkClaude();
    if (status.installed) {{
      document.getElementById('setup').innerHTML = `
        <div class="logo">📰</div>
        <h1>Feed Curator</h1>
        <div class="status ok">✓ Claude Code ${{status.version}}</div>
        <p>Starting server...</p>
      `;
      // Reload to trigger normal startup
      setTimeout(() => window.location.reload(), 1000);
    }} else {{
      document.getElementById('retry-msg').textContent = _ja
        ? 'Claude Codeがまだ検出されません。ターミナルでインストールを完了してから再試行してください。'
        : 'Claude Code not detected yet. Complete installation in Terminal and try again.';
    }}
  }}
</script>
</body>
</html>"#,
    if installed {
        format!(r#"
  <div class="status ok">✓ Claude Code {claude}</div>
  <p>{starting}</p>
"#, claude = claude_version,
    starting = if ja { "サーバーを起動中..." } else { "Starting server..." })
    } else if ja {
        r#"
  <div class="status missing">✗ Claude Codeがインストールされていません</div>
  <p>Feed CuratorはClaude Codeを使って記事をキュレーションします。<br>
     インストールしてログインしてください。</p>

  <ol class="steps">
    <li><strong>ステップ 1:</strong> Claude Codeをインストール
      <div class="cmd">curl -fsSL https://claude.ai/install.sh | bash</div>
      <button class="btn btn-primary" onclick="installClaude()">コマンドをコピー</button>
      <span id="install-status"></span>
      <p style="font-size:13px;color:#666;margin-top:4px">ターミナルを開き、貼り付けて実行してください。</p>
    </li>
    <li><strong>ステップ 2:</strong> Claude Codeにログイン
      <div class="cmd">claude</div>
      <button class="btn btn-secondary" onclick="loginClaude()">コマンドをコピー</button>
      <span id="login-status"></span>
      <p style="font-size:13px;color:#666;margin-top:4px">ターミナルで実行し、ブラウザでログインしてください。</p>
    </li>
    <li><strong>ステップ 3:</strong> ここに戻る
      <br><br>
      <button class="btn btn-primary" onclick="retry()">再チェック</button>
      <span id="retry-msg" style="display:block;margin-top:8px;color:#721c24;font-size:13px"></span>
    </li>
  </ol>
"#.to_string()
    } else {
        r#"
  <div class="status missing">✗ Claude Code is not installed</div>
  <p>Feed Curator requires Claude Code to curate articles.<br>
     Install it and log in to get started.</p>

  <ol class="steps">
    <li><strong>Step 1:</strong> Install Claude Code
      <div class="cmd">curl -fsSL https://claude.ai/install.sh | bash</div>
      <button class="btn btn-primary" onclick="installClaude()">Copy Command</button>
      <span id="install-status"></span>
      <p style="font-size:13px;color:#666;margin-top:4px">Open Terminal, paste, and run.</p>
    </li>
    <li><strong>Step 2:</strong> Log in to Claude Code
      <div class="cmd">claude</div>
      <button class="btn btn-secondary" onclick="loginClaude()">Copy Command</button>
      <span id="login-status"></span>
      <p style="font-size:13px;color:#666;margin-top:4px">Open Terminal, paste, and follow the login prompts.</p>
    </li>
    <li><strong>Step 3:</strong> Come back here
      <br><br>
      <button class="btn btn-primary" onclick="retry()">Check Again</button>
      <span id="retry-msg" style="display:block;margin-top:8px;color:#721c24;font-size:13px"></span>
    </li>
  </ol>
"#.to_string()
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![check_claude_status, copy_command_to_clipboard])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let claude_version = if std::env::var("FORCE_SETUP").is_ok() { String::new() } else { detect_claude() };
            let claude_installed = !claude_version.is_empty();

            let window = app.get_webview_window("main").unwrap();

            if claude_installed {
                // Claude is available — launch sidecar normally
                let sidecar = app
                    .shell()
                    .sidecar("feed-curator")
                    .expect("failed to find feed-curator sidecar")
                    .args(["serve", "--port", "3200"]);

                let (_rx, child) = sidecar.spawn().expect("failed to spawn sidecar");
                app.manage(SidecarChild(std::sync::Mutex::new(Some(child))));

                let w = window.clone();
                std::thread::spawn(move || {
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
                                if (window.__TAURI__) {
                                    window.__TAURI__.opener.openUrl(href);
                                }
                            }
                        }, true);
                    "#);
                });
            } else {
                // Claude not installed — show setup screen
                app.manage(SidecarChild(std::sync::Mutex::new(None)));
                let html = setup_html(&claude_version);
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let escaped = html.replace('\\', "\\\\").replace('`', "\\`").replace("${", "\\${");
                    let _ = w.eval(&format!("document.open(); document.write(`{}`); document.close();", escaped));
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
