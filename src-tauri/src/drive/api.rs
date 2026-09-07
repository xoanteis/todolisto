//! Google Drive v3 REST client (blocking; always used from a worker thread)
//! and its adapter to the core sync engine's `Remote` trait.

use std::time::Duration;

use reqwest::blocking::{Client, Response};
use serde::Deserialize;
use todolisto_core::sync::{ChangeSet, Remote, RemoteFile};

const API: &str = "https://www.googleapis.com/drive/v3";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const FILE_FIELDS: &str = "id,name,md5Checksum,modifiedTime,parents,trashed";

pub struct DriveClient {
    http: Client,
    token: String,
}

#[derive(Debug, Deserialize)]
struct FileMeta {
    id: String,
    name: String,
    #[serde(rename = "md5Checksum", default)]
    md5: Option<String>,
    #[serde(rename = "modifiedTime", default)]
    modified: Option<String>,
    #[serde(default)]
    parents: Vec<String>,
    #[serde(default)]
    trashed: bool,
}

impl FileMeta {
    fn into_remote(self) -> RemoteFile {
        RemoteFile {
            id: self.id,
            name: self.name,
            md5: self.md5.unwrap_or_default(),
            modified: self.modified.unwrap_or_default(),
        }
    }
}

#[derive(Deserialize)]
struct FileList {
    #[serde(default)]
    files: Vec<FileMeta>,
    #[serde(rename = "nextPageToken", default)]
    next: Option<String>,
}

#[derive(Deserialize)]
struct StartToken {
    #[serde(rename = "startPageToken")]
    token: String,
}

#[derive(Deserialize)]
struct Change {
    #[serde(default)]
    removed: bool,
    #[serde(default)]
    file: Option<FileMeta>,
}

#[derive(Deserialize)]
struct ChangeList {
    #[serde(default)]
    changes: Vec<Change>,
    #[serde(rename = "nextPageToken", default)]
    next: Option<String>,
    #[serde(rename = "newStartPageToken", default)]
    new_start: Option<String>,
}

