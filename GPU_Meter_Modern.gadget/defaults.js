var DEFAULTS = {
    lang: "en",
    updates: "on",
    theme: "classic",
    accent: "green",
    width: "170",
    interval: "1000",
    graph: "64",
    unit: "C",
    gpu: "0",
    source: "auto",
    details: "on",
    alarm: "off",
    alarmTemp: "85",
    sound: "Alarm01.wav",
    volume: "100",
    repeat: "loop"
};

// Settings page layout (built by settings.js)
function settingsSpec() {
    return [].concat(generalRows(), [
        { key: "details", label: { en: "Bottom details", ru: "Нижние строки" }, options: OPT.onOff },
        { section: { en: "Data source", ru: "Источник данных" } },
        { key: "source", label: { en: "Source", ru: "Источник" }, options: [
            ["auto", { en: "Auto", ru: "Авто" }],
            ["smi", "nvidia-smi"],
            ["wmi", { en: "Windows counters", ru: "Счётчики Windows" }]] },
        { key: "gpu", label: { en: "Graphics card", ru: "Видеокарта" }, options: [
            ["0", "GPU 0"], ["1", "GPU 1"], ["2", "GPU 2"], ["3", "GPU 3"]] }
    ], alarmRows());
}

var SETTINGS_NOTE = {
    en: "Auto: nvidia-smi for NVIDIA (full data), Windows counters for AMD/Intel. For AMD/Intel, temperature, fan and power need LibreHardwareMonitor running. Click ♪ on the gadget to turn the alarm on/off or to silence it.",
    ru: "Авто: для NVIDIA — nvidia-smi (полные данные), для AMD/Intel — счётчики Windows. Температура, вентилятор и мощность AMD/Intel — если запущен LibreHardwareMonitor. Кнопка ♪ на гаджете включает/выключает сигнал или глушит его."
};
