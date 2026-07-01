// Furlpay desktop library entry (Tauri v2 convention: main.rs calls run()).
// Adds OS-level secure storage (system keychain) for the session token.
use keyring::Entry;

const SERVICE: &str = "app.furlpay.desktop";

/// Persist the session token in the OS keychain.
#[tauri::command]
fn store_session(account: String, token: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())
}

/// Read the session token back from secure storage.
#[tauri::command]
fn read_session(account: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![store_session, read_session])
        .run(tauri::generate_context!())
        .expect("error while running Furlpay desktop");
}
