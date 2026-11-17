const COMMANDS: &[&str] = &["share", "now_playing", "clear_now_playing", "insets", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").ios_path("ios").build();
}
