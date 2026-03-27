# Исследование совместимости и портативности стека yt-dlp + Zapret2 в Rust-бэкенде и Electron-фронтенде

## Executive summary

Связка «Rust-бэкенд + Electron UI + yt-dlp + Zapret2» технически реализуема, но **главное ограничение портативности** даёт именно Zapret2: это не «библиотека», а набор системных механизмов перехвата трафика (Linux: `iptables`/`nftables` + NFQUEUE, Windows: драйвер WinDivert, BSD: `ipfw`/`pf`), что почти неизбежно означает **права администратора/root**, вмешательство в сетевой стек и потенциальные конфликты с системными/корпоративными политиками. Zapret2 **явно не поддерживает macOS** (из‑за отсутствия пригодного механизма перехвата пакетов; `ipdivert` удалён из ядра), поэтому «полностью кроссплатформенный обход DPI во всех трёх ОС» в рамках Zapret2 невозможен. citeturn17view1turn16view3turn16view1

Для yt-dlp наиболее практичный путь в Rust — **subprocess/CLI-интеграция**: JSON‑вывод (`-j/--dump-json`, `-J/--dump-single-json`), прокси (`--proxy`), сетевые персонификации (`--impersonate`, `--list-impersonate-targets`) и регулярные релизы делают этот вариант устойчивее, чем «чистые» реализации. При этом нужно учитывать: сам репозиторий yt-dlp под Unlicense, но **релизные standalone‑бинарники, собранные PyInstaller’ом, включают GPLv3+ компоненты**, а значит их распространение тянет обязательства GPL для этого бинарника. citeturn4view2turn12view2turn12view0

Лицензионный «критический риск» в Rust‑части — выбор готовой обёртки: например, популярная Rust‑обёртка `boul2gom/yt-dlp` распространяется под GPL‑3.0, что может быть несовместимо с закрытой/проприетарной моделью распространения приложения. Альтернатива — MIT‑обёртки или собственный тонкий слой над `yt-dlp` как внешним процессом. citeturn24view0turn29view1turn24view1

С точки зрения GUI‑архитектуры, Electron даёт типовой стек IPC (`ipcMain`/`ipcRenderer`, structured clone), но перенос «на Tauri» стоит рассматривать всерьёз, если важны размер дистрибутива и «единый Rust‑бэкенд как родная часть приложения» (Tauri явно позиционируется как Rust‑binary backend + WebView UI и имеет встроенный бандлер/упаковку). citeturn23view0turn1search13turn22view0

## Репозитории и лицензии

Ниже — сравнительная таблица ключевых репозиториев/зависимостей. Поля «активность» даны как **последний релиз** (если есть) и/или ориентиры GitHub (звёзды/коммиты) на конец марта 2026.

