var DEFAULTS = {
    lang: "auto",
    updates: "on",
    theme: "classic",
    accent: "blue",
    width: "170",
    interval: "1000",
    graph: "64",
    unit: "C",
    view: "threads",
    mem: "on",
    live: "off",
    alarm: "off",
    alarmTemp: "90",
    sound: "Alarm01.wav",
    volume: "100",
    repeat: "loop"
};

// Settings page layout (built by settings.js)
function settingsSpec() {
    return [].concat(generalRows(), [
        { key: "live", label: { en: "Live zone", ru: "Плавная зона" }, options: OPT.onOff },
        { key: "view", label: { en: "Per-core list", ru: "Список" }, options: [
            ["threads", { en: "All threads", ru: "Все потоки" }],
            ["cores", { en: "Cores (P/E)", ru: "Ядра (P/E)" }]] },
        { key: "mem", label: { en: "RAM / Commit", ru: "ОЗУ / Выделено" }, options: OPT.onOff }
    ], alarmRows());
}

var SETTINGS_NOTE = {
    en: "Live zone: the right part of the graph shows the last seconds sampled 5 times a second (a little more CPU use). Temperatures come from Core Temp, which must be running. Click ♪ on the gadget to turn the alarm on/off or to silence it.",
    ru: "Плавная зона: правая часть графика показывает последние секунды с опросом 5 раз в секунду (чуть больше нагрузки). Температуры берутся из Core Temp — он должен быть запущен. Кнопка ♪ на гаджете включает/выключает сигнал или глушит его."
};
