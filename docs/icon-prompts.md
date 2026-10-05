# Иконки интерфейса

Созданы встроенным инструментом ImageGen 5 октября 2026 года. Прозрачные PNG преобразованы в WebP 256 × 256 с сохранением альфа-канала. Общий размер трёх файлов — 43 382 байта. Технические символы действий (закрытие, пауза, копирование и QR) остаются чёткими SVG из Lucide; декоративные объёмные иконки всегда сопровождаются текстом.

## Файлы

- [Талон](../public/media/icons/ticket.webp): логотип, навигация и число ожидающих.
- [Преподаватель](../public/media/icons/teacher.webp): вход, преподаватели, завершённые сдачи и новая пара.
- [Часы](../public/media/icons/clock.webp): фактическое ожидание.

## Итоговые промпты

### Талон

Use case: stylized-concept. Asset type: transparent UI icon for a university queue web application. Create ONE centered glossy 3D emoji-style orange admission ticket, plump rounded soft corners, tiny perforations, a simple embossed white heart in its center. No letters, no numbers, no text. Warm vivid coral orange #ff542b, soft realistic highlights, charming polished messaging-app emoji aesthetic matching a glossy pink heart emoji. Front three-quarter view, restrained perspective. Large single object filling 75% of a square canvas, transparent background, clean silhouette, no environment, no cast shadow outside object. Must remain legible at 32px. This is an actual icon asset, not a website mockup.

### Преподаватель

Use case: stylized-concept. Asset type: transparent UI icon for university teacher dashboard. ONE glossy 3D emoji-style graduation cap, warm black charcoal rounded plump cap with coral-orange #ff542b tassel and a small creamy white highlight. Premium friendly messaging emoji look, soft studio highlights, smooth inflated material, no realistic fabric texture. Front three-quarter view, isolated centered single object filling 75% of square, complete uncropped silhouette, actual transparent background. Readable at 36px. No text, no letters, no face, no pedestal, no environment or external shadows. Consistent style with glossy orange ticket and glossy pink heart emojis.

### Часы

Use case: stylized-concept. Asset type: transparent UI icon for queue waiting-time analytics. ONE glossy 3D emoji-style small round desk clock. Plump creamy white circular face, chunky coral-orange #ff542b rounded rim, two charcoal-black hands, four tiny black hour ticks only, NO numbers and NO letters. Friendly premium messaging-app emoji aesthetic, smooth polished soft material, realistic soft highlights, front three-quarter view restrained perspective. Isolated centered object filling 75% square with complete uncropped silhouette, transparent background. No environment, no pedestal, no external shadow. Must remain legible at 36px. Consistent with glossy orange ticket and graduation cap icons.

## Оформление

`src/app-theme.css` объединяет вход, панель преподавателя, настройки, управление преподавателями, диалоги и табло в светлой палитре исходных студенческих макетов. Акцент — `#ff542b`, фон — `#f2f6f5`. На приёме карточка преподавателя светло-зелёная; табло и личный экран вызванного студента используют яркий зелёный. Полноэкранный QR всегда остаётся на белом фоне.