| Репозиторий | URL | Язык | Лицензия | Активность | Зависимости | Сборка/установка | ОС | Примечания |
|---|---|---|---|---|---|---|---|---|
| yt-dlp (основной) | `https://github.com/yt-dlp/yt-dlp` citeturn3view0 | Python (≈99.9%) citeturn4view1 | Unlicense (код), но релизные standalone (PyInstaller) = GPLv3+ «combined work» citeturn4view3turn4view2 | Latest релиз 2026.03.17 citeturn5view0 | Python 3.10+; рекомендованы ffmpeg/ffprobe; также упоминаются `yt-dlp-ejs` и JS‑runtime; часть фич (impersonation) зависит от extras (`curl_cffi`) citeturn5view1turn28view2 | Есть готовые бинарники под Win/macOS/Linux; сборка «platform-independent» через `make` citeturn28view1turn28view2 | Windows (Win8+/ARM64), macOS (10.15+), Linux (glibc/musl) citeturn28view1 | Ключевые флаги для интеграции: `--dump-json/-j`, `--dump-single-json/-J`, `--proxy`, `--impersonate` citeturn12view2turn12view0 |
| Zapret2 (Bol‑Van) | `https://github.com/bol-van/zapret2` citeturn33view0 | C + Lua + Shell citeturn32view0 | MIT (LICENSE.txt) citeturn11view0 | Latest релиз 2026.03.05 citeturn32view0 | Linux: `iptables`/`nftables` + NFQUEUE; Windows: WinDivert; BSD: `ipfw`/`pf`; Lua‑стратегии citeturn16view3turn16view1turn9view0 | Unix: установка dev‑зависимостей и `make -C /opt/zapret2 systemd`; Windows: Cygwin + сборка LuaJIT + `make cygwin64` citeturn19view0turn20view0 | Linux, FreeBSD, OpenBSD, Windows, OpenWrt citeturn9view0turn32view0 | **macOS не поддерживается**; в ядро нужны правила/драйвер, почти всегда admin/root citeturn17view1turn16view2 |
| Zapret (v1, legacy) | `https://github.com/bol-van/zapret` citeturn3view2 | C + Shell citeturn3view2 | MIT citeturn2search2 | Latest релиз v72.12 (2026.03.12) citeturn5view3 | Пакет инструментов (в т.ч. `tpws`, `nfqws`) citeturn3view2turn8search8 | Документация указывает, что zapret (v1) EOL, актуальный проект — zapret2 citeturn7search16 | Linux/BSD/Windows/macOS (частично) заявлялись для v1 citeturn7search16 | Рассматривать как «исторический источник»/совместимость, но не как основу нового продукта citeturn7search16 |
| zapret-win-bundle (сборка под Windows) | `https://github.com/bol-van/zapret-win-bundle` citeturn33view0 | Lua/Shell/Batch citeturn33view0 | (в интерфейсе GitHub не отображается как лицензия; в README фокус на составе/требованиях) citeturn33view0 | Релизов нет; репо как «бинарный набор» citeturn33view0 | Включает минимальный Cygwin, blockcheck, WinDivert; возможны требования SecureBoot/testsigning citeturn33view0 | Готовый набор файлов; запуск через cmd/админ‑скрипты; содержит `blockcheck2.cmd` и примеры пресетов citeturn33view0 | Windows 7/8+/11 ARM64 (особые режимы) citeturn33view0 | Прямо говорится: **не «однокнопочное» решение**, без понимания zapret бесполезно; AV может ругаться на WinDivert citeturn33view0 |
| WinDivert (зависимость Windows‑ветки) | `https://github.com/basil00/WinDivert` citeturn27search0 | C/C++ (драйвер+API) | Dual‑license: LGPLv3 **или** GPLv2 citeturn27search0turn27search6 | Активность зависит от ветки/релизов; важнее юридический/драйверный аспект | Требует драйверной установки/подписи; Zapret2 на Windows использует WinDivert для перехвата citeturn16view1turn27search6 | Используется как DLL+SYS; может вызывать реакции антивирусов/конфликты драйверов citeturn15view0turn33view0 | Windows | Критично для вашей упаковки: лицензия (LGPL/GPL) и доверенная поставка/подпись драйвера citeturn27search0 |
| Rust‑обёртка `boul2gom/yt-dlp` | `https://github.com/boul2gom/yt-dlp` citeturn24view0 | Rust (≈99%) citeturn29view1 | GPL‑3.0 citeturn24view0turn29view1 | Latest релиз v2.7.0 (2026.03.16) citeturn29view1 | Автоскачивание `yt-dlp` и `ffmpeg` заявлено как функция citeturn24view0 | Через Cargo; требует сетевого доступа для автозагрузки зависимостей (если не «привезти заранее») citeturn24view0turn29view1 | Кроссплатформенность зависит от подтягиваемых бинарников | Хорошо для прототипа; **плохая совместимость с закрытой лицензией** приложения из‑за GPL‑3.0 citeturn29view1 |
| Rust‑обёртка `narrrl/ytd-rs` | `https://github.com/narrrl/ytd-rs` citeturn24view1 | Rust 100% citeturn24view1 | MIT citeturn24view1 | Релизов нет (по состоянию на страницу репо) citeturn24view1 | Требует `yt-dlp` в PATH citeturn24view1 | Cargo‑crate; умеет стримить stdout построчно и работать с JSON через `serde` citeturn24view1 | Любая ОС, где есть Rust + yt-dlp | Удобно как пример архитектуры (async, streaming output), но зрелость/поддержка ниже, чем у самого yt-dlp citeturn24view1 |
| Electron (framework) | `https://github.com/electron/electron` citeturn23view0 | C++/TypeScript и др. citeturn23view0 | MIT citeturn23view0turn21search1 | Latest релиз 2026.03.25 (v41.0.4) citeturn23view0 | Node.js + Chromium (как основа фреймворка) citeturn23view0 | Установка через npm (`npm install electron --save-dev`) citeturn23view0 | macOS/Windows/Linux (релизные бинарники на 3 ОС) citeturn23view0 | IPC: `ipcMain`/`ipcRenderer` (сериализация через structured clone) citeturn1search13turn1search15 |
| electron-builder (упаковка Electron) | `https://github.com/electron-userland/electron-builder` citeturn25view0 | TypeScript/JS и др. | MIT citeturn25view0 | Latest релиз 2026.03.04 (26.8.2) citeturn25view0 | Для native addons рекомендуют `install-app-deps`; по умолчанию пакует в asar citeturn25view0 | Скрипты `electron-builder` / `yarn app:dist` citeturn25view0 | macOS/Windows/Linux citeturn25view0 | Учтите комплаенс: вопрос «попадают ли лицензионные файлы в сборку» реально всплывает в issues citeturn21search18 |
| Tauri (альтернатива Electron) | `https://github.com/tauri-apps/tauri` citeturn22view0 | Rust (≈83%) + TypeScript и др. citeturn22view0 | Apache‑2.0 и MIT (dual) citeturn22view0 | Latest релиз tauri-cli v2.10.1 (2026.03.04) citeturn22view0 | WebView на системе (WKWebView/WebView2/WebKitGTK); backend — Rust‑binary citeturn22view0 | `npm create tauri-app@latest`, `tauri build`; бандлер поддерживает .app/.dmg/.deb/.AppImage/.msi/.exe и др. citeturn22view0turn21search8turn21search11 | Windows/macOS/Linux (+ mobile) citeturn22view0 | IPC: command system (`#[tauri::command]`, JSON‑сериализация) citeturn30search3turn30search7 |