fn escape_query(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

impl DriveClient {
    pub fn new(access_token: String) -> Result<DriveClient, String> {
        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(DriveClient { http, token: access_token })
    }

    fn check(response: Result<Response, reqwest::Error>, what: &str) -> Result<Response, String> {
        let response = response.map_err(|e| format!("{what}: {e}"))?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        Err(format!("{what}: HTTP {status} {snippet}"))
    }

    fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str, query: &[(&str, &str)], what: &str) -> Result<T, String> {
        let response = Self::check(self.http.get(url).bearer_auth(&self.token).query(query).send(), what)?;
        response.json::<T>().map_err(|e| format!("{what}: bad response: {e}"))
    }

    pub fn find_folder(&self, parent: &str, name: &str) -> Result<Option<String>, String> {
        let q = format!(
            "'{}' in parents and name = '{}' and mimeType = '{}' and trashed = false",
            escape_query(parent),
            escape_query(name),
            FOLDER_MIME
        );
        let list: FileList = self.get_json(
            &format!("{API}/files"),
            &[("q", q.as_str()), ("fields", "files(id,name)"), ("pageSize", "5"), ("spaces", "drive")],
            "looking up a Drive folder",
        )?;
        Ok(list.files.into_iter().next().map(|f| f.id))
    }

    pub fn create_folder(&self, parent: &str, name: &str) -> Result<String, String> {
        let body = serde_json::json!({ "name": name, "mimeType": FOLDER_MIME, "parents": [parent] });
        let response = Self::check(
            self.http.post(format!("{API}/files")).bearer_auth(&self.token).query(&[("fields", "id")]).json(&body).send(),
            "creating a Drive folder",
        )?;
        let meta: FileMeta = response.json().map_err(|e| e.to_string())?;
        Ok(meta.id)
    }

    pub fn ensure_folder(&self, parent: &str, name: &str) -> Result<String, String> {
        match self.find_folder(parent, name)? {
            Some(id) => Ok(id),
            None => self.create_folder(parent, name),
        }
    }

    pub fn list_folder(&self, folder: &str) -> Result<Vec<RemoteFile>, String> {
        let q = format!("'{}' in parents and trashed = false", escape_query(folder));
        let fields = format!("nextPageToken,files({FILE_FIELDS})");
        let mut files = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut query: Vec<(&str, &str)> = vec![("q", &q), ("fields", &fields), ("pageSize", "1000"), ("spaces", "drive")];
            if let Some(token) = &page {
                query.push(("pageToken", token));
            }
            let list: FileList = self.get_json(&format!("{API}/files"), &query, "listing the Drive folder")?;
            files.extend(list.files.into_iter().filter(|f| !f.trashed).map(FileMeta::into_remote));
            match list.next {
                Some(next) => page = Some(next),
                None => break,
            }
        }
        Ok(files)
    }

    pub fn start_page_token(&self) -> Result<String, String> {
        let token: StartToken = self.get_json(&format!("{API}/changes/startPageToken"), &[], "reading the Drive change token")?;
        Ok(token.token)
    }

    /// Files under `folder` changed since `token`, and the next token.
    pub fn changes(&self, token: &str, folder: &str) -> Result<ChangeSet, String> {
        let fields = format!("nextPageToken,newStartPageToken,changes(removed,file({FILE_FIELDS}))");
        let mut files = Vec::new();
        let mut page = token.to_string();
        loop {
            let list: ChangeList = self.get_json(
                &format!("{API}/changes"),
                &[("pageToken", page.as_str()), ("fields", fields.as_str()), ("pageSize", "1000"), ("spaces", "drive"), ("includeRemoved", "false")],
                "reading Drive changes",
            )?;
            for change in list.changes {
                if change.removed {
                    continue;
                }
                if let Some(file) = change.file {
                    if !file.trashed && file.parents.iter().any(|p| p == folder) {
                        files.push(file.into_remote());
                    }
                }
            }
            if let Some(next) = list.next {
                page = next;
                continue;
            }
            let new_token = list.new_start.ok_or_else(|| "Drive returned no new change token".to_string())?;
            return Ok(ChangeSet { files, token: new_token });
        }
    }

    pub fn download(&self, id: &str) -> Result<Vec<u8>, String> {
        let response = Self::check(
            self.http.get(format!("{API}/files/{id}")).bearer_auth(&self.token).query(&[("alt", "media")]).send(),
            "downloading a file from Drive",
        )?;
        response.bytes().map(|b| b.to_vec()).map_err(|e| e.to_string())
    }

    pub fn upload_new(&self, folder: &str, name: &str, bytes: &[u8]) -> Result<RemoteFile, String> {
        let boundary = format!("todolisto-{}", rand::random::<u64>());
        let metadata = serde_json::json!({ "name": name, "parents": [folder] }).to_string();
        let mut body = Vec::with_capacity(bytes.len() + metadata.len() + 256);
        body.extend_from_slice(format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n").as_bytes());
        body.extend_from_slice(format!("--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes());
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
        let response = Self::check(
            self.http
                .post(format!("{UPLOAD}/files"))
                .bearer_auth(&self.token)
                .query(&[("uploadType", "multipart"), ("fields", FILE_FIELDS)])
                .header("Content-Type", format!("multipart/related; boundary={boundary}"))
                .body(body)
                .send(),
            "uploading a file to Drive",
        )?;
        let meta: FileMeta = response.json().map_err(|e| e.to_string())?;
        Ok(meta.into_remote())
    }

    pub fn upload_update(&self, id: &str, bytes: &[u8]) -> Result<RemoteFile, String> {
        let response = Self::check(
            self.http
                .patch(format!("{UPLOAD}/files/{id}"))
                .bearer_auth(&self.token)
                .query(&[("uploadType", "media"), ("fields", FILE_FIELDS)])
                .header("Content-Type", "application/octet-stream")
                .body(bytes.to_vec())
                .send(),
            "updating a file on Drive",
        )?;
        let meta: FileMeta = response.json().map_err(|e| e.to_string())?;
        Ok(meta.into_remote())
    }
}

/// The profile folder on Drive, seen through the sync engine's interface.
pub struct DriveRemote {
    pub client: DriveClient,
    pub folder: String,
}

impl Remote for DriveRemote {
    fn list(&mut self) -> Result<ChangeSet, String> {
        // The token is fetched before listing so that nothing that happens
        // during the listing is missed by the next round.
        let token = self.client.start_page_token()?;
        let files = self.client.list_folder(&self.folder)?;
        Ok(ChangeSet { files, token })
    }

    fn changes(&mut self, token: &str) -> Result<ChangeSet, String> {
        self.client.changes(token, &self.folder)
    }

    fn download(&mut self, id: &str) -> Result<Vec<u8>, String> {
        self.client.download(id)
    }

    fn upload(&mut self, existing_id: Option<&str>, name: &str, bytes: &[u8]) -> Result<RemoteFile, String> {
        match existing_id {
            Some(id) => self.client.upload_update(id, bytes),
            None => self.client.upload_new(&self.folder, name, bytes),
        }
    }
}
