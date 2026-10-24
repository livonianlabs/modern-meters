var DEFAULTS = {
    lang: "auto",
    updates: "on",
    theme: "classic",
    frost: "40",
    glass: "auto",
    accent: "blue",
    width: "170",
    interval: "1000",
    history: "auto",
    graph: "36",
    unit: "C",
    volumes: "on"
};

// Physical disks from the Windows storage API (works without admin rights), ordered by number.
// key: the per-disk show/hide setting, stable across reboots and USB re-plugs.
function listDisks() {
    var out = [];
    try {
        var svc = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", "root\\Microsoft\\Windows\\Storage");
        var e = new Enumerator(svc.ExecQuery("SELECT DeviceId, FriendlyName, MediaType, BusType, HealthStatus, Size FROM MSFT_PhysicalDisk"));
        for (; !e.atEnd(); e.moveNext()) {
            var d = e.item(), model = String(d.FriendlyName || "Disk " + d.DeviceId), size = parseFloat(d.Size) || 0;
            out.push({
                num: parseInt(d.DeviceId, 10),
                model: model,
                name: diskName(model, size),
                media: d.MediaType,     // 3 HDD, 4 SSD, 5 SCM
                bus: d.BusType,         // 7 USB, 11 SATA, 17 NVMe, ...
                health: d.HealthStatus, // 0 healthy, 1 warning, 2 unhealthy
                size: size,
                key: "disk_" + model.replace(/[^A-Za-z0-9]+/g, "_")
            });
        }
    } catch (err) { }
    out.sort(function (a, b) { return a.num - b.num; });
    return out;
}

// Short display name: "Samsung SSD 990 PRO 2TB" -> "Samsung 990 PRO 2TB",
// "ST16000NM001G-2KK103" -> "Seagate Exos 16TB"
function diskName(model, size) {
    var tb = Math.round(size / 1e12);
    var m = /^ST(\d+)NM/i.exec(model);
    if (m) return "Seagate Exos " + (tb || Math.round(parseInt(m[1], 10) / 1000)) + "TB";
    if (/^ST\d/i.test(model)) return "Seagate " + model.replace(/-.*$/, "");
    return model.replace(/^WDC\s+/i, "WD ").replace(/\s+SSD\s+/i, " ").replace(/\((R|TM)\)/gi, "")
        .replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

// Settings page layout (built by settings.js)
function settingsSpec() {
    var rows = [].concat(generalRows(false, [
        ["0", { en: "Hidden", ru: "Скрыт" }], ["24", { en: "Low", ru: "Низкий" }],
        ["36", { en: "Medium", ru: "Средний" }], ["56", { en: "Tall", ru: "Высокий" }]]), [
        { key: "volumes", label: { en: "Partitions", ru: "Разделы" }, options: OPT.onOff },
        { section: { en: "Disks", ru: "Диски" } }
    ]);
    var disks = listDisks();
    for (var i = 0; i < disks.length; i++)
        rows.push({ key: disks[i].key, label: disks[i].name, options: OPT.onOff });
    return rows.concat([
        { section: { en: "SSD life & temperature", ru: "Ресурс и температура SSD" } },
        { label: { en: "Status", ru: "Состояние" }, info: healthStatus },
        { label: "", buttons: [
            { label: { en: "Turn on", ru: "Включить" }, run: function () { runHealthInstaller(false); } },
            { label: { en: "Turn off", ru: "Выключить" }, run: function () { runHealthInstaller(true); } }] }
    ]);
}

var HEALTH_FILE = "%ProgramData%\\ModernMeters\\disk_health.txt";

// On while the scheduled task keeps the file fresh (it rewrites it every 5 minutes)
function healthStatus() {
    try {
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        var path = new ActiveXObject("WScript.Shell").ExpandEnvironmentStrings(HEALTH_FILE);
        if (fso.FileExists(path)) {
            var d = new Date(fso.GetFile(path).DateLastModified);
            if (new Date().getTime() - d.getTime() < 1200000) {
                var hm = d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
                return { en: "On · updated " + hm, ru: "Включено · обновлено " + hm };
            }
        }
    } catch (e) { }
    return { en: "Off", ru: "Выключено" };
}

// Windows asks for administrator approval; the installer creates or removes the task
function runHealthInstaller(uninstall) {
    var dir = IS_GADGET ? System.Gadget.path :
        unescape(location.pathname.replace(/^\/+/, "").replace(/[^\\\/]*$/, "")).replace(/\//g, "\\");
    try {
        new ActiveXObject("Shell.Application").ShellExecute("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + dir.replace(/\\$/, "") +
            "\\install-disk-health.ps1\"" + (uninstall ? " -Uninstall" : ""), "", "runas", 0);
    } catch (e) { }
}

var SETTINGS_NOTE = {
    en: "Health is the drive's own SMART verdict as reported by Windows. SSD life and temperature need administrator rights, so \"Turn on\" adds a small Windows scheduled task that reads them every 5 minutes (hard drives are left alone so they can sleep). Bars show used space; the number next to them is free space.",
    ru: "Состояние — вердикт SMART самого диска, который сообщает Windows. Ресурс и температура SSD доступны только администратору, поэтому «Включить» добавляет небольшую задачу Windows, которая читает их раз в 5 минут (жёсткие диски не трогаются, чтобы могли спать). Полоски показывают занятое место, число рядом — свободное."
};