Ключевые лицензионные выводы для вашего продукта:

- **yt-dlp как проект** — крайне либеральная Unlicense; но если вы распространяете **релизные standalone‑бинарники**, вы обязаны соблюдать условия GPLv3+ для этого бинарника (как минимум хранить/прикладывать лицензии и корректно перераспространять исходники/предложения исходников согласно требованиям GPL для включённых компонентов). citeturn4view3turn4view2  
- **Zapret2** под MIT, что обычно не мешает ни open‑source, ни коммерческому распространению. citeturn11view0  
- На Windows цепочка Zapret2 часто тянет **WinDivert (LGPLv3/GPLv2)** — это отдельная зона комплаенса и риска AV/EDR. citeturn27search0turn15view0turn33view0  
- Выбор Rust‑обёртки важен: GPL‑обёртка, слинкованная в ваш Rust‑бинарь, может «заразить» лицензирование приложения; MIT‑обёртки/собственная обвязка в этом смысле безопаснее. citeturn29view1turn24view1  

## Интеграция yt-dlp в Rust-бэкенде

### Что в yt-dlp удобно именно для программной интеграции

yt-dlp предоставляет несколько механизмов, полезных именно «как backend‑движок»:

- **Прокси на уровне загрузчика**: `--proxy URL` поддерживает HTTP/HTTPS/SOCKS (включая схемы `socks5://…`), и можно принудительно отключить прокси `--proxy ""`. Это важная точка стыка с любыми «обходами», реализованными как локальный прокси или внешний туннель. citeturn12view0  
- **Машинно‑читаемый JSON**: `-j/--dump-json` и `-J/--dump-single-json` позволяют получать структуру метаданных (причём `--dump-single-json` удобен для плейлистов, «одна строка — один объект»). Учтите, что `--dump-json` по умолчанию «simulate unless --no-simulate», т.е. его типовой сценарий — «извлечь инфо без скачивания». citeturn12view2turn12view3  
- **Встраивание как Python‑модуль**: в README есть примеры `yt_dlp.YoutubeDL` + `extract_info(download=False)` и `sanitize_info` для сериализации. Это легитимный «официальный» API‑путь, но он усложняет доставку runtime. citeturn12view3  
- **Сетевые «анти‑бот» и «фингерпринт» настройки**: `--impersonate CLIENT[:OS]` и предупреждение, что принудительная имперсонация может ухудшать скорость/стабильность; возможность перечислить таргеты `--list-impersonate-targets`. citeturn12view0turn28view2  

Отдельно важно: у yt-dlp регулярно всплывают кейсы «Sign in to confirm you’re not a bot» при работе с YouTube (особенно на VPS/прокси). Это не DPI, а серверные/поведенческие барьеры. Ваш продукт должен уметь отличать «DPI‑блок» от «бот‑челленджа/429/403». citeturn26search0turn26search16

### Конкретные подходы интеграции yt-dlp с Rust

Ниже — практичные варианты (в порядке «от наиболее переносимого к наиболее сложному»).

