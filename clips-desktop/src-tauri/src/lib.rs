use tauri::Manager;

const KEYRING_SERVICE: &str = "com.zhuanz.echo";

fn secure_entry(key: &str) -> Result<keyring::Entry, String> {
  if key.is_empty() || key.len() > 512 {
    return Err("invalid secure storage key".into());
  }
  keyring::Entry::new(KEYRING_SERVICE, &format!("supabase:{key}"))
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn secure_storage_get(key: String) -> Result<Option<String>, String> {
  match secure_entry(&key)?.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(error) => Err(error.to_string()),
  }
}

#[tauri::command]
fn secure_storage_set(key: String, value: String) -> Result<(), String> {
  secure_entry(&key)?
    .set_password(&value)
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn secure_storage_remove(key: String) -> Result<(), String> {
  match secure_entry(&key)?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(error) => Err(error.to_string()),
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
      if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
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
