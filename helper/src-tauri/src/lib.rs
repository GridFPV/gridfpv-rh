//! GridFPV Video's desktop shell (#99).
//!
//! The pipeline is the Node program in `companion/` (bundled under `resources/companion`
//! with its `node_modules` and the built window under `ui/`). This shell:
//!
//! 1. starts `node companion/src/cli.js serve --port 0 --ui <resources>/companion/ui` as a
//!    Tauri sidecar (the `node` external binary is the pinned Node release);
//! 2. reads its stdout for the line `listening http://127.0.0.1:<port>` and opens the main
//!    window at that address — the page makes same-origin calls to the API and the event
//!    stream, so the window must load from the sidecar's own origin, not from `tauri://`;
//! 3. copies everything the sidecar prints to `<app log dir>/helper.log` (Windows GUI
//!    processes have no console), and kills the sidecar when the app exits.
//!
//! Profiles and the fetched ffmpeg live in the sidecar's own per-user folder
//! (`%APPDATA%\GridFPV Video`), so a reinstall or an update keeps them.

use std::io::Write;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The running sidecar, so exit can kill it.
struct Sidecar(Mutex<Option<CommandChild>>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let resources = dunce::simplified(&app.path().resource_dir()?).to_path_buf();
            let companion = resources.join("companion");
            let cli = companion.join("src").join("cli.js");
            let ui = companion.join("ui");
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            let log_path = log_dir.join("helper.log");
            let mut log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .ok();
            if let Some(l) = log.as_mut() {
                let _ = writeln!(l, "--- gridfpv-video shell starting; cli {}", cli.display());
            }

            let (mut rx, child) = app
                .shell()
                .sidecar("node")?
                .args([
                    cli.to_string_lossy().as_ref(),
                    "serve",
                    "--port",
                    "0",
                    "--ui",
                    ui.to_string_lossy().as_ref(),
                    "--exit-with-stdin",
                ])
                .current_dir(companion)
                .spawn()?;
            *app.state::<Sidecar>().0.lock().unwrap() = Some(child);

            tauri::async_runtime::spawn(async move {
                let mut opened = false;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                            let line = String::from_utf8_lossy(&bytes).to_string();
                            if let Some(l) = log.as_mut() {
                                let _ = writeln!(l, "{}", line.trim_end());
                            }
                            if !opened {
                                if let Some(url) = line.trim().strip_prefix("listening ") {
                                    opened = true;
                                    open_window(&handle, url);
                                }
                            }
                        }
                        CommandEvent::Terminated(status) => {
                            if let Some(l) = log.as_mut() {
                                let _ = writeln!(l, "--- sidecar exited: {:?}", status);
                            }
                            if !opened {
                                // Nothing to show: the page never came up. Say so and quit.
                                open_failure(&handle, &log_path);
                            } else {
                                handle.exit(0);
                            }
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building GridFPV Video")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}

/// The main window, at the sidecar's address.
fn open_window(handle: &AppHandle, url: &str) {
    let url = url.to_string();
    let handle = handle.clone();
    let _ = handle.clone().run_on_main_thread(move || {
        if let Ok(parsed) = url.parse() {
            let _ = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(parsed))
                .title("GridFPV Video")
                .inner_size(1120.0, 780.0)
                .min_inner_size(820.0, 560.0)
                .build();
        }
    });
}

/// The sidecar died before it listened: a page that says where the log is, then nothing else to do.
fn open_failure(handle: &AppHandle, log_path: &std::path::Path) {
    let html = format!(
        "<!doctype html><title>GridFPV Video</title><body style=\"font-family:system-ui;background:#0b0e13;color:#e6e9ef;padding:2rem\">\
         <h1>GridFPV Video could not start</h1><p>The helper process exited before it opened its window. \
         Its log is at:</p><pre>{}</pre><p>Close this window, check the log, and start the app again.</p></body>",
        log_path.display()
    );
    let url = format!("data:text/html;charset=utf-8,{}", urlencode(&html));
    let handle = handle.clone();
    let _ = handle.clone().run_on_main_thread(move || {
        if let Ok(parsed) = url.parse() {
            let _ = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(parsed))
                .title("GridFPV Video")
                .inner_size(720.0, 420.0)
                .build();
        }
    });
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