#### Subprocess (CLI) + структурированный вывод

Суть: Rust запускает `yt-dlp` как дочерний процесс, передаёт аргументы, читает stdout/stderr, парсит JSON/прогресс.

Плюсы:
- Минимум проблем с упаковкой Python‑окружения: можно положить рядом готовый `yt-dlp.exe`/`yt-dlp_macos`/`yt-dlp_linux` (или требовать установленный yt-dlp) citeturn28view1turn24view1  
- Просто обновлять: можно ориентироваться на релизы yt-dlp и иметь отдельный механизм обновления embedded‑binary (или позволить пользователю обновлять самостоятельно). citeturn5view0turn5view1  
- Хорошо сочетается с Electron: вы можете отдавать фронтенду события «строка лога», «JSON метаданных», «статус/ошибка».

Минусы:
- Нужно аккуратно стандартизировать протокол: где JSON, где прогресс, где ошибки; часть опций «симулирует» по умолчанию. citeturn12view2  
- Получение «точного конечного пути файла» может быть нетривиальным: даже вокруг `--print-json` и шаблонов есть обсуждения/углы (пример: issue о поведении `--print-json` относительно filename). citeturn0search8  

Практическая рекомендация: делайте **двухфазный вызов**:  
1) «metadata phase» через `--dump-single-json`/`--dump-json` (simulate) → UI показывает форматы/качество/пример имени;  
2) «download phase» с прогресс‑стримингом и заранее рассчитанным output template. Основание — сам yt-dlp даёт и JSON, и опции output templates. citeturn12view2turn12view0  

#### Использование готовой Rust‑обёртки поверх subprocess

Два показательных варианта:

- `narrrl/ytd-rs` (MIT): требует установленный `yt-dlp` в PATH, даёт async API, JSON через `serde`, умеет стримить вывод построчно для прогресса. citeturn24view1  
- `boul2gom/yt-dlp` (GPL‑3.0): заявляет авто‑скачивание `yt-dlp` и `ffmpeg`, регулярные релизы; но GPL может быть неприемлем для части моделей распространения. citeturn24view0turn29view1  

Плюсы:
- Быстрее старт разработки.
- Часто уже реализованы «тонкие места» (подготовка аргументов, разбор вывода, базовые модели данных).

Минусы:
- Лицензия и скорость обновления обёртки становятся частью вашего риска (пример: GPL‑3.0 у `boul2gom/yt-dlp`). citeturn29view1turn5view0  
- Иногда обёртка ограничивает нестандартные сценарии, а yt-dlp исторически часто требует «передать новый флаг прямо сейчас».

#### Embedding как Python‑модуль (FFI/встраивание)

Суть: вы встраиваете Python интерпретатор (например, через pyo3/embedded Python) и вызываете `yt_dlp.YoutubeDL` как библиотеку (пример приведён в README). citeturn12view3  

Плюсы:
- Прямой доступ к объектной модели yt-dlp (без парсинга CLI‑логов).
- Легче писать «плагины/хуки» на уровне Python.

Минусы (для desktop‑продукта):
- Упаковка «Rust + embedded Python + зависимости yt-dlp» резко усложняется на всех ОС.
- Возникают вопросы совместимости и безопасности supply chain: при поставке Python‑окружения встраиваемые зависимости становятся вашей зоной ответственности. При этом даже сами standalone‑билды yt-dlp включают интерпретатор и пакеты, т.е. тема «что именно вы распространяете» не исчезает. citeturn5view1turn4view2  

Вывод: embedding имеет смысл, если вы готовы сознательно «продуктизировать Python runtime» внутри приложения; иначе subprocess прагматичнее.

## Интеграция Zapret2 и обход DPI

### Как устроен Zapret2 и почему это влияет на портативность

Zapret2 позиционируется как автономное средство противодействия DPI (без внешних серверов), ориентированное в том числе на роутеры/embedded и поддерживающее Linux/BSD/Windows. citeturn32view1turn9view0  

Ключевой архитектурный момент: ядро Zapret2 — программа **nfqws2** (на BSD — `dvtws2`, на Windows — `winws2`) и она написана на C как «packet manipulator». citeturn16view0turn32view0  
В отличие от zapret1, где «стратегии» были «зашиты» в C, в zapret2 «дурение» выносится в Lua‑скрипты (стратегии), и автор прямо объясняет, что обход DPI требует всё более специфичных воздействий и старые приёмы перестают работать. citeturn9view0turn10view0  

