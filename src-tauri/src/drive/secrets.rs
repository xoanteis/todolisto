//! Refresh tokens per profile, encrypted with the Windows Data Protection API
//! so that only the same Windows user on the same machine can read them. The
//! file lives next to the settings and is never synced.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use todolisto_core::fsutil;

const MAGIC: &[u8] = b"TDLS1";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Secrets {
    #[serde(default)]
    pub accounts: BTreeMap<String, Account>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub refresh_token: String,
    #[serde(default)]
    pub email: Option<String>,
}

pub fn load(path: &Path) -> Secrets {
    match fs::read(path) {
        Ok(bytes) if bytes.starts_with(MAGIC) => unprotect(&bytes[MAGIC.len()..])
            .ok()
            .and_then(|plain| serde_json::from_slice(&plain).ok())
            .unwrap_or_default(),
        _ => Secrets::default(),
    }
}

pub fn save(path: &Path, secrets: &Secrets) -> Result<(), String> {
    let json = serde_json::to_vec(secrets).map_err(|e| e.to_string())?;
    let mut out = MAGIC.to_vec();
    out.extend(protect(&json)?);
    fsutil::atomic_write(path, &out).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(plain, true)
}

#[cfg(windows)]
fn unprotect(blob: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(blob, false)
}

#[cfg(windows)]
fn dpapi(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut data = input.to_vec();
    let mut in_blob = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_mut_ptr() };
    let mut out_blob = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: the blobs point at memory that outlives the call; the output
    // buffer is allocated by the system and released with LocalFree.
    let ok = unsafe {
        if encrypt {
            CryptProtectData(
                &mut in_blob,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        } else {
            CryptUnprotectData(
                &mut in_blob,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        }
    };
    if ok == 0 {
        return Err(if encrypt { "Windows could not encrypt the sign-in data" } else { "Windows could not decrypt the sign-in data" }.to_string());
    }
    // SAFETY: cbData bytes at pbData are valid until LocalFree.
    let result = unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec() };
    unsafe {
        LocalFree(out_blob.pbData.cast());
    }
    Ok(result)
}

#[cfg(not(windows))]
fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    Ok(plain.to_vec())
}

#[cfg(not(windows))]
fn unprotect(blob: &[u8]) -> Result<Vec<u8>, String> {
    Ok(blob.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_ignores_garbage() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config").join("secrets.bin");
        assert!(load(&path).accounts.is_empty());
        let mut secrets = Secrets::default();
        secrets.accounts.insert("work".into(), Account { refresh_token: "r1".into(), email: Some("me@example.com".into()) });
        save(&path, &secrets).unwrap();
        let loaded = load(&path);
        assert_eq!(loaded.accounts["work"].refresh_token, "r1");
        assert_eq!(loaded.accounts["work"].email.as_deref(), Some("me@example.com"));
        fs::write(&path, b"nonsense").unwrap();
        assert!(load(&path).accounts.is_empty());
    }
}
