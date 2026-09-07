//! Main window behaviour: show/hide/toggle, opacity, pin, remembered
//! geometry, and the global hotkey.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use todolisto_core::{Rect, Settings, WindowGeometry};

use crate::state::AppState;

pub const MAIN: &str = "main";

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

pub fn show(app: &AppHandle) {
    let Some(window) = main_window(app) else { return };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    #[cfg(windows)]
    crate::win32::force_foreground(&window);
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        save_geometry_now(app);
        let _ = window.hide();
    }
}

/// The hotkey action: hide when the window is in front, show otherwise.
pub fn toggle(app: &AppHandle) {
    let Some(window) = main_window(app) else { return };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && !minimized && focused {
        hide(app);
    } else {
        show(app);
    }
}

pub fn apply_opacity(window: &WebviewWindow, percent: u8) {
    #[cfg(windows)]
    crate::win32::set_opacity(window, percent);
    #[cfg(not(windows))]
    {
        let _ = (window, percent);
    }
}

pub fn apply_pinned(window: &WebviewWindow, pinned: bool) {
    let _ = window.set_always_on_top(pinned);
}

/// Applies the visual settings (opacity, pin) and the hotkey. Returns the
/// hotkey registration error, if any, so the UI can show it.
pub fn apply_settings(app: &AppHandle, settings: &Settings) -> Option<String> {
    if let Some(window) = main_window(app) {
        apply_opacity(&window, settings.opacity);
        apply_pinned(&window, settings.always_on_top);
    }
    let error = register_hotkey(app, &settings.hotkey).err();
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut slot) = state.hotkey_error.lock() {
            *slot = error.clone();
        }
    }
    error
}

pub fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let hotkey = hotkey.trim();
    if hotkey.is_empty() {
        return Ok(());
    }
    shortcuts
        .register(hotkey)
        .map_err(|e| format!("The hotkey {hotkey} could not be registered ({e}). Change \"hotkey\" in settings.json."))
}

fn monitor_rects(window: &WebviewWindow) -> Vec<Rect> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            Rect { x: p.x, y: p.y, width: s.width, height: s.height }
        })
        .collect()
}

/// Restores the saved position and size when they still land on a monitor,
/// otherwise centres the window.
pub fn apply_geometry(window: &WebviewWindow, saved: Option<WindowGeometry>) {
    if let Some(g) = saved {
        if g.fits_any(&monitor_rects(window)) {
            let _ = window.set_position(PhysicalPosition::new(g.x, g.y));
            let _ = window.set_size(PhysicalSize::new(g.width, g.height));
            if g.maximized {
                let _ = window.maximize();
            }
            return;
        }
    }
    let _ = window.center();
}

pub fn current_geometry(window: &WebviewWindow, previous: Option<WindowGeometry>) -> Option<WindowGeometry> {
    if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(false) {
        return None;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized {
        // Keep the last normal rectangle; only remember that it was maximized.
        return previous.map(|p| WindowGeometry { maximized: true, ..p });
    }
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(WindowGeometry { x: position.x, y: position.y, width: size.width, height: size.height, maximized: false })
}

pub fn save_geometry_now(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let Some(window) = main_window(app) else { return };
    let previous = state.geometry.lock().ok().and_then(|g| *g);
    if let Some(geometry) = current_geometry(&window, previous) {
        if Some(geometry) != previous {
            if let Ok(mut slot) = state.geometry.lock() {
                *slot = Some(geometry);
            }
            let _ = geometry.save(&state.geometry_path);
        }
    }
}

/// Moves and resizes arrive in bursts; write once things settle.
pub fn schedule_geometry_save(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let generation = state.geometry_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(700)).await;
        if let Some(state) = app.try_state::<AppState>() {
            if state.geometry_generation.load(Ordering::SeqCst) == generation {
                save_geometry_now(&app);
            }
        }
    });
}

/// Quit for real: hide first so the UI flushes its pending writes, then exit.
pub fn quit(app: &AppHandle) {
    hide(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        app.exit(0);
    });
}