Для вашего приложения это означает:  
- Запрет‑часть — **не просто “вызвать библиотеку”**, а управлять системой перехвата трафика (правила/драйвер), жизненным циклом демона и конфигурацией Lua (версионирование стратегий). citeturn16view2turn16view1turn9view0  
- Степень привязки к ОС/привилегиям крайне высокая.

### ОС‑совместимость и привилегии

#### Linux

Перехват трафика делается через `iptables` или предпочтительно `nftables` с механизмом NFQUEUE; в документации подчёркивается, что `nftables` предпочтительнее, т.к. позволяет работать «после NAT», а `iptables` считается legacy‑вариантом совместимости. citeturn16view2turn16view3  

Практические последствия:
- Потребуются root‑права для установки правил в netfilter и для управления сервисом.
- Возможны конфликты с существующими правилами firewall/SD‑WAN/корпоративными агентами.
- В контейнере это почти всегда означает `--cap-add NET_ADMIN`/privileged и/или host‑network, иначе вы не контролируете нужный слой; плюс NAT‑схемы часто ухудшают/ломают техники (аналогичный эффект описан для NAT гипервизоров). citeturn16view2turn15view0  

#### Windows

Windows не имеет нативных средств перехвата трафика уровня, требуемого Zapret2, поэтому используется **WinDivert driver**, управление интегрировано в `winws2`. citeturn16view1turn15view0  
Документация также отмечает, что WinDivert часто триггерит антивирусы, возможны конфликты с kernel‑mode софтом (вплоть до BSOD), а для некоторых сценариев (forwarded traffic при NAT/ICS) WinDivert перехватывает ненадёжно и «workaround — прокси». citeturn15view0turn16view1  

Кроме того, в Windows‑бандле zapret-win-bundle прямо перечислены требования: иногда нужно отключать Secure Boot, включать testsigning на ARM64, и запускать инструменты от администратора; также прямо дано предупреждение про антивирусы. citeturn33view0  

Юридический аспект: WinDivert dual‑licensed LGPLv3/GPLv2; это значит, что независимо от лицензии Zapret2 (MIT), поставка WinDivert в составе вашего продукта должна учитывать условия LGPL/GPL (и требования к предоставлению лицензии/исходников/возможности релинка — в зависимости от выбранного пути). citeturn27search0turn27search6  

#### macOS

Zapret2 **явно не поддерживает macOS**, потому что нет подходящего инструмента перехвата/управления пакетами; `ipdivert` был удалён из ядра производителем, а даже при наличии `pf` правила не работают без этого механизма. citeturn17view1  

Следствие для вашего продукта:  
- На macOS вы либо отказываетесь от Zapret2‑функциональности, либо предлагаете альтернативы (например, работа через прокси/VPN, но это уже «другой класс решений»).

### Безопасность Zapret2 как компонента

Есть несколько важных моментов, которые можно использовать как аргументы в архитектуре:

- В руководстве указано, что **nfqws2 “drops its privileges after initialization”**, а Lua‑код выполняется уже после сброса привилегий; это снижает ущерб при ошибке/уязвимости в Lua‑стратегии. citeturn15view0  
- Есть режимы диагностики (`--debug`, `--dry-run`), причём `--dry-run` предназначен для проверки CLI‑параметров и доступности файлов уже «под сброшенными правами», но не проверяет Lua‑синтаксис. Это можно встроить в «самопроверку конфигурации» вашего приложения. citeturn15view0turn15view4  

### Практическая интеграция Zapret2 в ваш продукт

Самый реалистичный подход для desktop‑программы — **трактовать Zapret2 как опциональный системный режим**, а не как «встроенную библиотеку»:

- Вариант A (наиболее устойчивый): приложение умеет **обнаруживать**, что доступ к нужным доменам/протоколам деградирует, и предлагает пользователю включить уже установленный системный обход (Zapret2 или внешний прокси).  
- Вариант B (интеграция “внутрь”): приложение само ставит/запускает `winws2`/`nfqws2` и управляет правилами/драйвером. Это даёт «one‑click UX», но резко повышает требования: admin/root, драйвер, комплаенс по лицензиям, конфликты, доверие AV/корп‑агентов. citeturn16view2turn20view0turn33view0  

