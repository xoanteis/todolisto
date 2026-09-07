//! `config/window.json`: where the window was last seen on this machine. Kept
//! apart from the settings because it is per device and never synced.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::fsutil;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    /// Size of the overlap between two rectangles, `(0, 0)` when disjoint.
    pub fn overlap(&self, other: &Rect) -> (u32, u32) {
        let left = self.x.max(other.x) as i64;
        let right = (self.x as i64 + self.width as i64).min(other.x as i64 + other.width as i64);
        let top = self.y.max(other.y) as i64;
        let bottom = (self.y as i64 + self.height as i64).min(other.y as i64 + other.height as i64);
        if right <= left || bottom <= top {
            (0, 0)
        } else {
            ((right - left) as u32, (bottom - top) as u32)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

/// Minimum visible part of the window, in pixels, for a saved position to be
/// reused. Smaller than that and the window is centred instead (a monitor
/// was unplugged, the resolution changed...).
pub const MIN_VISIBLE: u32 = 120;

impl WindowGeometry {
    pub fn rect(&self) -> Rect {
        Rect { x: self.x, y: self.y, width: self.width, height: self.height }
    }

    /// Whether at least `MIN_VISIBLE` pixels in both directions fall inside
    /// one of the monitors.
    pub fn fits_any(&self, monitors: &[Rect]) -> bool {
        let me = self.rect();
        monitors.iter().any(|m| {
            let (w, h) = me.overlap(m);
            w >= MIN_VISIBLE && h >= MIN_VISIBLE
        })
    }

    /// `None` when the file is missing or unreadable; a bad geometry file is
    /// never worth failing the start-up for.
    pub fn load(path: &Path) -> Option<WindowGeometry> {
        let raw = fsutil::read_to_string(path).ok()?;
        let geometry: WindowGeometry = serde_json::from_str(&raw).ok()?;
        if geometry.width < 100 || geometry.height < 100 {
            return None;
        }
        Some(geometry)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(|e| crate::Error::Other(e.to_string()))?;
        fsutil::atomic_write(path, format!("{json}\n").as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: Rect = Rect { x: 0, y: 0, width: 1920, height: 1080 };
    const SECOND: Rect = Rect { x: 1920, y: 0, width: 2560, height: 1440 };

    #[test]
    fn fits_when_enough_of_the_window_is_on_a_monitor() {
        let g = WindowGeometry { x: 100, y: 100, width: 760, height: 820, maximized: false };
        assert!(g.fits_any(&[PRIMARY]));
        let mostly_off = WindowGeometry { x: 1850, y: 100, width: 760, height: 820, maximized: false };
        assert!(!mostly_off.fits_any(&[PRIMARY]), "only 70 px visible on the primary monitor");
        assert!(mostly_off.fits_any(&[PRIMARY, SECOND]), "but it spans onto the second monitor");
        let gone = WindowGeometry { x: 5000, y: 100, width: 760, height: 820, maximized: false };
        assert!(!gone.fits_any(&[PRIMARY, SECOND]));
        let negative = WindowGeometry { x: -700, y: -50, width: 760, height: 820, maximized: false };
        assert!(!negative.fits_any(&[PRIMARY]), "60 px wide overlap is not enough");
    }

    #[test]
    fn round_trips_and_rejects_tiny_geometry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config").join("window.json");
        assert!(WindowGeometry::load(&path).is_none());
        let g = WindowGeometry { x: 10, y: 20, width: 800, height: 600, maximized: true };
        g.save(&path).unwrap();
        assert_eq!(WindowGeometry::load(&path), Some(g));
        std::fs::write(&path, r#"{"x":0,"y":0,"width":10,"height":10}"#).unwrap();
        assert!(WindowGeometry::load(&path).is_none());
        std::fs::write(&path, "garbage").unwrap();
        assert!(WindowGeometry::load(&path).is_none());
    }
}
