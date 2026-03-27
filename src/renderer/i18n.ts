export type UiLocale = "ru" | "en";

type TranslationKey =
  | "app.shell"
  | "app.subtitle"
  | "app.legal"
  | "lang.label"
  | "lang.ru"
  | "lang.en"
  | "nav.downloader"
  | "nav.queue"
  | "nav.themes"
  | "theme.activeEyebrow"
  | "theme.awaiting"
  | "theme.noActive"
  | "theme.fallbackDescription"
  | "theme.apply"
  | "theme.active"
  | "theme.noPreview"
  | "theme.noDescription"
  | "network.eyebrow"
  | "network.title"
  | "network.route"
  | "network.proxy"
  | "network.impersonate"
  | "network.cookies"
  | "network.hint"
  | "network.direct"
  | "network.proxyMode"
  | "network.systemBypass"
  | "system.eyebrow"
  | "system.title"
  | "system.scanning"
  | "system.modeCopy"
  | "system.repair"
  | "system.repairing"
  | "system.capPending"
  | "system.noDiag"
  | "system.details"
  | "system.openSource"
  | "system.noHint"
  | "status.portable"
  | "status.secure"
  | "status.mode"
  | "status.noBlockers"
  | "status.blockers"
  | "status.ready"
  | "status.limited"
  | "availability.ready"
  | "availability.fallback"
  | "availability.warning"
  | "availability.missing"
  | "downloader.eyebrow"
  | "downloader.title"
  | "downloader.url"
  | "downloader.urlPlaceholder"
  | "downloader.previewEmpty"
  | "downloader.previewLabel"
  | "downloader.noPreview"
  | "downloader.duration"
  | "downloader.durationUnknown"
  | "downloader.formats"
  | "downloader.analyze"
  | "player.youtube"
  | "player.video"
  | "player.poster"
  | "player.openSource"
  | "player.embedHint"
  | "player.posterHint"
  | "download.eyebrow"
  | "download.title"
  | "download.output"
  | "download.outputPlaceholder"
  | "download.preset"
  | "download.best"
  | "download.mp3"
  | "download.start"
  | "download.noTask"
  | "download.task"
  | "download.awaiting"
  | "download.cancel"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "queue.eyebrow"
  | "queue.title"
  | "queue.empty"
  | "library.eyebrow"
  | "library.title"
  | "library.empty"
  | "library.play"
  | "library.fileMissing"
  | "library.path"
  | "library.published"
  | "library.downloaded"
  | "library.duration"
  | "library.unknownDate"
  | "library.unknownDuration"
  | "log.toggle"
  | "log.eyebrow"
  | "log.title"
  | "log.empty"
  | "themes.eyebrow"
  | "themes.title"
  | "themes.empty"
  | "workshop.eyebrow"
  | "workshop.title"
  | "workshop.importPath"
  | "workshop.importPlaceholder"
  | "workshop.import"
  | "workshop.exportId"
  | "workshop.exportPath"
  | "workshop.exportPlaceholder"
  | "workshop.export"
  | "workshop.createId"
  | "workshop.createName"
  | "workshop.createDescription"
  | "workshop.createAccent"
  | "workshop.create"
  | "notice.none"
  | "error.unknownRenderer"
  | "error.missingBinaryTitle"
  | "error.missingBinaryHelp1"
  | "error.missingBinaryHelp2"
  | "error.engineOfflineTitle"
  | "error.engineOfflineHelp1"
  | "error.engineOfflineHelp2"
  | "error.antiBotTitle"
  | "error.antiBotHelp1"
  | "error.antiBotHelp2"
  | "error.antiBotHelp3"
  | "error.networkTitle"
  | "error.networkHelp1"
  | "error.networkHelp2"
  | "error.networkHelp3"
  | "error.themeTitle"
  | "error.themeHelp1"
  | "error.themeHelp2"
  | "error.systemTitle"
  | "hint.antiBot"
  | "hint.network"
  | "hint.deno"
  | "log.sourceOpened"
  | "log.analyzeSuccess"
  | "log.taskAccepted"
  | "log.cancelOrdered"
  | "log.themeApplied"
  | "log.themeImported"
  | "log.themeCreated"
  | "log.themeExported"
  | "log.themesLoaded"
  | "log.repairDone"
  | "log.urlRequired"
  | "log.urlOutputRequired"
  | "notice.autoRepairTitle"
  | "notice.autoRepairMessage"
  | "common.unknownUploader"
  | "common.unknownExtractor";