Если вы хотите, чтобы именно ваш downloader работал через DPI‑обход, а система целиком — нет, то у Zapret‑класса решений этот режим достигается **фильтрацией/маркировкой перехватываемого трафика** (по портам/IP/спискам доменов, автоспискам и т.п.), но это уже уровень сетевой инженерии и требует аккуратного UX («экспертный режим»). В документации описывается, что перехват «лишнего» трафика увеличивает CPU‑нагрузку, а фильтрация важна для предотвращения loops/подвисаний. citeturn16view2turn15view0  

## Связка Rust и Electron и альтернатива Tauri

### Коммуникация Rust ↔ Electron

Есть три доминирующих схемы.

#### Electron IPC (renderer ↔ main) + внешний Rust‑процесс (main ↔ backend)

В renderer вы общаетесь с main через `ipcRenderer`, а main управляет Rust‑backend (как child process или как локальный сервис).

В Electron документация подчёркивает: аргументы IPC сериализуются **structured clone algorithm**, что накладывает ограничения на типы (нельзя передавать функции/DOM/спец‑объекты). citeturn1search15turn1search13  

Плюсы:
- Простая кроссплатформенность.
- Rust‑backend можно перезапускать/изолировать (crash‑containment).
- Удобно стримить события: «progress», «log line», «download completed».

Минусы:
- Нужно спроектировать собственный RPC‑протокол (например, JSON‑Lines по stdin/stdout).
- На Windows нужно следить за «окном консоли», codepage и т.п. (решаемо).

#### Native Node module (Rust → Node‑API)

Вы собираете Rust как native addon и вызываете прямо из Node/Electron. Node‑API описывается как ABI‑стабильный слой для нативных аддонов. citeturn30search6  
Проект `napi-rs/napi-rs` прямо предлагает фреймворк для Node‑API аддонов на Rust. citeturn30search4turn30search0  

Плюсы:
- Низкая задержка, прямой вызов функций, меньше контекстных переключений.
- Удобно для CPU‑интенсивных задач или криптографии/парсинга.

Минусы:
- Упаковка/сборка усложняется: нативные модули должны быть пересобраны под версию Electron/ABI; Electron docs рекомендуют `@electron/rebuild`/механизмы пересборки. citeturn30search2turn25view1  
- CI становится тяжелее (матрица по OS/arch + prebuild artifacts).
- Ваша зона атаки увеличивается: ошибки FFI/ABI могут приводить к падениям процесса Electron.

#### Локальный HTTP/gRPC сервис на loopback

Rust поднимает `127.0.0.1` порт, Electron ходит по HTTP.

Плюсы:
- Языконезависимо; легко тестировать; можно подключать другие клиенты.
- Хорошо подходит, если вы хотите в будущем CLI/daemon.

Минусы:
- Нужно продумать security (токен, origin, защита от других локальных процессов).
- Порты/фаервол/конфликты.

### Tauri как альтернатива Electron

Tauri на GitHub описывает модель: UI на HTML/JS/CSS, backend — **Rust‑binary с API**, бандлер умеет выпускать `.app`, `.dmg`, `.deb`, `.rpm`, `.AppImage`, Windows `.exe` (NSIS) и `.msi` (WiX), плюс есть self‑updater и GitHub action для CI. citeturn22view0turn21search8turn25view2  

IPC в Tauri строится вокруг command system: Rust функции помечаются `#[tauri::command]`, данные сериализуются в JSON (и обратно), команды могут быть async и возвращать ошибки. citeturn30search3turn30search7  

Портативность/сборка:
- Linux‑бандлы `.deb`/`.AppImage` формируются на Linux (в документации v1 отмечено, что кросс‑компиляция для пакетов «не работает»). citeturn21search15  

Вывод: если вам важны **малый размер** и «Rust‑центричность» — Tauri часто проще как продуктовая платформа. Если важна зрелость экосистемы Chromium/Electron и привычная web‑инфраструктура — оставайтесь на Electron.

## Архитектурные рекомендации, тестирование, CI и упаковка

### Рекомендуемая архитектура приложения

На практике, чтобы совместить «кроссплатформенный downloader» и «частично платформенный DPI‑обход», разумно разделить систему на 4 слоя:

- **UI слой (Electron или Tauri)**: формы/списки загрузок/логин‑помощник/настройки сети.
- **Core backend (Rust)**: очередь загрузок, управление состояниями, хранилище истории, события прогресса; адаптеры под «движки загрузки».
- **Download engine adapter**: модуль, который инкапсулирует запуск `yt-dlp` (CLI), нормализует аргументы, парсит JSON/прогресс, управляет `ffmpeg` как внешней зависимостью (если нужно). Основание: yt-dlp даёт `--dump-json`, `--proxy` и т.д. citeturn12view2turn12view0turn5view1  
- **Network strategy layer**: «Direct», «Proxy», «System DPI bypass». Запуск Zapret2 — отдельная стратегия, доступная не на всех ОС (macOS: unavailable). citeturn17view1turn12view0  

