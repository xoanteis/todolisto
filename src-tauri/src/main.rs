// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod commands;
mod drive;
mod paths;
mod state;
mod tray;
#[cfg(windows)]
mod win32;
mod window;

use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

fn main() {
    if let Err(message) = webview_check() {
        fatal(&message);
        return;
    }

    let app_state = match state::AppState::init() {
        Ok(s) => s,
        Err(e) => {
            fatal(&format!("todolisto could not start.\n\n{e}"));
            return;
        }
    };

    tauri::Builder::default()
        // A second launch (double-clicking the exe again) brings the running
        // window to the front instead of starting another instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| window::show(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        window::toggle(app);
                    }
                })
                .build(),
        )
        .manage(app_state)
        .setup(|app| {
            let handle = app.handle().clone();
            let state = handle.state::<state::AppState>();
            let settings = state.settings();
            let saved_geometry = state.geometry.lock().ok().and_then(|g| *g);

            if let Some(window) = window::main_window(&handle) {
                window::apply_geometry(&window, saved_geometry);
                let _ = window.show();
                let _ = window.set_focus();
            }
            window::apply_settings(&handle, &settings);
            if let Err(e) = tray::setup(&handle) {
                eprintln!("tray icon unavailable: {e}");
            }
            drive::service::start_background(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let app = window.app_handle();
                window::save_geometry_now(app);
                let close_to_tray = app
                    .try_state::<state::AppState>()
                    .map(|s| s.settings().close_to_tray)
                    .unwrap_or(false);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                window::schedule_geometry_save(window.app_handle());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_settings,
            commands::save_settings,
            commands::set_active_profile,
            commands::window_state,
            commands::set_opacity,
            commands::set_pinned,
            commands::hide_window,
            commands::get_stream,
            commands::read_session,
            commands::start_session,
            commands::save_entries,
            commands::end_session,
            commands::reopen_session,
            commands::check_inactivity,
            commands::get_user_words,
            commands::add_user_word,
            commands::get_autocorrect_rules,
            commands::search,
            commands::session_markdown,
            commands::drive_status,
            commands::drive_connect,
            commands::drive_disconnect,
            commands::drive_sync_now,
            commands::agent_status,
            commands::agent_set_key,
            commands::agent_run,
            commands::agent_pending,
            commands::agent_apply,
            commands::agent_discard,
            commands::agent_digest,
            commands::todo_set_done,
        ])
        .run(tauri::generate_context!())
        .expect("error while running todolisto");
}

/// Windows 10 machines may lack the WebView2 runtime; explain instead of
/// showing an empty window.
fn webview_check() -> Result<(), String> {
    match tauri::webview_version() {
        Ok(_) => Ok(()),
        Err(e) => Err(format!(
            "The Microsoft Edge WebView2 runtime was not found ({e}).\n\n\
             todolisto needs it to display its window. Install it from\n\
             https://developer.microsoft.com/microsoft-edge/webview2/\n\
             and start todolisto again."
        )),
    }
}

#[cfg(windows)]
fn fatal(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
    let text = wide(message);
    let caption = wide("todolisto");
    // SAFETY: both buffers are NUL-terminated and outlive the call.
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn fatal(message: &str) {
    eprintln!("{message}");
}
