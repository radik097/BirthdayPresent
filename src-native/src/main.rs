use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tempfile::TempDir;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

#[derive(Debug, Serialize, Clone)]
struct AppError {
    code: &'static str,
    message: String,
    details: Option<Value>,
    recoverable: bool,
}

impl AppError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
            recoverable: true,
        }
    }

    fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

#[derive(Debug, Deserialize)]
struct RequestEnvelope {
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct ResponseEnvelope {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<AppError>,
}

#[derive(Debug, Serialize)]
struct EventEnvelope<T: Serialize> {
    event: &'static str,
    payload: T,
}

#[derive(Debug, Clone)]
struct RuntimePaths {
    app_root: PathBuf,
    themes_dir: PathBuf,
    libs_dir: PathBuf,
    data_dir: PathBuf,
    settings_file: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppSettings {
    #[serde(rename = "activeThemeId")]
    active_theme_id: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_theme_id: "default_darkest".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThemeFont {
    family: String,
    file: String,
    #[serde(default)]
    weight: Option<String>,
    #[serde(default)]
    style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThemeManifest {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    id: String,
    name: String,
    version: String,
    author: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(rename = "targetAppVersion", default)]
    target_app_version: Option<String>,
    #[serde(rename = "entryCss")]
    entry_css: String,
    #[serde(rename = "previewImage", default)]
    preview_image: Option<String>,
    #[serde(default)]
    fonts: Vec<ThemeFont>,
    #[serde(default)]
    variables: BTreeMap<String, String>,
    #[serde(default)]
    assets: BTreeMap<String, String>,
    #[serde(default)]
    modes: Vec<String>,
    #[serde(rename = "supportsCustomWallpaper", default)]
    supports_custom_wallpaper: bool,
}

#[derive(Debug, Clone, Serialize)]
struct ThemeRecord {
    manifest: ThemeManifest,
    active: bool,
}

#[derive(Debug, Deserialize)]
struct ThemeIdRequest {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ThemeImportRequest {
    #[serde(rename = "filePath")]
    file_path: String,
}

#[derive(Debug, Deserialize)]
struct ThemeExportRequest {
    id: String,
    #[serde(rename = "outPath")]
    out_path: String,
}

#[derive(Debug, Deserialize)]
struct CreateThemeRequest {
    id: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    variables: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct AnalyzeRequest {
    url: String,
    #[serde(default)]
    network: Option<NetworkSettings>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "kebab-case")]
enum NetworkStrategy {
    Direct,
    Proxy,
    #[serde(rename = "system-bypass")]
    SystemBypass,
}

#[derive(Debug, Deserialize, Clone)]
struct NetworkSettings {
    strategy: NetworkStrategy,
    #[serde(rename = "proxyUrl", default)]
    proxy_url: Option<String>,
    #[serde(default)]
    impersonate: Option<String>,
    #[serde(rename = "cookiesFromBrowser", default)]
    cookies_from_browser: Option<String>,
}

#[derive(Debug, Serialize)]
struct AnalyzeResult {
    url: String,
    #[serde(rename = "webpageUrl")]
    webpage_url: String,
    extractor: Option<String>,
    title: String,
    #[serde(rename = "durationSeconds")]
    duration_seconds: Option<f64>,
    #[serde(rename = "thumbnailUrl")]
    thumbnail_url: Option<String>,
    uploader: Option<String>,
    formats: Vec<AnalyzeFormat>,
}

#[derive(Debug, Serialize)]
struct AnalyzeFormat {
    id: String,
    ext: Option<String>,
    resolution: Option<String>,
    note: Option<String>,
    #[serde(rename = "audioOnly")]
    audio_only: bool,
    #[serde(rename = "videoOnly")]
    video_only: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
enum DownloadPreset {
    Best,
    Mp3,
}

#[derive(Debug, Deserialize, Clone)]
struct DownloadRequest {
    id: String,
    url: String,
    #[serde(rename = "outputDir")]
    output_dir: String,
    preset: DownloadPreset,
    #[serde(default)]
    network: Option<NetworkSettings>,
}

#[derive(Debug)]
struct ActiveDownload {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Clone)]
struct AppState {
    paths: RuntimePaths,
    writer: Arc<Mutex<BufWriter<io::Stdout>>>,
    settings: Arc<Mutex<AppSettings>>,
    downloads: Arc<Mutex<HashMap<String, ActiveDownload>>>,
}

fn app_error(code: &'static str, message: impl Into<String>) -> AppError {
    AppError::new(code, message)
}

fn binary_missing_error(state: &AppState, file_name: &str) -> AppError {
    app_error("BINARY_MISSING", format!("Missing required binary: {}", file_name)).with_details(json!({
        "binary": file_name,
        "expectedPath": state.paths.libs_dir.join(file_name).display().to_string(),
        "help": [
            format!("Place {} into libs/.", file_name),
            "Keep the source URL, version, and license notice with the binary."
        ]
    }))
}

fn map_download_request_error(state: &AppState, error: anyhow::Error) -> AppError {
    let message = error.to_string();

    if let Some(file_name) = message.strip_prefix("Missing required binary: ").map(str::trim) {
        return binary_missing_error(state, file_name);
    }

    if message.contains("valid http/https") || message.contains("Only http and https URLs") {
        return app_error("VALIDATION_ERROR", message);
    }

    classify_yt_dlp_error(&message)
}

fn send_json<T: Serialize>(writer: &Arc<Mutex<BufWriter<io::Stdout>>>, payload: &T) -> Result<()> {
    let mut guard = writer.lock().expect("stdout lock poisoned");
    serde_json::to_writer(&mut *guard, payload)?;
    guard.write_all(b"\n")?;
    guard.flush()?;
    Ok(())
}

fn send_result(writer: &Arc<Mutex<BufWriter<io::Stdout>>>, id: String, result: Value) -> Result<()> {
    send_json(
        writer,
        &ResponseEnvelope {
            id,
            result: Some(result),
            error: None,
        },
    )
}

fn send_error(writer: &Arc<Mutex<BufWriter<io::Stdout>>>, id: String, error: AppError) -> Result<()> {
    send_json(
        writer,
        &ResponseEnvelope {
            id,
            result: None,
            error: Some(error),
        },
    )
}

fn emit_event<T: Serialize>(state: &AppState, event: &'static str, payload: T) {
    let _ = send_json(&state.writer, &EventEnvelope { event, payload });
}

fn runtime_paths() -> Result<RuntimePaths> {
    let app_root = std::env::var("DISMAS_BASE_DIR")
        .map(PathBuf::from)
        .map_err(|_| anyhow!("DISMAS_BASE_DIR is required"))?;

    Ok(RuntimePaths {
        themes_dir: app_root.join("themes"),
        libs_dir: app_root.join("libs"),
        data_dir: app_root.join("data"),
        settings_file: app_root.join("data").join("settings.json"),
        app_root,
    })
}

fn ensure_layout(paths: &RuntimePaths) -> Result<()> {
    fs::create_dir_all(&paths.themes_dir)?;
    fs::create_dir_all(&paths.libs_dir)?;
    fs::create_dir_all(&paths.data_dir)?;

    if !paths.settings_file.exists() {
        fs::write(
            &paths.settings_file,
            format!("{}\n", serde_json::to_string_pretty(&AppSettings::default())?),
        )?;
    }

    Ok(())
}

fn load_settings(paths: &RuntimePaths) -> AppSettings {
    fs::read_to_string(&paths.settings_file)
        .ok()
        .and_then(|raw| serde_json::from_str::<AppSettings>(&raw).ok())
        .unwrap_or_default()
}

fn persist_settings(state: &AppState, settings: &AppSettings) -> Result<()> {
    fs::write(
        &state.paths.settings_file,
        format!("{}\n", serde_json::to_string_pretty(settings)?),
    )?;
    *state.settings.lock().expect("settings lock poisoned") = settings.clone();
    Ok(())
}

fn require_valid_url(url: &str) -> Result<()> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(anyhow!("A valid http/https URL is required."));
    }
    Ok(())
}

fn valid_theme_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_' || character == '-')
}

fn safe_join(base: &Path, relative: &Path) -> Result<PathBuf> {
    let mut result = PathBuf::from(base);

    for component in relative.components() {
        match component {
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            _ => return Err(anyhow!("Unsafe relative path: {}", relative.display())),
        }
    }

    Ok(result)
}

fn allowed_theme_extensions() -> HashSet<&'static str> {
    HashSet::from([
        "json", "css", "png", "jpg", "jpeg", "webp", "svg", "woff", "woff2", "ttf", "otf",
    ])
}