Ключевое UX‑решение: Zapret2 **делать опциональным** и явно маркировать как «режим, требующий прав администратора и вмешательства в сеть».

### План тестов

Минимально жизнеспособный, но достаточно «боевой» набор тестов для такого продукта:

- **Unit‑тесты Rust**:  
  - парсинг stdout/stderr yt-dlp (включая строки прогресса и JSON‑объекты);  
  - нормализация ошибок (например, распознавание «bot challenge» фрагментов vs сетевых таймаутов). Как мотивация: реальные issues про «Sign in to confirm you’re not a bot». citeturn26search0turn26search16  

- **Integration‑тесты (без реального YouTube)**:  
  - «контрактные» тесты запуска `yt-dlp` на локальных/тестовых URL или с мок‑сервером;  
  - тесты на `--dump-json`/`--dump-single-json` и предсказуемый JSON‑формат. citeturn12view2turn24view1  

- **Smoke‑тесты (с сетью, но контролируемо)**:  
  - выбор небольшого публичного ролика/плейлиста;  
  - ограничение частоты (rate limit) и ретраи, чтобы не провоцировать анти‑бот;  
  - отдельный прогон «через прокси» как функциональность `--proxy`. citeturn12view0turn26search0  

- **E2E UI‑тесты**:  
  - добавление загрузки → старт → прогресс → завершение;  
  - отмена/пауза (на уровне «остановить процесс»);  
  - восстановление после рестарта приложения.

- **Платформенные тесты Zapret2 (условно‑изолированные)**:  
  - только в режиме «self-test»: проверка наличия прав, зависимостей, корректности конфигурации (`--dry-run`/лог‑режим);  
  - отдельно от «боевых стратегий» (не в CI), потому что это требует root/driver и может быть нестабильно в runner‑окружениях. citeturn15view0turn16view2  

### План CI (матрица)

Для GitHub Actions логично сделать 3 уровня pipeline:

- **Lint/format/security**: `cargo fmt`, `cargo clippy`, dependency checks; для Electron/Tauri — линтеры JS/TS; отдельная проверка наличия third‑party licenses, т.к. сборщики могут «не положить» лицензии по умолчанию. citeturn21search18turn4view2  
- **Build matrix**:
  - Windows x64 (и опционально ARM64, но с оговоркой по WinDivert/testsigning);
  - macOS universal/arm64 (но без Zapret2);
  - Linux x86_64 (AppImage/DEB для Tauri либо Electron artifacts).  
  Tauri‑action показывает типовой matrix include для macOS arm64/x86_64 и Ubuntu. citeturn25view2turn21search15  

- **Artifact packaging**:
  - Electron: `electron-builder` (`app:dist`) + публикация артефактов; asar по умолчанию включён — учесть, что нативные модули и некоторые бинарники могут требовать unpack. citeturn25view0turn30search30  
  - Tauri: `tauri build`, публикация бандлов; помнить, что Linux bundles делаются на Linux. citeturn21search8turn21search15  

### Команды сборки/запуска (если доступны в первоисточниках)

#### yt-dlp

Сборка «platform-independent binary (UNIX)» (если вы хотите собирать сами):
```bash
make
```
Требуемые build tools перечислены в документации (`python 3.10+`, `zip`, `make`, и т.п.). citeturn28view2  

Использование прокси и JSON для интеграции:
```bash
yt-dlp --proxy socks5://127.0.0.1:1080/ -J "https://www.youtube.com/watch?v=..."
yt-dlp --dump-json "https://www.youtube.com/watch?v=..."
```
Флаги `--proxy`, `--dump-json`, `--dump-single-json` описаны в README. citeturn12view0turn12view2  

#### Zapret2

Linux (Debian/Ubuntu пример из build howto):
```bash
apt install make gcc zlib1g-dev libcap-dev libnetfilter-queue-dev libmnl-dev libsystemd-dev libluajit2-5.1-dev
make -C /opt/zapret2 systemd
```
citeturn19view0  

