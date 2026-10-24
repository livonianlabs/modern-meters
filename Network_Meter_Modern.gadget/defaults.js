var DEFAULTS = {
    lang: "auto",
    updates: "on",
    theme: "classic",
    frost: "40",
    glass: "auto",
    accent: "teal",
    width: "170",
    interval: "1000",
    history: "auto",
    graph: "64",
    rate: "bits",
    adapter: "auto",
    ip: "on",
    extIp: "on",
    totals: "on",
    ping: "on",
    live: "off",
    alarm: "off",
    sound: "Alarm02.wav",
    volume: "100",
    repeat: "once"
};

// Counter instances of the network adapters, for the adapter list
function adapterOptions() {
    var opts = [["auto", { en: "Auto (internet connection)", ru: "Авто (подключение к интернету)" }]];
    try {
        var wmi = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", "root\\cimv2");
        var e = new Enumerator(wmi.ExecQuery("SELECT Name FROM Win32_PerfRawData_Tcpip_NetworkInterface"));
        for (; !e.atEnd(); e.moveNext()) opts.push([e.item().Name, e.item().Name]);
    } catch (err) { }
    var cur = getSetting("adapter");
    for (var i = 0; i < opts.length; i++) if (opts[i][0] == cur) return opts;
    opts.push([cur, cur]);   // configured adapter that is currently absent
    return opts;
}

// Settings page layout (built by settings.js)
function settingsSpec() {
    return [].concat(generalRows(true), [
        { key: "live", label: { en: "Live zone", ru: "Плавная зона" }, options: OPT.onOff },
        { key: "rate", label: { en: "Speed in", ru: "Скорость в" }, options: [
            ["bits", { en: "bits (Mbit/s)", ru: "битах (Мбит/с)" }],
            ["bytes", { en: "bytes (MB/s)", ru: "байтах (МБ/с)" }]] },
        { key: "ip", label: { en: "IP addresses", ru: "IP-адреса" }, options: OPT.onOff },
        { key: "extIp", label: { en: "External IP", ru: "Внешний IP" }, options: OPT.onOff },
        { key: "totals", label: { en: "Traffic totals", ru: "Счётчики трафика" }, options: OPT.onOff },
        { key: "ping", label: { en: "Ping", ru: "Пинг" }, options: OPT.onOff },
        { section: { en: "Network", ru: "Сеть" } },
        { key: "adapter", label: { en: "Adapter", ru: "Адаптер" }, options: adapterOptions() }
    ], alarmRows({ en: "Connection alarm", ru: "Сигнал обрыва связи" }, true));
}

var SETTINGS_NOTE = {
    en: "Live zone: the right part of the graph shows the last seconds sampled 5 times a second. Click the adapter name for details. The ♪ icon turns the connection-lost alarm on/off. IP addresses are masked; click one to show or hide them (they are masked again after a restart). External IP is looked up at api.ipify.org every 30 minutes and when the network changes; double-click it to look up again. Click \"Session\" to reset it, double-click \"Total\" to reset the total (it is kept in %APPDATA%\\ModernMeters).",
    ru: "Плавная зона: правая часть графика показывает последние секунды с опросом 5 раз в секунду. Клик по имени адаптера — подробности. Значок ♪ включает/выключает сигнал обрыва связи. IP-адреса скрыты; клик по адресу показывает или прячет их (после перезапуска снова скрыты). Внешний IP запрашивается у api.ipify.org раз в 30 минут и при смене сети; двойной клик по нему — запросить заново. Клик по «Сеанс» обнуляет его, двойной клик по «Всего» обнуляет общий счётчик (хранится в %APPDATA%\\ModernMeters)."
};