fn read_theme_manifest(theme_root: &Path) -> Result<ThemeManifest> {
    let manifest_path = theme_root.join("manifest.json");
    let raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("Failed to read {}", manifest_path.display()))?;
    let manifest: ThemeManifest = serde_json::from_str(&raw)?;

    if !valid_theme_id(&manifest.id) {
        return Err(anyhow!("Theme manifest must contain a safe id."));
    }

    if manifest.name.trim().is_empty() || manifest.entry_css.trim().is_empty() {
        return Err(anyhow!("Theme manifest must contain name and entryCss."));
    }

    Ok(manifest)
}

fn validate_theme_directory(theme_root: &Path) -> Result<ThemeManifest> {
    let manifest = read_theme_manifest(theme_root)?;
    let entry_css = safe_join(theme_root, Path::new(&manifest.entry_css))?;

    if !entry_css.exists() {
        return Err(anyhow!("Theme entryCss is missing."));
    }

    for asset in manifest
        .assets
        .values()
        .chain(manifest.fonts.iter().map(|font| &font.file))
        .chain(manifest.preview_image.iter())
    {
        let resolved = safe_join(theme_root, Path::new(asset))?;
        if !resolved.exists() {
            return Err(anyhow!("Missing theme asset: {}", asset));
        }
    }

    Ok(manifest)
}

