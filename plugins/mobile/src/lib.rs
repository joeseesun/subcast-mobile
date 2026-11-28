//! SubCast's phone glue. The page calls these commands; they run in the native plugin (ios/, android/):
//! - `share`: the system share sheet for text or a file the app saved.
//! - `now_playing`: what plays, for the lock screen / Control Center (iOS) and the media notification (Android,
//!   which also keeps a foreground service alive so audio continues with the screen off).
//! - `clear_now_playing`: playback ended or stopped.
//! Remote buttons (play, pause, skip, seek) come back as the plugin event `remote`: {action, position?}.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{plugin::{Builder, TauriPlugin}, Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile);

pub struct Mobile<R: Runtime>(#[allow(dead_code)] Option<tauri::plugin::PluginHandle<R>>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareArgs { text: Option<String>, path: Option<String>, mime: Option<String>, title: Option<String> }

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: Option<String>,
    artwork: Option<String>,
    duration: Option<f64>,
    position: Option<f64>,
    rate: Option<f64>,
    playing: bool,
}

fn run<R: Runtime>(app: &tauri::AppHandle<R>, method: &str, args: impl Serialize) -> Result<(), String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        let Some(handle) = app.state::<Mobile<R>>().0.clone() else { return Err("no native plugin".into()) };
        return handle.run_mobile_plugin::<Value>(method, args).map(|_| ()).map_err(|e| e.to_string());
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    { let _ = (app, method, serde_json::to_value(args)); Err("only on phones".into()) }
}

#[tauri::command]
async fn share<R: Runtime>(app: tauri::AppHandle<R>, text: Option<String>, path: Option<String>, mime: Option<String>, title: Option<String>) -> Result<(), String> {
    run(&app, "share", ShareArgs { text, path, mime, title })
}

#[tauri::command]
async fn now_playing<R: Runtime>(app: tauri::AppHandle<R>, info: NowPlaying) -> Result<(), String> { run(&app, "nowPlaying", info) }

#[tauri::command]
async fn clear_now_playing<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> { run(&app, "clearNowPlaying", Value::Null) }

#[tauri::command]
async fn podcast_audio<R: Runtime>(app: tauri::AppHandle<R>, command: Value) -> Result<Value, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        let Some(handle) = app.state::<Mobile<R>>().0.clone() else { return Err("no native plugin".into()) };
        handle.run_mobile_plugin_async("podcastAudio", command).await.map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    { let _ = (app, command); Err("only on phones".into()) }
}

#[tauri::command]
async fn selection_feedback<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    { run(&app, "selectionFeedback", Value::Null) }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    { let _ = app; Ok(()) }
}

#[tauri::command]
async fn update_glass_dock<R: Runtime>(app: tauri::AppHandle<R>, state: Value) -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        let Some(handle) = app.state::<Mobile<R>>().0.clone() else { return Ok(false) };
        handle.run_mobile_plugin("updateGlassDock", state).map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    { let _ = (app, state); Ok(false) }
}

#[tauri::command]
async fn present_settings_index<R: Runtime>(app: tauri::AppHandle<R>, state: Value) -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    {
        let Some(handle) = app.state::<Mobile<R>>().0.clone() else { return Ok(None) };
        handle.run_mobile_plugin_async("presentSettingsIndex", state).await.map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    { let _ = (app, state); Ok(None) }
}

/// Android only: the status / gesture bar heights in CSS pixels (iOS uses env(safe-area-inset-*)).
#[tauri::command]
async fn insets<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        let Some(handle) = app.state::<Mobile<R>>().0.clone() else { return Err("no native plugin".into()) };
        return handle.run_mobile_plugin::<Value>("insets", Value::Null).map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "android"))]
    { let _ = app; Ok(Value::Null) }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile")
        .invoke_handler(tauri::generate_handler![share, now_playing, clear_now_playing, insets, selection_feedback, podcast_audio, update_glass_dock, present_settings_index])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle = Some(api.register_android_plugin("ai.qiaomu.subcast.mobileplugin", "MobilePlugin")?);
            #[cfg(target_os = "ios")]
            let handle = Some(api.register_ios_plugin(init_plugin_mobile)?);
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            let handle = { let _ = api; None };
            app.manage(Mobile::<R>(handle));
            Ok(())
        })
        .build()
}
