# РИТМ

Имя приложения: **РИТМ**. Подпись: «очередь на пару».

Маскот — внимательный кот, выглядывающий из талона. Три полоски разной высоты соединяют мотив ритма с последовательностью в очереди. Знак создан встроенным ImageGen по предоставленным пользователем референсам простых графических маскотов. Названия и персонажи референсов не используются в приложении.

## Файлы логотипа

- [Растровый оригинал PNG, прозрачный фон](../public/brand/ritm-mark.png).
- [Знак WebP 256 × 256 для интерфейса](../public/brand/ritm-mark.webp).
- [Иконка вкладки PNG 64 × 64](../public/brand/ritm-favicon.png).
- [Иконка для экрана телефона PNG 180 × 180](../public/brand/ritm-touch.png).

Это растровая графика, не векторный исходник. В приложении знак сочетается с живой надписью «РИТМ» шрифтом Golos Text, чтобы название оставалось чётким и доступным для чтения вспомогательными технологиями. Прозрачные поля оригинала обрезаны, веб-версии уменьшены с сохранением альфа-канала.

## Использование

- Коралловый `#ff542b`: основной акцент и талон маскота.
- Графитовый `#202421`: маскот и основная надпись на светлом фоне.
- Светлый `#f2f6f5`: фон интерфейса.
- Зелёный `#36d780`: вызов студента.
- Белый `#ffffff`: надпись и текст на зелёном экране вызова.

Компактный знак используется в навигации студента; полный — на входе, в панели преподавателя и на табло. Внутри белых карточек и кнопок текст остаётся тёмным. QR использует округлые тёмные модули и рамки на белом фоне, в центре — оригинальный котик с оранжевым талоном. Белая подложка занимает около 19% стороны матрицы (менее 4% её площади); для восстановления перекрытых данных используется коррекция ошибок H. Поле вокруг кода — четыре модуля. Встроенный PNG для QR: `src/assets/ritm-qr-mark.png`. Автотесты декодируют оформленные QR с длинными ссылками очереди в компактном и полноэкранном размерах.

## Итоговый промпт ImageGen

Use case: logo-brand. Create one original mascot LOGO SYMBOL for a university online queue app named РИТМ (Rhythm). References are STYLE REFERENCES ONLY: bold simple flat silhouettes, charming expressive eyes, instantly recognizable compact character. Do not reproduce any reference logo, words, paper airplane or box. Primary request: a friendly charcoal-black cat peeking over a coral-orange admission ticket, with its two soft rounded paws resting on the ticket's top edge. Compact slightly asymmetrical head, two small rounded triangular ears, two expressive cream-white oval eyes with small black pupils looking attentively upward-right, tiny relaxed smile. Orange ticket is a rounded horizontal capsule with subtle concave notches on its left/right edges. On ticket: precisely THREE small cream-white vertical rounded equalizer bars of different heights (short, tall, medium), suggesting rhythm and the queue. The cat and ticket form ONE cohesive flat graphic silhouette, clever professional identity, not a detailed illustration. Palette only charcoal #202421, coral orange #ff542b, warm white #fffdf5. Flat solid fills, clean crisp vector-like edges, no outlines, no gradients, no textures, no 3D, no shadows, no glow. Centered full logo with generous transparent margins, square canvas. No text, no lettering, no mockup, no additional symbols, no trademark symbol. Icon must read clearly at 40px. Genuine transparent background.


## Иллюстрация завершённой очереди

Создана встроенным ImageGen. Используется `public/media/ritm-sad.webp` (прозрачный фон, до 384 px). Экран завершения: красный `#df454d`, белый текст. Исходный логотип — референс персонажа.

Промпт: Use case: stylized-concept. Create one transparent PNG UI emoji illustration for the Russian university queue app РИТМ: a cute gently sad dark charcoal cat mascot, using the attached logo as identity reference (large cream eyes, simple rounded silhouette, tiny paws). Head and upper body, holding its small orange rounded queue ticket with the same three cream rhythm bars. Drooping ears, expressive disappointed eyes and tiny sad mouth, one small tear. Kind, endearing, not dramatic. Polished soft 3D emoji/sticker finish, clean edges, centered isolated character with generous transparent margin. Readable at 120 pixels on a coral red screen. Preserve logo identity but change expression and pose. No words, no letters, no background, no scenery, no extra symbols. Deliver a square transparent background image.
