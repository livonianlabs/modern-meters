# Modern Meters

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/silverenio)

Five desktop gadgets for the Windows Sidebar from 8GadgetPack:

| Gadget | Shows |
|---|---|
| **CPU Meter Modern** | Load of every thread or core (P-cores and E-cores grouped), clock speed, temperature, RAM and commit, history graph. Click the processor's name for the busiest programs by CPU and memory |
| **GPU Meter Modern** | GPU load, VRAM, memory controller or shared memory, power, fan (RPM and %), clocks, encoder/decoder, temperature, history graph, an alarm when video memory is nearly full. Click the card's name for the programs using its memory and GPU. NVIDIA, AMD and Intel, discrete and integrated, with the same sensors Task Manager uses |
| **Network Meter Modern** | Download and upload speed with an auto-scaled graph, Wi-Fi network and signal, IP addresses (hidden until clicked), firewall, traffic totals |
| **Drives Meter Modern** | Physical disks with their partitions, SMART health, SSD life left, temperature, read/write speed, activity graph |
| **Weather Meter Modern** | Current weather and a colored hourly chart of temperature, precipitation, wind or pressure (switched by tabs), a rain radar map of the last 80 minutes, 3 or 5 days ahead. Follows you from town to town through Windows location |

All of them speak 12 languages (English, Українська, Русский, Deutsch, Español, Français, Italiano, Polski, Português, Türkçe, 中文, 日本語) and pick yours from Windows, and have five widths, accent colors, and a five-step color scale for load and temperature. Translations live in `shared/lang/`, one file per language; corrections are welcome.

Styles: **Glass**, **Classic**, **Light**, **Colored glass** (glass in your accent color: blue, teal, green, purple, orange, pink, red or yellow), **Retro terminal** (a CRT screen with scanlines in your accent color) and **Auto**, which switches between Light and Glass with Windows' light/dark mode. Panels for the colored styles are drawn once on your PC the first time they're needed. Set **For all gadgets** in any gadget's settings to give every gadget the same style and language (and, if you like, accent color) in one go.

<img src="docs/themes.png" width="660" alt="Light, colored glass and retro terminal styles">

### Glass style

<table><tr valign="top">
<td><img src="docs/cpu-glass.png" width="160" alt="CPU Meter, glass"></td>
<td><img src="docs/gpu-glass.png" width="160" alt="GPU Meter, glass"></td>
<td><img src="docs/network-glass.png" width="160" alt="Network Meter, glass"></td>
<td><img src="docs/drives-glass.png" width="160" alt="Drives Meter, glass"></td>
<td><img src="docs/weather-glass.png" width="160" alt="Weather Meter, glass"></td>
</tr></table>

### Classic style

<table><tr valign="top">
<td><img src="docs/cpu-classic.png" width="160" alt="CPU Meter, classic"></td>
<td><img src="docs/gpu-classic.png" width="160" alt="GPU Meter, classic"></td>
<td><img src="docs/network-classic.png" width="160" alt="Network Meter, classic"></td>
<td><img src="docs/drives-classic.png" width="160" alt="Drives Meter, classic"></td>
<td><img src="docs/weather-classic.png" width="160" alt="Weather Meter, classic"></td>
</tr></table>

## Install

