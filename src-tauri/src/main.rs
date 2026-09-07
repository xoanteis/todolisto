// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod paths;
mod state;

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
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_settings,
            commands::save_settings,
            commands::get_stream,
            commands::read_session,
            commands::start_session,
            commands::save_entries,
            commands::end_session,
            commands::reopen_session,
            commands::check_inactivity,
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
