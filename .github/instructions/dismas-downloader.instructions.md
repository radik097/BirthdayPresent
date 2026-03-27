---
title: DISMAS DOWNLOADER — Project Build Instructions
scope: global
appliesTo:
  - "dismas-downloader/**"
ruleType: hard
---

# DISMAS DOWNLOADER — Project Build Instructions

## Контекст проекта
Ты работаешь над десктопным приложением "Dismas Downloader" — GUI-оберткой над yt-dlp с эстетикой Darkest Dungeon. Стек: Electron (фронтенд) + Rust через NAPI-RS (нативный бэкенд) + yt-dlp/ffmpeg как бандлованные бинарники.

## Структура репозитория
```
dismas-downloader/
├── src/                  # Renderer: HTML/JS/CSS (gothic UI)
│   ├── index.html
│   ├── renderer.js
│   └── styles.css
├── src-native/           # Rust crate (NAPI-RS)
│   ├── Cargo.toml
│   └── src/lib.rs
├── bin/                  # Prebundled binaries (не коммитить в git)
│   ├── yt-dlp.exe
│   └── ffmpeg.exe
├── main.js               # Electron main process
├── preload.js            # Context bridge
├── package.json
└── electron-builder.yml
```

## Ключевые правила разработки

### Rust (src-native)
- Использовать `napi-rs` версии 2.x, `napi-derive` для экспорта функций
- Функция `download_video(url, save_path, bin_path)` возвращает `String` со статусом
- Для прогресса использовать `spawn` + парсинг stdout вместо `output()` (блокирующий)
- Обработка ошибок через `napi::Result`, не паниковать
- Компиляция: `npx napi build --platform --release` в `src-native/`

### Electron (main process)
- Всегда проверять `app.isPackaged` для путей к бинарникам
- Путь к yt-dlp: `process.resourcesPath` (packaged) или `__dirname/bin` (dev)
- IPC через `ipcMain.handle` / `contextBridge.exposeInMainWorld`
- Никаких `nodeIntegration: true` — только preload + contextBridge
- Логировать каждую загрузку в SQLite: url, timestamp, status, filesize

### Frontend (gothic UI)
- Палитра: темный фон (#1a1008), золотой акцент (#c8a84b), кровавый (#8b1a1a)
- Шрифт: Mason или Goudy Bookletter (googleapis или локально)
- Анимации: флуктуация факела, пыль при загрузке
- Все статусы — в стиле Darkest Dungeon: "The abyss consumes...", "A hollow victory"

### Упаковка (electron-builder)
- `extraResources`: папка `bin/` → `resources/bin/`
- Фильтр: только `.exe` и `.dll` для Windows-таргета
- NSIS installer, одна директория установки
- `native-module.node` включать в `files[]`

### Автообновление yt-dlp
- При старте приложения: `yt-dlp --update` в фоне (не блокировать UI)
- Результат обновления писать в лог

### SQLite лог
- Таблица `expeditions`: id, url, title, status, filesize_mb, timestamp
- Экран "Журнал походов" в UI — таблица с фильтром по статусу
- Использовать `better-sqlite3` (синхронный, подходит для Electron main process)

## Запрещено
- Не использовать `shell: true` в Command без санитизации URL
- Не хранить пути хардкодом — только через `app.getPath()` и `process.resourcesPath`
- Не вызывать нативные функции Rust напрямую из renderer — только через IPC
