#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec!["--autostart"]),
    ))
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_store::Builder::default().build())
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
    .run(tauri::generate_context!())
    .expect("error while running Echo Clips Desktop");
}