const translations: Record<UiLocale, Record<TranslationKey, string>> = {
  en: {
    "app.shell": "Portable Shell",
    "app.subtitle": "Minimal portable downloader with local themes and safe recovery paths.",
    "app.legal": "Use only for media you are allowed to download or archive.",
    "lang.label": "Language",
    "lang.ru": "Russian",
    "lang.en": "English",
    "nav.downloader": "Downloader",
    "nav.queue": "Queue",
    "nav.themes": "Themes",
    "theme.activeEyebrow": "Active Theme",
    "theme.awaiting": "No theme yet",
    "theme.noActive": "Apply a theme to update the shell.",
    "theme.fallbackDescription": "A portable skin is holding the shell together.",
    "theme.apply": "Apply",
    "theme.active": "Active",
    "theme.noPreview": "No preview",
    "theme.noDescription": "No description.",
    "network.eyebrow": "Advanced",
    "network.title": "Network",
    "network.route": "Route",
    "network.proxy": "Proxy URL",
    "network.impersonate": "Impersonate",
    "network.cookies": "Cookies From Browser",
    "network.hint": "System bypass expects an external proxy or DPI bypass already configured on the machine.",
    "network.direct": "Direct",
    "network.proxyMode": "Proxy",
    "network.systemBypass": "System bypass",
    "system.eyebrow": "System",
    "system.title": "Health",
    "system.scanning": "Scanning portable layout",
    "system.modeCopy": "Checking sidecar mode, binaries, themes, and notices.",
    "system.repair": "Repair Missing Tools",
    "system.repairing": "Repairing Tools...",
    "system.capPending": "Capabilities pending.",
    "system.noDiag": "No diagnostics yet.",
    "system.details": "Details",
    "system.openSource": "Open Source",
    "system.noHint": "No recovery hint recorded.",
    "status.portable": "Portable",
    "status.secure": "Isolated",
    "status.mode": "Mode: {mode}",
    "status.noBlockers": "No blockers",
    "status.blockers": "{count} blocker(s)",
    "status.ready": "ready",
    "status.limited": "limited",
    "availability.ready": "Ready",
    "availability.fallback": "Fallback",
    "availability.warning": "Attention",
    "availability.missing": "Missing",
    "downloader.eyebrow": "Source",
    "downloader.title": "Link",
    "downloader.url": "Video URL",
    "downloader.urlPlaceholder": "https://example.com/watch?v=...",
    "downloader.previewEmpty": "No preview yet.",
    "downloader.previewLabel": "Preview",
    "downloader.noPreview": "No preview",
    "downloader.duration": "Duration: {value}",
    "downloader.durationUnknown": "unknown",
    "downloader.formats": "Formats: {count}",
    "downloader.analyze": "Analyze",
    "player.youtube": "YouTube player",
    "player.video": "Video preview",
    "player.poster": "Preview only",
    "player.openSource": "Open Source",
    "player.embedHint": "This source can play inside the app.",
    "player.posterHint": "This source does not expose a safe inline player. Open the page or download the file.",
    "download.eyebrow": "Save",
    "download.title": "Download",
    "download.output": "Output Folder",
    "download.outputPlaceholder": "C:\\Users\\you\\Downloads",
    "download.preset": "Preset",
    "download.best": "Best Video + Audio",
    "download.mp3": "Audio Only MP3",
    "download.start": "Download",
    "download.noTask": "No active task.",
    "download.task": "Task {id}",
    "download.awaiting": "Waiting",
    "download.cancel": "Cancel",
    "task.completed": "Completed",
    "task.failed": "Failed",
    "task.cancelled": "Cancelled",
    "queue.eyebrow": "Queue",
    "queue.title": "Tasks",
    "queue.empty": "No tasks yet.",
    "library.eyebrow": "Library",
    "library.title": "Downloaded",
    "library.empty": "No downloaded videos yet.",
    "library.play": "Play",
    "library.fileMissing": "File missing",
    "library.path": "Path",
    "library.published": "Published",
    "library.downloaded": "Downloaded",
    "library.duration": "Length",
    "library.unknownDate": "unknown",
    "library.unknownDuration": "unknown",
    "log.toggle": "Event Log",
    "log.eyebrow": "Log",
    "log.title": "Events",
    "log.empty": "No messages yet.",
    "themes.eyebrow": "Themes",
    "themes.title": "Installed",
    "themes.empty": "No themes discovered.",
    "workshop.eyebrow": "Workshop",
    "workshop.title": "Import / Export",
    "workshop.importPath": "Theme Archive",
    "workshop.importPlaceholder": "C:\\themes\\my-theme.ydtheme",
    "workshop.import": "Import",
    "workshop.exportId": "Theme ID",
    "workshop.exportPath": "Export Path",
    "workshop.exportPlaceholder": "C:\\themes\\darkest.ydtheme",
    "workshop.export": "Export",
    "workshop.createId": "Theme ID",
    "workshop.createName": "Name",
    "workshop.createDescription": "Description",
    "workshop.createAccent": "Accent",
    "workshop.create": "Create",
    "notice.none": "No active notices.",
    "error.unknownRenderer": "Unknown renderer error.",
    "error.missingBinaryTitle": "Missing Binary",
    "error.missingBinaryHelp1": "Put the missing executable into libs/.",
    "error.missingBinaryHelp2": "Run system check again after copying the file.",
    "error.engineOfflineTitle": "Download Engine Offline",
    "error.engineOfflineHelp1": "The app can fall back to its embedded JS backend when possible.",
    "error.engineOfflineHelp2": "If you want the native path, build downloader-core.exe and place it in libs/.",
    "error.antiBotTitle": "Provider Anti-Bot Challenge",
    "error.antiBotHelp1": "Try cookies from browser.",
    "error.antiBotHelp2": "Try impersonation.",
    "error.antiBotHelp3": "Try a different network path.",
    "error.networkTitle": "Network Problem",
    "error.networkHelp1": "Check the proxy URL.",
    "error.networkHelp2": "Switch back to Direct mode to isolate the failure.",
    "error.networkHelp3": "If you use System DPI bypass, verify that the external tool is already configured.",
    "error.themeTitle": "Theme Problem",
    "error.themeHelp1": "Check manifest.json and entryCss.",
    "error.themeHelp2": "Avoid ../ in theme asset paths.",
    "error.systemTitle": "System Message",
    "hint.antiBot": "This looks like a server-side anti-bot barrier. Try cookies, impersonation, or a different network path.",
    "hint.network": "Network transport may be the real cause here. Check proxy settings or fall back to direct mode.",
    "hint.deno": "YouTube support expects a JavaScript runtime sidecar. Place Deno in libs/ before testing those flows.",
    "log.sourceOpened": "Opened source URL: {url}",
    "log.analyzeSuccess": "Analysis completed for {title}.",
    "log.taskAccepted": "Task {id} queued.",
    "log.cancelOrdered": "Cancellation requested for task {id}.",
    "log.themeApplied": "Theme {name} applied.",
    "log.themeImported": "Imported theme {name}.",
    "log.themeCreated": "Created theme {name}.",
    "log.themeExported": "Theme {id} exported to {path}.",
    "log.themesLoaded": "Themes loaded.",
    "log.repairDone": "Portable tool repair finished.",
    "log.urlRequired": "Enter a URL before starting.",
    "log.urlOutputRequired": "URL and output folder are required.",
    "notice.autoRepairTitle": "Automatic Runtime Repair",
    "notice.autoRepairMessage": "The app detected missing portable tools and started repairing them.",
    "common.unknownUploader": "Unknown uploader",
    "common.unknownExtractor": "Unknown extractor"
  },
  ru: {
    "app.shell": "Портативная оболочка",
    "app.subtitle": "Минималистичный portable-загрузчик с локальными темами и безопасными путями восстановления.",
    "app.legal": "Используй только для медиа, которое тебе разрешено скачивать или архивировать.",
    "lang.label": "Язык",
    "lang.ru": "Русский",
    "lang.en": "English",
    "nav.downloader": "Загрузка",
    "nav.queue": "Очередь",
    "nav.themes": "Темы",
    "theme.activeEyebrow": "Активная тема",
    "theme.awaiting": "Тема не выбрана",
    "theme.noActive": "Примени тему, чтобы обновить интерфейс.",
    "theme.fallbackDescription": "Портативная тема удерживает оболочку в рабочем состоянии.",
    "theme.apply": "Применить",
    "theme.active": "Активна",
    "theme.noPreview": "Нет превью",
    "theme.noDescription": "Без описания.",
    "network.eyebrow": "Дополнительно",
    "network.title": "Сеть",
    "network.route": "Маршрут",
    "network.proxy": "URL прокси",
    "network.impersonate": "Имперсонация",
    "network.cookies": "Cookies из браузера",
    "network.hint": "System bypass предполагает, что внешний прокси или DPI bypass уже настроен в системе.",
    "network.direct": "Напрямую",
    "network.proxyMode": "Прокси",
    "network.systemBypass": "System bypass",
    "system.eyebrow": "Система",
    "system.title": "Состояние",
    "system.scanning": "Проверка portable-структуры",
    "system.modeCopy": "Проверяем sidecar, бинарники, темы и уведомления.",
    "system.repair": "Исправить инструменты",
    "system.repairing": "Исправление...",
    "system.capPending": "Возможности ещё проверяются.",
    "system.noDiag": "Диагностика пока пуста.",
    "system.details": "Детали",
    "system.openSource": "Открыть источник",
    "system.noHint": "Подсказка по восстановлению не записана.",
    "status.portable": "Portable",
    "status.secure": "Изоляция",
    "status.mode": "Режим: {mode}",
    "status.noBlockers": "Без блокеров",
    "status.blockers": "Блокеров: {count}",
    "status.ready": "готово",
    "status.limited": "ограничено",
    "availability.ready": "Готово",
    "availability.fallback": "Fallback",
    "availability.warning": "Внимание",
    "availability.missing": "Отсутствует",
    "downloader.eyebrow": "Источник",
    "downloader.title": "Ссылка",
    "downloader.url": "Ссылка на видео",
    "downloader.urlPlaceholder": "https://example.com/watch?v=...",
    "downloader.previewEmpty": "Пока нет превью.",
    "downloader.previewLabel": "Превью",
    "downloader.noPreview": "Нет превью",
    "downloader.duration": "Длительность: {value}",
    "downloader.durationUnknown": "неизвестно",
    "downloader.formats": "Форматов: {count}",
    "downloader.analyze": "Проверить",
    "player.youtube": "YouTube-плеер",
    "player.video": "Видео-превью",
    "player.poster": "Только превью",
    "player.openSource": "Открыть источник",
    "player.embedHint": "Этот источник можно воспроизвести прямо в приложении.",
    "player.posterHint": "Источник не отдаёт безопасный inline-плеер. Открой страницу или сначала скачай файл.",
    "download.eyebrow": "Сохранение",
    "download.title": "Скачать",
    "download.output": "Папка вывода",
    "download.outputPlaceholder": "C:\\Users\\you\\Downloads",
    "download.preset": "Пресет",
    "download.best": "Лучшее видео + аудио",
    "download.mp3": "Только аудио MP3",
    "download.start": "Скачать",
    "download.noTask": "Нет активной задачи.",
    "download.task": "Задача {id}",
    "download.awaiting": "Ожидание",
    "download.cancel": "Отменить",
    "task.completed": "Завершено",
    "task.failed": "Ошибка",
    "task.cancelled": "Отменено",
    "queue.eyebrow": "Очередь",
    "queue.title": "Задачи",
    "queue.empty": "Пока нет задач.",
    "library.eyebrow": "Библиотека",
    "library.title": "Скачанное",
    "library.empty": "Скачанных видео пока нет.",
    "library.play": "Запустить",
    "library.fileMissing": "Файл не найден",
    "library.path": "Путь",
    "library.published": "Дата видео",
    "library.downloaded": "Скачано",
    "library.duration": "Длительность",
    "library.unknownDate": "неизвестно",
    "library.unknownDuration": "неизвестно",
    "log.toggle": "Журнал событий",
    "log.eyebrow": "Лог",
    "log.title": "События",
    "log.empty": "Сообщений пока нет.",
    "themes.eyebrow": "Темы",
    "themes.title": "Установленные",
    "themes.empty": "Темы не найдены.",
    "workshop.eyebrow": "Мастерская",
    "workshop.title": "Импорт / экспорт",
    "workshop.importPath": "Архив темы",
    "workshop.importPlaceholder": "C:\\themes\\my-theme.ydtheme",
    "workshop.import": "Импорт",
    "workshop.exportId": "ID темы",
    "workshop.exportPath": "Путь экспорта",
    "workshop.exportPlaceholder": "C:\\themes\\darkest.ydtheme",
    "workshop.export": "Экспорт",
    "workshop.createId": "ID темы",
    "workshop.createName": "Название",
    "workshop.createDescription": "Описание",
    "workshop.createAccent": "Акцент",
    "workshop.create": "Создать",
    "notice.none": "Активных уведомлений нет.",
    "error.unknownRenderer": "Неизвестная ошибка renderer.",
    "error.missingBinaryTitle": "Не найден бинарник",
    "error.missingBinaryHelp1": "Положи отсутствующий исполняемый файл в libs/.",
    "error.missingBinaryHelp2": "После копирования снова запусти системную проверку.",
    "error.engineOfflineTitle": "Движок загрузки недоступен",
    "error.engineOfflineHelp1": "Приложение может перейти на встроенный JS fallback, если это возможно.",
    "error.engineOfflineHelp2": "Если нужен нативный путь, собери downloader-core.exe и положи его в libs/.",
    "error.antiBotTitle": "Anti-bot защита провайдера",
    "error.antiBotHelp1": "Попробуй cookies из браузера.",
    "error.antiBotHelp2": "Попробуй impersonation.",
    "error.antiBotHelp3": "Попробуй другой сетевой маршрут.",
    "error.networkTitle": "Сетевая проблема",
    "error.networkHelp1": "Проверь URL прокси.",
    "error.networkHelp2": "Переключись обратно на Direct, чтобы локализовать проблему.",
    "error.networkHelp3": "Если используешь System DPI bypass, проверь, что внешний инструмент уже настроен.",
    "error.themeTitle": "Проблема темы",
    "error.themeHelp1": "Проверь manifest.json и entryCss.",
    "error.themeHelp2": "Не используй ../ в путях темы.",
    "error.systemTitle": "Системное сообщение",
    "hint.antiBot": "Похоже на серверный anti-bot барьер. Попробуй cookies, impersonation или другой сетевой маршрут.",
    "hint.network": "Проблема может быть именно в сети. Проверь прокси или вернись на прямое подключение.",
    "hint.deno": "Для YouTube нужен sidecar JavaScript runtime. Положи Deno в libs/ перед тестом этих сценариев.",
    "log.sourceOpened": "Открыт URL источника: {url}",
    "log.analyzeSuccess": "Анализ завершён для {title}.",
    "log.taskAccepted": "Задача {id} поставлена в очередь.",
    "log.cancelOrdered": "Запрошена отмена задачи {id}.",
    "log.themeApplied": "Тема {name} применена.",
    "log.themeImported": "Тема {name} импортирована.",
    "log.themeCreated": "Тема {name} создана.",
    "log.themeExported": "Тема {id} экспортирована в {path}.",
    "log.themesLoaded": "Темы загружены.",
    "log.repairDone": "Восстановление инструментов завершено.",
    "log.urlRequired": "Сначала введи ссылку.",
    "log.urlOutputRequired": "Нужны ссылка и папка вывода.",
    "notice.autoRepairTitle": "Автовосстановление инструментов",
    "notice.autoRepairMessage": "Приложение нашло отсутствующие portable-инструменты и начало их восстанавливать.",
    "common.unknownUploader": "Неизвестный автор",
    "common.unknownExtractor": "Неизвестный extractor"
  }
};

export const LOCALE_STORAGE_KEY = "dismas:locale";

export function detectLocale(): UiLocale {
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === "ru" || stored === "en") {
    return stored;
  }

  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function t(locale: UiLocale, key: TranslationKey, vars?: Record<string, string | number>): string {
  const template = translations[locale][key] ?? translations.en[key] ?? key;

  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, token: string) => String(vars[token] ?? ""));
}
