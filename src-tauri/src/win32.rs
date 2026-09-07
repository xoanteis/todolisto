//! Win32 calls that Tauri does not expose: whole-window opacity through a
//! layered window, and forcing the window to the foreground when a global
//! hotkey asks for it.

use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_MENU};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowLongPtrW, GetWindowThreadProcessId, SetForegroundWindow,
    SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, LWA_ALPHA, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_LAYERED,
};

fn hwnd_of(window: &WebviewWindow) -> Option<HWND> {
    window.hwnd().ok().map(|h| h.0 as HWND)
}

/// Sets the opacity of the whole window (text included). 100 removes the
/// layered style again so the window renders the normal way.
pub fn set_opacity(window: &WebviewWindow, percent: u8) {
    let Some(hwnd) = hwnd_of(window) else { return };
    let percent = percent.min(100) as u32;
    let alpha = (percent * 255 / 100) as u8;
    // SAFETY: plain Win32 calls on a window handle owned by this process.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let layered = style & (WS_EX_LAYERED as isize) != 0;
        if percent >= 100 {
            if layered {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style & !(WS_EX_LAYERED as isize));
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
            }
        } else {
            if !layered {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | (WS_EX_LAYERED as isize));
            }
            SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA);
        }
    }
}

/// Windows only lets the process that received the last input steal the
/// foreground. After a global hotkey that is usually us, but not always;
/// attaching to the foreground thread's input queue works in most of the
/// remaining cases, and a synthetic Alt tap covers the rest.
pub fn force_foreground(window: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(window) else { return };
    // SAFETY: plain Win32 calls; the thread ids come from the system.
    unsafe {
        if GetForegroundWindow() == hwnd {
            return;
        }
        let foreground = GetForegroundWindow();
        let foreground_thread = if foreground.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, std::ptr::null_mut())
        };
        let me = GetCurrentThreadId();
        let attached = foreground_thread != 0 && foreground_thread != me && AttachThreadInput(foreground_thread, me, 1) != 0;
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        if attached {
            AttachThreadInput(foreground_thread, me, 0);
        }
        if GetForegroundWindow() != hwnd {
            keybd_event(VK_MENU as u8, 0, 0, 0);
            keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
            SetForegroundWindow(hwnd);
        }
    }
}
