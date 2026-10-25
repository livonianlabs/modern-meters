var DEFAULTS = {
    lang: "auto",
    updates: "on",
    theme: "classic",
    frost: "40",
    glass: "auto",
    accent: "green",
    width: "170",
    interval: "1000",
    history: "auto",
    graph: "64",
    unit: "C",
    gpu: "0",
    allCards: "off",
    source: "auto",
    details: "on",
    top: "on",
    alarm: "off",
    alarmTemp: "85",
    vramAlarm: "off",
    sound: "Alarm01.wav",
    volume: "100",
    repeat: "loop"
};

// Graphics cards from the DirectX adapter list in the registry, which has the LUID the GPU
// performance counters are named by. Stale entries of removed cards stay in the registry, so
// only LUIDs that have live counters count. Biggest dedicated memory first (the "GPU" setting is
// an index into this list). [{ name, luid "0x..._0x...", vendor "10DE", dedicatedMB, sharedMB,
// integrated }]
function listGpus() {
    var out = [];
    try {
        var locator = new ActiveXObject("WbemScripting.SWbemLocator");
        var live = {}, e = new Enumerator(locator.ConnectServer(".", "root\\cimv2").ExecQuery(
            "SELECT Name FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory"));
        for (; !e.atEnd(); e.moveNext()) {
            var m = /^luid_(0x\w{8}_0x\w{8})_phys_0$/i.exec(e.item().Name);
            if (m) live[m[1].toUpperCase()] = true;
        }
        var reg = locator.ConnectServer(".", "root\\default").Get("StdRegProv");
        var key = "SOFTWARE\\Microsoft\\DirectX", keys = regValue(reg, "EnumKey", key, null, "sNames");
        keys = keys == null ? [] : new VBArray(keys).toArray();
        var seen = {};
        for (var i = 0; i < keys.length; i++) {
            var sub = key + "\\" + keys[i];
            var name = regValue(reg, "GetStringValue", sub, "Description", "sValue");
            var vendor = hex(parseFloat(regValue(reg, "GetDWORDValue", sub, "VendorId", "uValue")), 4);
            var luidNum = parseFloat(regValue(reg, "GetQWORDValue", sub, "AdapterLuid", "uValue"));
            if (!name || isNaN(luidNum) || vendor == "1414") continue;   // 1414: Microsoft Basic Render
            var luid = "0X" + hex(Math.floor(luidNum / 4294967296), 8) + "_0X" + hex(luidNum % 4294967296, 8);
            if (!live[luid] || seen[luid]) continue;
            seen[luid] = true;
            var ded = parseFloat(regValue(reg, "GetQWORDValue", sub, "DedicatedVideoMemory", "uValue")) / 1048576 || 0;
            out.push({
                name: name, luid: luid.replace(/0X/g, "0x"), vendor: vendor, dedicatedMB: ded,
                sharedMB: parseFloat(regValue(reg, "GetQWORDValue", sub, "SharedSystemMemory", "uValue")) / 1048576 || 0,
                // Integrated graphics get at most a small carve-out of their own and live on shared memory
                integrated: ded < 1024
            });
        }
    } catch (err) { }
    out.sort(function (a, b) { return b.dedicatedMB - a.dedicatedMB || (a.name < b.name ? -1 : 1); });
    return out;
}

function regValue(reg, method, sub, value, field) {
    try {
        var p = reg.Methods_.Item(method).InParameters.SpawnInstance_();
        p.hDefKey = 0x80000002;   // HKLM
        p.sSubKeyName = sub;
        if (value != null) p.sValueName = value;
        return reg.ExecMethod_(method, p)[field];
    } catch (e) {
        return null;
    }
}

function hex(n, digits) {
    var s = isNaN(n) ? "" : Math.round(n).toString(16).toUpperCase();
    while (s.length < digits) s = "0" + s;
    return s;
}

// Settings page layout (built by settings.js)
function settingsSpec() {
    var gpus = listGpus(), cards = [];
    for (var i = 0; i < Math.max(gpus.length, 1); i++)
        cards.push([String(i), gpus[i] ? gpus[i].name.replace(/^(NVIDIA|AMD|Intel\(R\))\s+/i, "") : "GPU " + i]);
    // Overheat, then nearly full video memory, both with the same sound
    var alarms = alarmRows({ en: "Alarms", ru: "Сигналы" });
    alarms.splice(3, 0, { key: "vramAlarm", label: { en: "VRAM above", ru: "VRAM больше" }, options: [
        ["off", OPT.onOff[1][1]], ["80", "80%"], ["90", "90%"], ["95", "95%"]] });
    return [].concat(generalRows(), [
        { key: "details", label: { en: "Bottom details", ru: "Нижние строки" }, options: OPT.onOff },
        { key: "top", label: { en: "Busiest program", ru: "Самая активная программа" }, options: OPT.onOff },
        { section: { en: "Data source", ru: "Источник данных" } },
        { key: "source", label: { en: "Source", ru: "Источник" }, options: [
            ["auto", { en: "Auto", ru: "Авто" }],
            ["smi", "nvidia-smi"],
            ["wmi", { en: "Windows counters", ru: "Счётчики Windows" }]] },
        { key: "gpu", label: { en: "Graphics card", ru: "Видеокарта" }, options: cards }
    ], gpus.length > 1 ? [
        { key: "allCards", label: { en: "All graphics cards", ru: "Все видеокарты" }, options: OPT.onOff }
    ] : [], alarms);
}

var SETTINGS_NOTE = {
    en: "Auto: nvidia-smi for NVIDIA (adds watts, encoder and PCIe), Windows for AMD and Intel, the same data Task Manager shows. Integrated graphics may not report temperature; LibreHardwareMonitor fills it in if it runs. Click ♪ on the gadget to turn the alarm on/off or to silence it, the blinking VRAM percentage to silence its alarm. Click the card's name for the processes using it.",
    ru: "Авто: для NVIDIA — nvidia-smi (плюс ватты, кодер и PCIe), для AMD и Intel — данные Windows, как в Диспетчере задач. Встроенная графика может не сообщать температуру; её добавит LibreHardwareMonitor, если он запущен. Кнопка ♪ на гаджете включает/выключает сигнал или глушит его, мигающий процент VRAM глушит её сигнал. Клик по названию карты покажет процессы, которые её используют."
};