Windows x64 (сборка по howto): Cygwin + LuaJIT + сборка `nfqws2`:
```bash
make cygwin64
```
и затем использовать `winws2.exe`, плюс требуется положить рядом `cygwin1.dll`, `windivert.dll` и `windivert64.sys`, запускать из `cmd.exe` с правами администратора. citeturn20view0turn33view0  

Важно: этот же howto указывает на необходимость взять `windivert.dll`/`.sys` с сайта автора WinDivert и выбирать версию под конкретную Windows. citeturn20view0turn33view0  

#### Electron и упаковка

Установка Electron:
```bash
npm install electron --save-dev
```
citeturn23view0  

electron-builder: рекомендуемые скрипты и команды:
```json
"scripts": {
  "app:dir": "electron-builder --dir",
  "app:dist": "electron-builder"
}
```
Запуск: `yarn app:dist` или `yarn app:dir`. citeturn25view0  

#### Tauri (как альтернатива)

Создание проекта:
```bash
npm create tauri-app@latest
```
citeturn22view0  

Сборка/бандлинг:
```bash
tauri build
```
Бандлер и форматы перечислены в документации. citeturn21search8turn22view0  

## Риски, безопасность и правовые аспекты

### Технические риски и «подводные камни»

- **DPI vs server-side антибот**: даже при идеальном обходе DPI YouTube может требовать «Sign in to confirm you’re not a bot», особенно на IP адресах дата‑центров/прокси. В issues видно, что это регулярная проблема. Для продукта важно иметь «диагностику причин» и сценарии (cookies/auth/impersonation/смена сети). citeturn26search0turn26search15  
- **HTTP/3/QUIC и UDP 443**: Zapret2 ориентирован на перехват и TCP 80/443, и UDP 443; в документации присутствуют упоминания QUIC initial reassembly и настройки перехвата UDP. Это влияет на то, «почему в одном браузере работает, а в другом нет». citeturn16view4turn15view4  
- **Конфликты драйверов/AV на Windows**: и Zapret2 manual, и zapret-win-bundle прямо предупреждают про реакции антивирусов на WinDivert и возможные конфликты kernel‑mode софтов. Это может стать топ‑причиной «не работает у части пользователей». citeturn15view0turn33view0  
- **Виртуализация/NAT**: Zapret2 manual отмечает, что NAT‑режимы гипервизоров часто ломают техники обхода и нужен bridged; из этого следует, что в Docker/VM‑окружениях воспроизводимость может быть хуже. citeturn15view0turn16view2  
- **macOS gap**: Zapret2 macOS не поддерживает — это должно быть отражено в продуктовых требованиях (либо «feature unavailable», либо альтернативный механизм). citeturn17view1  

### Supply chain и доверие к бинарникам

- В репозитории zapret (v1) есть явные предостережения о мошенниках/фейковых ресурсах и нарушениях лицензии; для продукта это означает: поставляйте зависимости только из официальных источников, фиксируйте хэши/подписи и документируйте происхождение. citeturn7search16  
- zapret-win-bundle отдельно отмечает возможность сравнить WinDivert файлы с оригиналами автора. Это хорошая практика для вашей поставки (проверяемые источники, контроль целостности). citeturn33view0  

### Правовые рамки и комплаенс

Юрисдикция не указана, поэтому ниже — то, что можно зафиксировать из первоисточников:

- Условия использования entity["company","YouTube","video platform"] запрещают «access, reproduce, download…» контент, кроме случаев, когда это прямо разрешено сервисом или законом/правообладателем (формулировка есть в разделе Permissions and Restrictions). Это означает, что распространение «YouTube downloader» может конфликтовать с ToS, даже если часть пользователей будет использовать инструмент для законных целей. citeturn31search0turn31search5  
- entity["company","Google","parent company"] официально поддерживает офлайн‑скачивание через Premium/официальные механизмы приложения в определённых сценариях. Это отдельный «легальный» канал, который отличается от работы через сторонние инструменты. citeturn31search13turn31search25  

Практический вывод для продукта: если вы планируете публичное распространение, вам нужен **комплаенс‑пакет** (EULA/ToS вашего приложения, уведомления о лицензиях third‑party, описание допустимого использования) и чёткая UX‑политика (например, «скачивание только контента, на который у пользователя есть права/разрешения», хотя само по себе это не гарантирует соответствие ToS платформы). Основание для необходимости комплаенса — наличие реальных кейсов, когда сборщики «теряют лицензии» и это обсуждается в issues, плюс наличие GPL/LGPL компонентов в цепочке зависимостей. citeturn21search18turn27search0turn4view2