1. Install [8GadgetPack](https://8gadgetpack.net/) if you don't have the Sidebar yet.
2. Download the `.gadget` files from [Releases](https://github.com/Silverenio/modern-meters/releases/latest) and double-click each one you want. You don't need all five.
3. Right-click the desktop → **Gadgets**, and drag the gadget onto the desktop.
4. Settings: hover over the gadget and click the wrench icon.

To update, install the new `.gadget` files over the old ones the same way. Coming from 1.1.0 or older, restart the Sidebar once afterwards (right-click its tray icon → Exit, then start it again); newer versions reload by themselves when you press OK in their settings.

## Fitting them on the screen

The Sidebar doesn't move gadgets out of each other's way, so a column that is too tall overlaps. The quickest fix is the **Graph** setting: **Low** makes each gadget 15–25 px shorter. Drives Meter can also hide its graph, and CPU Meter can list cores instead of threads. With 175% scaling on a 1440p or 4K screen, all five fit in two columns (for example Weather, Drives and Network in one, GPU and CPU in the other) with Network and Weather graphs on Low.

## Optional extras

Everything works without them. They add data that Windows only gives to drivers or administrators.

| For | What to do |
|---|---|
| CPU temperature | Install [Core Temp](https://www.alcpu.com/CoreTemp/) and keep it running (it can start with Windows). Clicking "Core Temp off" on the gadget starts it, or opens the download page if it isn't installed. |
| GPU temperature on integrated graphics, watts on AMD/Intel | Discrete cards report temperature, fan, clocks and power (as % of the limit) by themselves. Integrated graphics often don't report temperature; run [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases) to fill it in. NVIDIA cards don't need it. |
| SSD life and temperature | Drives Meter settings → **SSD life & temperature** → **Turn on**, then approve the administrator prompt. This adds the scheduled task "ModernMeters Disk Health". It reads SSDs every 5 minutes and leaves hard drives alone so they can sleep. **Turn off** removes it. |

## Network access

- Network Meter looks up your external IP at api.ipify.org every 30 minutes and when the network changes. You can switch this off in its settings.
- Weather Meter gets the forecast from [Open-Meteo](https://open-meteo.com/) every 30 minutes. In Auto mode it asks the Windows location service where you are (Settings → Privacy → Location; if that's off, it uses your IP address via get.geojs.io) and gets the place name from OpenStreetMap. Coordinates are rounded to about 1 km before they leave your PC. Pick a city by clicking the place name to turn all of this off. The radar map loads its tiles from Esri (map) and RainViewer (rain), only while its tab is open; the tab can be turned off in the settings.
- Once a day one of the gadgets asks GitHub whether a newer release exists. If so, a small "↑ 1.x.x" badge appears in the top right corner of the gadgets and opens the release page when clicked. Nothing is downloaded or installed by itself. Settings → **About** → **New versions** → **Don't check** turns this off.

## Building from source

Run `build.ps1` in PowerShell. It draws the images, compiles the small .NET helpers (the Core Temp reader in `tools/coretemp`, the GPU sensor reader in `tools/gpu` and the panel painter for the colored styles in `tools/panel`, with the C# compiler that comes with Windows), and puts the packages in `dist`. `build.ps1 -Install` also copies the gadgets into your Sidebar.

## Support

The gadgets are free. If you like them, you can [buy me a coffee on Ko-fi](https://ko-fi.com/silverenio). It's also in every gadget's settings under **About**.

## License

[MIT](LICENSE) © 2026 Silverenio

---

# Modern Meters (по-русски)

Пять гаджетов для боковой панели Windows из 8GadgetPack:

| Гаджет | Что показывает |
|---|---|
| **CPU Meter Modern** | Загрузку каждого потока или ядра (P- и E-ядра сгруппированы), частоту, температуру, ОЗУ и выделенную память, график. Клик по названию процессора покажет самые активные программы по нагрузке и памяти |
| **GPU Meter Modern** | Загрузку GPU, видеопамять, контроллер памяти или общую память, мощность, вентилятор (обороты и %), частоты, кодер/декодер, температуру, график, сигнал при почти заполненной видеопамяти. Клик по названию карты покажет, какие программы занимают её память и нагружают GPU. NVIDIA, AMD и Intel, дискретные и встроенные, по тем же датчикам, что и Диспетчер задач |
| **Network Meter Modern** | Скорость загрузки и отдачи с автомасштабом графика, Wi-Fi сеть и сигнал, IP-адреса (скрыты, пока не кликнуть), брандмауэр, счётчики трафика |
| **Drives Meter Modern** | Физические диски с разделами, состояние SMART, остаток ресурса SSD, температуру, скорость чтения/записи, график активности |
| **Weather Meter Modern** | Погоду сейчас и цветной почасовой график температуры, осадков, ветра или давления (вкладки), радарную карту осадков за последние 80 минут, прогноз на 3 или 5 дней. Следует за вами из города в город через определение местоположения Windows |

У всех 12 языков (английский, украинский, русский, немецкий, испанский, французский, итальянский, польский, португальский, турецкий, китайский, японский), язык берётся из Windows; пять вариантов ширины, цвета акцента и пятиступенчатая цветовая шкала нагрузки и температуры. Как они выглядят, показано на скриншотах выше: светлый, цветное стекло, ретро-терминал, «Стекло» и классический.

Стили: «Стекло», «Классический», «Светлый», «Цветное стекло» (стекло в цвете акцента: голубой, бирюзовый, зелёный, фиолетовый, оранжевый, розовый, красный или жёлтый), «Ретро-терминал» (ЭЛТ-экран со строками развёртки в цвете акцента) и «Авто» — переключается между светлым и стеклом вслед за светлым/тёмным режимом Windows. Фон для цветных стилей рисуется один раз на вашем компьютере, когда впервые понадобится. Настройка **Для всех гаджетов** в любом гаджете сразу даёт всем гаджетам один стиль и язык (а при желании и цвет акцента).

## Установка

1. Установите [8GadgetPack](https://8gadgetpack.net/), если боковой панели ещё нет.
2. Скачайте `.gadget`-файлы со страницы [Releases](https://github.com/Silverenio/modern-meters/releases/latest) и дважды щёлкните каждый нужный. Ставить все пять не обязательно.
3. Правый клик по рабочему столу → **Гаджеты**, перетащите гаджет на рабочий стол.
4. Настройки: наведите мышь на гаджет и нажмите на значок гаечного ключа.

Чтобы обновиться, так же установите новые `.gadget`-файлы поверх старых. При обновлении с 1.1.0 и старше после этого один раз перезапустите боковую панель (правый клик по её значку в трее → Выход, затем запустите снова); новые версии сами перезагружаются, когда вы нажимаете OK в их настройках.

## Как уместить их на экране

Боковая панель не раздвигает гаджеты, поэтому слишком высокая колонка налезает сама на себя. Быстрее всего помогает настройка **График**: **Низкий** делает каждый гаджет на 15–25 px короче. В Drives Meter график можно скрыть совсем, а CPU Meter может показывать ядра вместо потоков. При масштабе 175% на экране 1440p или 4K все пять помещаются в две колонки (например, погода, диски и сеть в одной, GPU и CPU в другой), если у сети и погоды график «Низкий».

## Необязательные дополнения

Всё работает и без них. Они добавляют данные, которые Windows отдаёт только драйверам или администратору.

| Для чего | Что сделать |
|---|---|
| Температура процессора | Установите [Core Temp](https://www.alcpu.com/CoreTemp/) и держите запущенным (может стартовать с Windows). Клик по «нет Core Temp» на гаджете запускает его, а если он не установлен — открывает страницу загрузки. |
| Температура встроенной графики, ватты AMD/Intel | Дискретные видеокарты сами сообщают температуру, вентилятор, частоты и мощность (в % от лимита). Встроенная графика часто не сообщает температуру — её добавит запущенный [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases). Картам NVIDIA он не нужен. |
| Ресурс и температура SSD | Настройки Drives Meter → **Ресурс и температура SSD** → **Включить**, затем подтвердите запрос администратора. Это добавит задачу Планировщика «ModernMeters Disk Health». Она опрашивает SSD раз в 5 минут, а жёсткие диски не трогает, чтобы они могли спать. **Выключить** удаляет её. |

## Обращения в интернет

- Network Meter узнаёт внешний IP у api.ipify.org раз в 30 минут и при смене сети. Это отключается в его настройках.
- Weather Meter раз в 30 минут берёт прогноз у [Open-Meteo](https://open-meteo.com/). В режиме «Авто» он спрашивает у службы местоположения Windows, где вы (Параметры → Конфиденциальность → Расположение; если она выключена — определяет по IP через get.geojs.io), а название места берёт у OpenStreetMap. Координаты перед отправкой округляются примерно до 1 км. Если выбрать город кликом по названию места, всё это отключается. Радарная карта загружает плитки у Esri (карта) и RainViewer (осадки), только пока открыта её вкладка; вкладку можно выключить в настройках.
- Раз в сутки один из гаджетов спрашивает у GitHub, не вышла ли новая версия. Если вышла, в правом верхнем углу гаджетов появляется маленький значок «↑ 1.x.x», клик по нему открывает страницу выпуска. Сами гаджеты ничего не скачивают и не устанавливают. Отключается в настройках: **О гаджете** → **Новые версии** → **Не проверять**.

## Сборка из исходников

Запустите `build.ps1` в PowerShell. Он нарисует картинки, скомпилирует маленькие .NET-библиотеки (чтение Core Temp в `tools/coretemp`, датчиков видеокарты в `tools/gpu` и рисование фона цветных стилей в `tools/panel`, компилятором C#, который есть в Windows) и положит пакеты в `dist`. `build.ps1 -Install` заодно установит гаджеты в боковую панель.

## Поддержать

Гаджеты бесплатные. Если они вам нравятся, можно [угостить меня кофе на Ko-fi](https://ko-fi.com/silverenio). Эта же ссылка есть в настройках каждого гаджета, в разделе **О гаджете**.

## Лицензия

[MIT](LICENSE) © 2026 Silverenio
