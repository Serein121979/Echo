use tauri::Manager;

const KEYRING_SERVICE: &str = "com.zhuanz.echo";
const CHUNK_MANIFEST_PREFIX: &str = "echo-secure-chunks:v1:";
// Windows Credential Manager limits a generic credential blob to 2560 bytes.
// keyring stores strings as UTF-16 there, so keeping each part below 1000 UTF-16
// code units leaves enough margin and works consistently on macOS as well.
const MAX_CHUNK_UTF16_UNITS: usize = 1000;

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
            secure_storage_remove
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