fn list_themes(state: &AppState) -> Result<Vec<ThemeRecord>> {
    let active_theme_id = state
        .settings
        .lock()
        .expect("settings lock poisoned")
        .active_theme_id
        .clone();
    let mut records = Vec::new();

    for entry in fs::read_dir(&state.paths.themes_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        if let Ok(manifest) = validate_theme_directory(&entry.path()) {
            records.push(ThemeRecord {
                active: manifest.id == active_theme_id,
                manifest,
            });
        }
    }

    records.sort_by(|left, right| {
        right
            .active
            .cmp(&left.active)
            .then_with(|| left.manifest.name.cmp(&right.manifest.name))
    });

    Ok(records)
}

fn theme_record(state: &AppState, theme_id: &str) -> Result<ThemeRecord> {
    let manifest = validate_theme_directory(&state.paths.themes_dir.join(theme_id))?;
    let active_theme_id = state
        .settings
        .lock()
        .expect("settings lock poisoned")
        .active_theme_id
        .clone();

    Ok(ThemeRecord {
        active: active_theme_id == theme_id,
        manifest,
    })
}

fn import_theme_archive(state: &AppState, archive_path: &str) -> Result<ThemeRecord> {
    let archive_file = File::open(archive_path)
        .with_context(|| format!("Failed to open theme archive: {}", archive_path))?;
    let mut archive = ZipArchive::new(archive_file)?;
    let temp_dir = TempDir::new()?;
    let allowed_extensions = allowed_theme_extensions();
    let mut total_bytes: u64 = 0;

    for index in 0..archive.len() {
        let mut item = archive.by_index(index)?;
        let raw_name = item.name().replace('\\', "/");
        let relative = Path::new(&raw_name);
        let destination = safe_join(temp_dir.path(), relative)?;

        if item.is_dir() {
            fs::create_dir_all(&destination)?;
            continue;
        }

        if let Some(extension) = relative.extension().and_then(|extension| extension.to_str()) {
            if !allowed_extensions.contains(extension.to_ascii_lowercase().as_str()) {
                return Err(anyhow!("Theme asset extension is not allowed: {}", extension));
            }
        }

        total_bytes += item.size();
        if item.size() > 8 * 1024 * 1024 {
            return Err(anyhow!("Theme asset is too large: {}", raw_name));
        }
        if total_bytes > 64 * 1024 * 1024 {
            return Err(anyhow!("Theme archive exceeds the allowed size budget."));
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut output = File::create(&destination)?;
        io::copy(&mut item, &mut output)?;
    }

    let manifest = validate_theme_directory(temp_dir.path())?;
    let destination = state.paths.themes_dir.join(&manifest.id);

    if destination.exists() {
        return Err(anyhow!("Theme id already exists: {}", manifest.id));
    }

    copy_dir(temp_dir.path(), &destination)?;
    theme_record(state, &manifest.id)
}

fn export_theme_archive(state: &AppState, request: ThemeExportRequest) -> Result<Value> {
    let theme_root = state.paths.themes_dir.join(&request.id);
    validate_theme_directory(&theme_root)?;

    if let Some(parent) = Path::new(&request.out_path).parent() {
        fs::create_dir_all(parent)?;
    }

    let file = File::create(&request.out_path)?;
    let mut archive = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    add_directory_to_zip(&mut archive, &theme_root, &theme_root, options)?;
    archive.finish()?;

    Ok(json!({
        "exported": true,
        "outPath": request.out_path
    }))
}

fn create_theme(state: &AppState, request: CreateThemeRequest) -> Result<ThemeRecord> {
    if !valid_theme_id(&request.id) {
        return Err(anyhow!("Theme id must use only lowercase letters, digits, _ or -."));
    }
    if request.name.trim().is_empty() {
        return Err(anyhow!("Theme name is required."));
    }

    let theme_root = state.paths.themes_dir.join(&request.id);
    if theme_root.exists() {
        return Err(anyhow!("Theme id already exists: {}", request.id));
    }

    fs::create_dir_all(theme_root.join("img"))?;
    fs::create_dir_all(theme_root.join("fonts"))?;

    let mut variables = BTreeMap::from([
        ("--bg".to_string(), "#171110".to_string()),
        ("--panel".to_string(), "#30251f".to_string()),
        ("--panel-strong".to_string(), "#3a2c24".to_string()),
        ("--text".to_string(), "#d8c7b4".to_string()),
        ("--muted".to_string(), "#a69887".to_string()),
        ("--accent".to_string(), "#8a0303".to_string()),
    ]);
    variables.extend(request.variables);

    let manifest = ThemeManifest {
        schema_version: 1,
        id: request.id.clone(),
        name: request.name,
        version: "1.0.0".to_string(),
        author: request.author.unwrap_or_else(|| "User".to_string()),
        description: request.description,
        target_app_version: Some(">=0.1.0".to_string()),
        entry_css: "theme.css".to_string(),
        preview_image: None,
        fonts: Vec::new(),
        variables,
        assets: BTreeMap::new(),
        modes: vec!["dark".to_string()],
        supports_custom_wallpaper: true,
    };

    fs::write(
        theme_root.join("manifest.json"),
        format!("{}\n", serde_json::to_string_pretty(&manifest)?),
    )?;
    fs::write(
        theme_root.join("theme.css"),
        ":root {\n  --frame-texture: none;\n}\n\n.panel,\n.sidebar-card,\n.theme-card,\n.queue-item,\n.log-entry,\n.nav-button {\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 18px 34px -26px rgba(0, 0, 0, 0.62);\n}\n",
    )?;

    theme_record(state, &request.id)
}

fn copy_dir(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_dir(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

fn add_directory_to_zip(
    archive: &mut ZipWriter<File>,
    root: &Path,
    current: &Path,
    options: FileOptions,
) -> Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();

        if entry.file_type()?.is_dir() {
            add_directory_to_zip(archive, root, &path, options)?;
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .ok()
            .and_then(|path| path.to_str())
            .ok_or_else(|| anyhow!("Invalid UTF-8 path in theme export"))?;

        archive.start_file(relative.replace('\\', "/"), options)?;
        let mut file = File::open(&path)?;
        io::copy(&mut file, archive)?;
    }

    Ok(())
}

fn require_binary(state: &AppState, file_name: &str) -> Result<PathBuf> {
    let binary = state.paths.libs_dir.join(file_name);
    if !binary.exists() {
        return Err(anyhow!("Missing required binary: {}", file_name));
    }
    Ok(binary)
}

fn build_tool_command(state: &AppState, program: &Path) -> Command {
    let mut command = Command::new(program);
    let mut path_entries = vec![state.paths.libs_dir.clone()];
    if let Some(existing) = std::env::var_os("PATH") {
        path_entries.extend(std::env::split_paths(&existing));
    }
    command.current_dir(&state.paths.app_root);
    if let Ok(joined) = std::env::join_paths(path_entries) {
        command.env("PATH", joined);
    }
    command
}

fn network_args(network: &Option<NetworkSettings>) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(network) = network {
        if matches!(network.strategy, NetworkStrategy::Proxy) {
            if let Some(proxy_url) = &network.proxy_url {
                if !proxy_url.trim().is_empty() {
                    args.push("--proxy".to_string());
                    args.push(proxy_url.clone());
                }
            }
        }

        if let Some(impersonate) = &network.impersonate {
            if !impersonate.trim().is_empty() {
                args.push("--impersonate".to_string());
                args.push(impersonate.clone());
            }
        }

        if let Some(cookies) = &network.cookies_from_browser {
            if !cookies.trim().is_empty() {
                args.push("--cookies-from-browser".to_string());
                args.push(cookies.clone());
            }
        }
    }

    args
}

fn classify_yt_dlp_error(stderr: &str) -> AppError {
    let message = stderr.trim().to_string();
    let lowered = message.to_ascii_lowercase();

    if lowered.contains("not a bot") || lowered.contains("sign in to confirm") {
        return app_error("DOWNLOAD_ERROR", if message.is_empty() {
            "Server-side anti-bot challenge encountered."
        } else {
            &message
        })
        .with_details(json!({ "category": "ANTI_BOT" }));
    }

    if lowered.contains("timed out") || lowered.contains("connection") || lowered.contains("proxy") {
        return app_error("DOWNLOAD_ERROR", if message.is_empty() {
            "Network transport failed."
        } else {
            &message
        })
        .with_details(json!({ "category": "NETWORK" }));
    }

    app_error(
        "DOWNLOAD_ERROR",
        if message.is_empty() {
            "yt-dlp returned a non-zero exit code."
        } else {
            &message
        },
    )
}

fn analyze_url(state: &AppState, request: AnalyzeRequest) -> Result<AnalyzeResult> {
    require_valid_url(&request.url)?;
    let yt_dlp = require_binary(state, "yt-dlp.exe")?;
    if request.url.contains("youtube.com") || request.url.contains("youtu.be") {
        let _ = require_binary(state, "deno.exe")?;
    }

    let mut args = vec![
        "--dump-single-json".to_string(),
        "--no-warnings".to_string(),
        "--skip-download".to_string(),
    ];
    args.extend(network_args(&request.network));
    args.push(request.url.clone());

    let output = build_tool_command(state, &yt_dlp)
        .args(args)
        .output()?;

    if !output.status.success() {
        return Err(anyhow!(classify_yt_dlp_error(
            String::from_utf8_lossy(&output.stderr).as_ref()
        )
        .message));
    }

    let parsed: Value = serde_json::from_slice(&output.stdout)?;
    let formats = parsed
        .get("formats")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(24)
        .map(|format| AnalyzeFormat {
            id: format
                .get("format_id")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            ext: format.get("ext").and_then(Value::as_str).map(ToString::to_string),
            resolution: format
                .get("resolution")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            note: format
                .get("format_note")
                .or_else(|| format.get("acodec"))
                .and_then(Value::as_str)
                .map(ToString::to_string),
            audio_only: format.get("vcodec").and_then(Value::as_str) == Some("none"),
            video_only: format.get("acodec").and_then(Value::as_str) == Some("none"),
        })
        .collect::<Vec<_>>();

    Ok(AnalyzeResult {
        url: request.url.clone(),
        webpage_url: parsed
            .get("webpage_url")
            .and_then(Value::as_str)
            .unwrap_or(&request.url)
            .to_string(),
        extractor: parsed
            .get("extractor_key")
            .or_else(|| parsed.get("extractor"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        title: parsed
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled")
            .to_string(),
        duration_seconds: parsed.get("duration").and_then(Value::as_f64),
        thumbnail_url: parsed
            .get("thumbnail")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        uploader: parsed
            .get("uploader")
            .or_else(|| parsed.get("channel"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        formats,
    })
}

fn maybe_number(raw: &str) -> Option<f64> {
    let filtered = raw
        .chars()
        .filter(|character| character.is_ascii_digit() || *character == '.' || *character == '-')
        .collect::<String>();
    filtered.parse::<f64>().ok()
}

fn parse_human_speed(raw: &str) -> Option<u64> {
    let trimmed = raw.trim();
    let number = trimmed
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect::<String>()
        .parse::<f64>()
        .ok()?;
    let suffix = trimmed
        .chars()
        .skip_while(|character| character.is_ascii_digit() || *character == '.' || character.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();

    let multiplier = match suffix.as_str() {
        "B/S" => 1.0,
        "KB/S" => 1_000.0,
        "MB/S" => 1_000_000.0,
        "GB/S" => 1_000_000_000.0,
        "KIB/S" => 1_024.0,
        "MIB/S" => 1_048_576.0,
        "GIB/S" => 1_073_741_824.0,
        _ => 1.0,
    };

    Some((number * multiplier).round() as u64)
}

fn start_download(state: &AppState, request: DownloadRequest) -> Result<Value> {
    require_valid_url(&request.url)?;

    if request.id.trim().is_empty() || request.output_dir.trim().is_empty() {
        return Err(anyhow!("Download payload must include id and outputDir."));
    }

    if state
        .downloads
        .lock()
        .expect("downloads lock poisoned")
        .contains_key(&request.id)
    {
        return Err(anyhow!("Download id already exists: {}", request.id));
    }

    let yt_dlp = require_binary(state, "yt-dlp.exe")?;
    let ffmpeg = require_binary(state, "ffmpeg.exe")?;
    if request.url.contains("youtube.com") || request.url.contains("youtu.be") {
        let _ = require_binary(state, "deno.exe")?;
    }

    fs::create_dir_all(&request.output_dir)?;

    let mut args = vec![
        "--newline".to_string(),
        "--no-warnings".to_string(),
        "--progress-template".to_string(),
        "download:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s".to_string(),
        "--ffmpeg-location".to_string(),
        ffmpeg.display().to_string(),
    ];
    args.extend(network_args(&request.network));
    args.push("--output".to_string());
    args.push(
        Path::new(&request.output_dir)
            .join("%(title).180B [%(id)s].%(ext)s")
            .display()
            .to_string(),
    );

    match request.preset {
        DownloadPreset::Mp3 => args.extend(["-x", "--audio-format", "mp3"].into_iter().map(str::to_string)),
        DownloadPreset::Best => args.extend(["-f", "bv*+ba/b", "--merge-output-format", "mp4"].into_iter().map(str::to_string)),
    }
    args.push(request.url.clone());

    emit_event(
        state,
        "download.queued",
        json!({
            "id": request.id,
            "preset": request.preset,
            "url": request.url
        }),
    );

    let mut command = build_tool_command(state, &yt_dlp);
    let mut child = command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().ok_or_else(|| anyhow!("yt-dlp stdout not available"))?;
    let stderr = child.stderr.take().ok_or_else(|| anyhow!("yt-dlp stderr not available"))?;
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let output_path = Arc::new(Mutex::new(None::<String>));

    state.downloads.lock().expect("downloads lock poisoned").insert(
        request.id.clone(),
        ActiveDownload {
            child: Arc::clone(&child),
            cancelled: Arc::clone(&cancelled),
        },
    );

    emit_event(state, "download.started", json!({ "id": request.id }));

    {
        let state = state.clone();
        let download_id = request.id.clone();
        let output_path = Arc::clone(&output_path);
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(std::result::Result::ok) {
                let trimmed = line.trim().to_string();
                if trimmed.starts_with("download:") {
                    let parts = trimmed.split('|').collect::<Vec<_>>();
                    if parts.len() >= 5 {
                        emit_event(
                            &state,
                            "download.progress",
                            json!({
                                "id": download_id,
                                "percent": maybe_number(parts[0].trim_start_matches("download:")),
                                "downloadedBytes": maybe_number(parts[1]),
                                "totalBytes": maybe_number(parts[2]),
                                "speedBytesPerSecond": parse_human_speed(parts[3]),
                                "etaSeconds": maybe_number(parts[4]),
                                "stage": "download",
                                "message": trimmed
                            }),
                        );
                    }
                    continue;
                }

                if let Some(path) = trimmed
                    .strip_prefix("Destination: ")
                    .or_else(|| trimmed.strip_prefix("Merging formats into \""))
                {
                    let clean = path.trim_matches('"').to_string();
                    *output_path.lock().expect("output path lock poisoned") = Some(clean);
                }
            }
        });
    }

    {
        let state = state.clone();
        let download_id = request.id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(std::result::Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                emit_event(
                    &state,
                    "download.progress",
                    json!({
                        "id": download_id,
                        "percent": Value::Null,
                        "downloadedBytes": Value::Null,
                        "totalBytes": Value::Null,
                        "speedBytesPerSecond": Value::Null,
                        "etaSeconds": Value::Null,
                        "stage": "stderr",
                        "message": line
                    }),
                );
            }
        });
    }

    {
        let state = state.clone();
        let request = request.clone();
        let child = Arc::clone(&child);
        let cancelled = Arc::clone(&cancelled);
        let output_path = Arc::clone(&output_path);
        thread::spawn(move || {
            let status = child
                .lock()
                .expect("child lock poisoned")
                .wait()
                .ok();

            state
                .downloads
                .lock()
                .expect("downloads lock poisoned")
                .remove(&request.id);

            if cancelled.load(Ordering::SeqCst) {
                emit_event(&state, "download.cancelled", json!({ "id": request.id }));
                return;
            }

            if status.as_ref().is_some_and(|status| status.success()) {
                emit_event(
                    &state,
                    "download.completed",
                    json!({
                        "id": request.id,
                        "outputPath": output_path.lock().expect("output path lock poisoned").clone(),
                        "message": "Payload secured"
                    }),
                );
                return;
            }

            let code = status.and_then(|status| status.code());
            emit_event(
                &state,
                "download.failed",
                json!({
                    "id": request.id,
                    "error": classify_yt_dlp_error(&format!("yt-dlp exited with code {}", code.unwrap_or(-1)))
                }),
            );
        });
    }

    Ok(json!({
        "accepted": true,
        "id": request.id
    }))
}

fn cancel_download(state: &AppState, request: ThemeIdRequest) -> Result<Value> {
    if let Some(active) = state
        .downloads
        .lock()
        .expect("downloads lock poisoned")
        .get(&request.id)
    {
        active.cancelled.store(true, Ordering::SeqCst);
        let _ = active.child.lock().expect("child lock poisoned").kill();
        return Ok(json!({ "cancelled": true, "id": request.id }));
    }

    Ok(json!({ "cancelled": false, "id": request.id }))
}

fn dispatch_request(state: &AppState, request: RequestEnvelope) -> Result<Value, AppError> {
    match request.method.as_str() {
        "system.ping" => Ok(json!({
            "status": "ok",
            "engine": "rust",
            "version": env!("CARGO_PKG_VERSION")
        })),
        "theme.list" => serde_json::to_value(list_themes(state).map_err(|error| app_error("THEME_ERROR", error.to_string()))?)
            .map_err(|error| app_error("UNKNOWN", error.to_string())),
        "theme.apply" => {
            let theme_request: ThemeIdRequest =
                serde_json::from_value(request.params).map_err(|error| app_error("VALIDATION_ERROR", error.to_string()))?;
            let mut settings = state.settings.lock().expect("settings lock poisoned").clone();
            settings.active_theme_id = theme_request.id.clone();
            persist_settings(state, &settings).map_err(|error| app_error("IO_ERROR", error.to_string()))?;
            let record = theme_record(state, &theme_request.id).map_err(|error| app_error("THEME_ERROR", error.to_string()))?;
            emit_event(state, "theme.applied", json!({ "theme": record }));
            serde_json::to_value(record).map_err(|error| app_error("UNKNOWN", error.to_string()))
        }
        "theme.import" => {
            let import_request: ThemeImportRequest =
                serde_json::from_value(request.params).map_err(|error| app_error("VALIDATION_ERROR", error.to_string()))?;
            let record =
                import_theme_archive(state, &import_request.file_path).map_err(|error| app_error("THEME_ERROR", error.to_string()))?;
            serde_json::to_value(record).map_err(|error| app_error("UNKNOWN", error.to_string()))
        }
        "theme.export" => {
            let export_request: ThemeExportRequest =
                serde_json::from_value(request.params).map_err(|error| app_error("VALIDATION_ERROR", error.to_string()))?;
            export_theme_archive(state, export_request).map_err(|error| app_error("THEME_ERROR", error.to_string()))
        }
        "theme.create" => {
            let create_request: CreateThemeRequest =
                serde_json::from_value(request.params).map_err(|error| app_error("VALIDATION_ERROR", error.to_string()))?;
            let record = create_theme(state, create_request).map_err(|error| app_error("THEME_ERROR", error.to_string()))?;
            serde_json::to_value(record).map_err(|error| app_error("UNKNOWN", error.to_string()))
        }
        "download.analyze" => {
            let analyze_request: AnalyzeRequest =
                serde_json::from_value(request.params).map_err(|error| app_error("VALIDATION_ERROR", error.to_string()))?;
            let result = analyze_url(state, analyze_request).map_err(|error| map_download_request_error(state, error))?;
            serde_json::to_value(result).map_err(|error| app_error("UNKNOWN", error.to_string()))
        }
        "download.start" => {
            let download_request: DownloadRequest =
                serde_json::from_value(request.params).map_err(|error| app_error("VALIDATION_ERROR", error.to_string()))?;
            start_download(state, download_request).map_err(|error| map_download_request_error(state, error))
        }
        "download.cancel" => {
            let cancel_request: ThemeIdRequest =
                serde_json::from_value(request.params).map_err(|error| app_error("VALIDATION_ERROR", error.to_string()))?;
            cancel_download(state, cancel_request).map_err(|error| app_error("DOWNLOAD_ERROR", error.to_string()))
        }
        _ => Err(app_error("UNKNOWN", format!("Unknown sidecar method: {}", request.method))),
    }
}

fn main() -> Result<()> {
    let paths = runtime_paths()?;
    ensure_layout(&paths)?;

    let state = AppState {
        settings: Arc::new(Mutex::new(load_settings(&paths))),
        writer: Arc::new(Mutex::new(BufWriter::new(io::stdout()))),
        downloads: Arc::new(Mutex::new(HashMap::new())),
        paths,
    };

    let stdin = io::stdin();
    let reader = BufReader::new(stdin.lock());

    for line in reader.lines() {
        let line = match line {
            Ok(line) if !line.trim().is_empty() => line,
            Ok(_) => continue,
            Err(error) => {
                emit_event(&state, "system.error", json!({ "error": app_error("UNKNOWN", error.to_string()) }));
                continue;
            }
        };

        let request = match serde_json::from_str::<RequestEnvelope>(&line) {
            Ok(request) => request,
            Err(error) => {
                let _ = send_error(
                    &state.writer,
                    "unknown".to_string(),
                    app_error("VALIDATION_ERROR", error.to_string()),
                );
                continue;
            }
        };

        let request_id = request.id.clone();

        match dispatch_request(&state, request) {
            Ok(result) => {
                let _ = send_result(&state.writer, request_id, result);
            }
            Err(error) => {
                let _ = send_error(&state.writer, request_id, error);
            }
        }
    }

    Ok(())
}
