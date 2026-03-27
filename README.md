# Birthday Present

Этот репозиторий теперь публикует статическую версию открытки через GitHub Pages отдельным workflow.

## Workflow публикации

Файл workflow: `.github/workflows/birthday-card.yml`.

Триггеры:
- `workflow_dispatch` — ручной запуск из GitHub UI;
- `push` в ветки `main` и `work` (текущая релизная ветка проекта).

## Как запустить вручную

1. Откройте вкладку **Actions** в GitHub.
2. Выберите workflow **Birthday Card Pages**.
3. Нажмите **Run workflow** и запустите его для нужной ветки.

## Где доступна опубликованная открытка

После успешного выполнения job `deploy` открытка доступна по URL GitHub Pages проекта:

`https://<OWNER>.github.io/BirthdayPresent/`

> Если репозиторий находится в организации или под другим именем, подставьте фактические `<OWNER>` и имя репозитория.

## Локальная сборка карточки

Статическая сборка вынесена в отдельную директорию `dist-card/`, чтобы не смешиваться с electron-артефактами.

```bash
npm ci
npm run build:card
```
