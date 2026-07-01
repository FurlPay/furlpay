// Furlpay desktop entry point (Tauri v2). Delegates to the library run().
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    furlpay_desktop_lib::run();
}
