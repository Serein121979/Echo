use clipboard_rs::{common::RustImage, Clipboard, ClipboardContext};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Response, Manager};

const KEYRING_SERVICE: &str = "com.zhuanz.echo";
const CHUNK_MANIFEST_PREFIX: &str = "echo-secure-chunks:v1:";
// Windows Credential Manager limits a generic credential blob to 2560 bytes.
// keyring stores strings as UTF-16 there, so keeping each part below 1000 UTF-16
// code units leaves enough margin and works consistently on macOS as well.
const MAX_CHUNK_UTF16_UNITS: usize = 1000;
const MAX_NATIVE_FILE_CHUNK_BYTES: u64 = 8 * 1024 * 1024;
static CLIPBOARD_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct ClipboardFileRegistry(Mutex<HashMap<String, ClipboardFileEntry>>);

struct ClipboardFileEntry {
    path: PathBuf,
    temporary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardFileDescriptor {
    id: String,
    name: String,
    size: u64,
    last_modified: u64,
    file_type: String,
}

fn unix_millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn file_type_for_name(name: &str) -> String {
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "zip" => "application/zip",
        "exe" => "application/vnd.microsoft.portable-executable",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn register_clipboard_path(
    registry: &ClipboardFileRegistry,
    path: PathBuf,
    temporary: bool,
    sequence: usize,
) -> Result<ClipboardFileDescriptor, String> {
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("剪贴板内容不是可发送的文件".into());
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("clipboard-file")
        .to_string();
    let last_modified = metadata.modified().map(unix_millis).unwrap_or(0);
    let id = format!(
        "clipboard-{}-{sequence}-{}",
        unix_millis(SystemTime::now()),
        CLIPBOARD_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );

    registry
        .0
        .lock()
        .map_err(|_| "剪贴板文件队列暂时不可用".to_string())?
        .insert(id.clone(), ClipboardFileEntry { path, temporary });

    Ok(ClipboardFileDescriptor {
        id,
        file_type: file_type_for_name(&name),
        name,
        size: metadata.len(),
        last_modified,
    })
}

#[tauri::command]
fn clipboard_file_descriptors(
    app: tauri::AppHandle,
    registry: tauri::State<'_, ClipboardFileRegistry>,
) -> Result<Vec<ClipboardFileDescriptor>, String> {
    let clipboard = ClipboardContext::new().map_err(|error| error.to_string())?;
    let files = clipboard.get_files().unwrap_or_default();
    let mut descriptors = Vec::new();

    for (sequence, value) in files.into_iter().enumerate() {
        let path = PathBuf::from(value);
        if path.is_file() {
            descriptors.push(register_clipboard_path(&registry, path, false, sequence)?);
        }
    }

    if !descriptors.is_empty() {
        return Ok(descriptors);
    }

    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(_) => return Ok(Vec::new()),
    };
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("clipboard");
    std::fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let path = cache_dir.join(format!("剪贴板图片-{}.png", unix_millis(SystemTime::now())));
    image
        .save_to_path(path.to_string_lossy().as_ref())
        .map_err(|error| error.to_string())?;
    Ok(vec![register_clipboard_path(&registry, path, true, 0)?])
}

#[tauri::command]
fn read_clipboard_file_chunk(
    registry: tauri::State<'_, ClipboardFileRegistry>,
    id: String,
    start: u64,
    end: u64,
) -> Result<Response, String> {
    if end < start || end - start > MAX_NATIVE_FILE_CHUNK_BYTES {
        return Err("请求的文件分片范围无效".into());
    }
    let path = registry
        .0
        .lock()
        .map_err(|_| "剪贴板文件队列暂时不可用".to_string())?
        .get(&id)
        .map(|entry| entry.path.clone())
        .ok_or_else(|| "剪贴板文件已失效，请重新粘贴".to_string())?;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity((end - start) as usize);
    file.take(end - start)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn release_clipboard_file(
    registry: tauri::State<'_, ClipboardFileRegistry>,
    id: String,
) -> Result<(), String> {
    let entry = registry
        .0
        .lock()
        .map_err(|_| "剪贴板文件队列暂时不可用".to_string())?
        .remove(&id);
    if let Some(entry) = entry {
        if entry.temporary {
            match std::fs::remove_file(entry.path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    Ok(())
}

fn secure_entry(key: &str, suffix: Option<&str>) -> Result<keyring::Entry, String> {
    if key.is_empty() || key.len() > 512 {
        return Err("invalid secure storage key".into());
    }
    let account = match suffix {
        Some(value) => format!("supabase:{key}:{value}"),
        None => format!("supabase:{key}"),
    };
    keyring::Entry::new(KEYRING_SERVICE, &account).map_err(|error| error.to_string())
}

fn split_secret(value: &str) -> Vec<String> {
    if value.is_empty() {
        return vec![String::new()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_units = 0;

    for character in value.chars() {
        let units = character.len_utf16();
        if current_units + units > MAX_CHUNK_UTF16_UNITS && !current.is_empty() {
            chunks.push(current);
            current = String::new();
            current_units = 0;
        }
        current.push(character);
        current_units += units;
    }

    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn manifest_count(value: &str) -> Option<usize> {
    value
        .strip_prefix(CHUNK_MANIFEST_PREFIX)
        .and_then(|count| count.parse::<usize>().ok())
        .filter(|count| *count > 0 && *count <= 128)
}

fn delete_entry(entry: keyring::Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secure_storage_get(key: String) -> Result<Option<String>, String> {
    match secure_entry(&key, None)?.get_password() {
        Ok(value) => {
            let Some(count) = manifest_count(&value) else {
                return Ok(Some(value));
            };

            let mut combined = String::new();
            for index in 0..count {
                let part = secure_entry(&key, Some(&format!("part-{index}")))?
                    .get_password()
                    .map_err(|error| {
                        format!("secure session part {index} is unavailable: {error}")
                    })?;
                combined.push_str(&part);
            }
            Ok(Some(combined))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secure_storage_set(key: String, value: String) -> Result<(), String> {
    let previous_count = secure_entry(&key, None)?
        .get_password()
        .ok()
        .and_then(|value| manifest_count(&value))
        .unwrap_or(0);
    let chunks = split_secret(&value);

    for (index, chunk) in chunks.iter().enumerate() {
        if let Err(error) = secure_entry(&key, Some(&format!("part-{index}")))?.set_password(chunk)
        {
            for cleanup_index in 0..=index {
                let _ = delete_entry(secure_entry(&key, Some(&format!("part-{cleanup_index}")))?);
            }
            return Err(format!(
                "failed to save secure session part {index}: {error}"
            ));
        }
    }

    secure_entry(&key, None)?
        .set_password(&format!("{CHUNK_MANIFEST_PREFIX}{}", chunks.len()))
        .map_err(|error| format!("failed to save secure session manifest: {error}"))?;

    for index in chunks.len()..previous_count {
        delete_entry(secure_entry(&key, Some(&format!("part-{index}")))?)?;
    }
    Ok(())
}

#[tauri::command]
fn secure_storage_remove(key: String) -> Result<(), String> {
    let count = secure_entry(&key, None)?
        .get_password()
        .ok()
        .and_then(|value| manifest_count(&value))
        .unwrap_or(0);
    for index in 0..count {
        delete_entry(secure_entry(&key, Some(&format!("part-{index}")))?)?;
    }
    delete_entry(secure_entry(&key, None)?)
}

#[cfg(test)]
mod tests {
    use super::{manifest_count, split_secret, CHUNK_MANIFEST_PREFIX, MAX_CHUNK_UTF16_UNITS};

    #[test]
    fn splits_long_sessions_without_breaking_unicode() {
        let value = format!("{}{}", "a".repeat(2400), "传输📎".repeat(400));
        let chunks = split_secret(&value);
        assert!(chunks.len() > 2);
        assert_eq!(chunks.concat(), value);
        assert!(chunks
            .iter()
            .all(|part| part.encode_utf16().count() <= MAX_CHUNK_UTF16_UNITS));
    }

    #[test]
    fn parses_only_valid_manifests() {
        assert_eq!(
            manifest_count(&format!("{CHUNK_MANIFEST_PREFIX}3")),
            Some(3)
        );
        assert_eq!(manifest_count(&format!("{CHUNK_MANIFEST_PREFIX}0")), None);
        assert_eq!(manifest_count("ordinary-session-value"), None);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ClipboardFileRegistry::default())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            secure_storage_get,
            secure_storage_set,
            secure_storage_remove,
            clipboard_file_descriptors,
            read_clipboard_file_chunk,
            release_clipboard_file
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                if std::env::args().any(|arg| arg == "--autostart") {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Echo Desktop");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        {
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
