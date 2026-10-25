// Drives Meter Modern: physical disks with their partitions, SMART health, read/write speed
// with an auto-scaled graph, activity and temperature.
//  - Disks and health: MSFT_PhysicalDisk (storage API, no admin rights needed), re-read every
//    5 minutes and whenever the set of disks changes.
//  - Partitions: the PhysicalDisk counter instance names ("0 D: E:") tell which letters live on
//    which disk; sizes come from Win32_LogicalDisk every 10 s.
//  - Activity and speed: PhysicalDisk performance counters through a WMI refresher.

addStrings({
    en: {
        healthy: "Healthy", warning: "Warning", unhealthy: "Failing", unknown: "Unknown",
        free: "free", read: "R", write: "W", noDisks: "no disks to show",
        freeOf: "{f} free of {t}", tempTip: "Temperature (LibreHardwareMonitor)",
        healthTip: "SMART status reported by the drive", actTip: "Activity (busy time)",
        lifeTip: "Life left {l}% (wear {w}%)", hoursTip: "Powered on {h} h",
        ssdHint: "SSD life and temperature: turn them on in the gadget settings.",
        detailsTip: "Click for drive details",
        dModel: "Model", dSerial: "Serial number", dFirmware: "Firmware", dBus: "Interface", dType: "Type",
        dCapacity: "Capacity", dSector: "Sector size", dDiskNo: "Disk number", dHealthSec: "Health",
        dHealth: "SMART status", dLife: "Life left", dTemp: "Temperature", dHours: "Powered on",
        dVolumes: "Partitions", hoursUnit: "h"
    },
    ru: {
        healthy: "Исправен", warning: "Внимание", unhealthy: "Отказ", unknown: "Неизвестно",
        free: "своб.", read: "Чт", write: "Зп", noDisks: "нет дисков для показа",
        freeOf: "Свободно {f} из {t}", tempTip: "Температура (LibreHardwareMonitor)",
        healthTip: "Состояние SMART по данным диска", actTip: "Активность (время занятости)",
        lifeTip: "Остаток ресурса {l}% (износ {w}%)", hoursTip: "Наработка {h} ч",
        ssdHint: "Ресурс и температура SSD: включите в настройках гаджета.",
        detailsTip: "Нажмите, чтобы увидеть подробности диска",
        dModel: "Модель", dSerial: "Серийный номер", dFirmware: "Прошивка", dBus: "Интерфейс", dType: "Тип",
        dCapacity: "Ёмкость", dSector: "Размер сектора", dDiskNo: "Номер диска", dHealthSec: "Состояние",
        dHealth: "SMART", dLife: "Остаток ресурса", dTemp: "Температура", dHours: "Наработка",
        dVolumes: "Разделы", hoursUnit: "ч"
    }
});

var BUS = { 1: "SCSI", 3: "ATA", 7: "USB", 8: "RAID", 10: "SAS", 11: "SATA", 12: "SD", 17: "NVMe" };
var DRIVE_TEMP_STEPS = [30, 45, 55, 65];   // drives run cooler than CPUs and GPUs

var W, IW, accent, writeColor, unit, graphH, interval, showVolumes, narrow;
var ui = null, timer = null;
var wmi, refresher, perfSet;
var disks = [], layoutSig = null, nextHealth = 0, nextVolumes = 0, nextTemps = 0;
var hw = null, hwRetry = 0, smart = {}, nextSmart = 0, lastVols = {};

function init() {
    wmi = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", "root\\cimv2");
    hookSettings(rebuild);
    watchUpdates(rebuild);
    rebuild();
}

function shutdown() {
    if (timer) clearInterval(timer);
}


// ---- data -----------------------------------------------------------------

// Counter instances by disk number: { num: {name, letters[], item} }. With broken performance
// counters there are none: the drives still show with their space, without activity, and the
// counters are tried again on every tick.
function readPerf() {
    var out = {}, e;
    try {
        if (!refresher) {
            var r = new ActiveXObject("WbemScripting.SWbemRefresher");
            perfSet = r.AddEnum(wmi, "Win32_PerfFormattedData_PerfDisk_PhysicalDisk").ObjectSet;
            refresher = r;
        }
        refresher.Refresh();
        e = new Enumerator(perfSet);
    } catch (err) {
        refresher = null;
        return out;
    }
    for (; !e.atEnd(); e.moveNext()) {
        var it = e.item(), name = String(it.Name), m = /^(\d+)\s*(.*)$/.exec(name);
        if (!m) continue;
        out[m[1]] = { name: name, letters: m[2] ? m[2].split(/\s+/) : [], item: it };
    }
    return out;
}

function perfSignature(perf) {
    var names = [];
    for (var k in perf) names.push(perf[k].name);
    return names.sort().join("|");
}

function readVolumes() {
    var out = {};
    var e = new Enumerator(wmi.ExecQuery("SELECT DeviceID, VolumeName, FileSystem, Size, FreeSpace FROM Win32_LogicalDisk WHERE DriveType=2 OR DriveType=3"));
    for (; !e.atEnd(); e.moveNext()) {
        var v = e.item();
        out[v.DeviceID] = { label: v.VolumeName || "", fs: v.FileSystem || "", size: parseFloat(v.Size) || 0, free: parseFloat(v.FreeSpace) || 0 };
    }
    return out;
}

// Drive temperatures by model name, from LibreHardwareMonitor / OpenHardwareMonitor if running
function readTemps() {
    if (!hw) {
        if (now() < hwRetry) return {};
        hwRetry = now() + 60000;
        var spaces = ["root\\LibreHardwareMonitor", "root\\OpenHardwareMonitor"];
        for (var i = 0; i < spaces.length && !hw; i++) {
            try { hw = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", spaces[i]); } catch (e) { }
        }
        if (!hw) return {};
    }
    var temps = {};
    try {
        var drives = {}, e2 = new Enumerator(hw.ExecQuery("SELECT Identifier, Name, HardwareType FROM Hardware"));
        for (; !e2.atEnd(); e2.moveNext())
            if (/^(Storage|HDD)$/i.test(String(e2.item().HardwareType))) drives[String(e2.item().Identifier)] = String(e2.item().Name);
        var e3 = new Enumerator(hw.ExecQuery("SELECT Parent, Name, Value FROM Sensor WHERE SensorType='Temperature'"));
        for (; !e3.atEnd(); e3.moveNext()) {
            var s = e3.item(), model = drives[String(s.Parent)];
            // The first sensor is the composite / drive temperature
            if (model && temps[model] == null) temps[model] = parseFloat(s.Value);
        }
    } catch (err) {
        hw = null;   // LHM was closed; reconnect later
    }
    return temps;
}

// Capacity the way drives are sold: decimal, rounded ("16 TB", "500 GB")
function diskSize(b) {
    return b >= 1e12 ? Math.round(b / 1e12) + " " + T("TB") : Math.round(b / 1e9) + " " + T("GB");
}

// SSD wear and temperature written by the "ModernMeters Disk Health" task (diskhealth.js),
// by disk number. Ignored when stale, e.g. after the task was removed.
function readSmart() {
    var out = {}, path = new ActiveXObject("WScript.Shell").ExpandEnvironmentStrings("%ProgramData%") +
        "\\ModernMeters\\disk_health.txt";
    try {
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        if (!fso.FileExists(path) || now() - new Date(fso.GetFile(path).DateLastModified).getTime() > 1200000) return out;
        var f = fso.OpenTextFile(path, 1), lines = f.AtEndOfStream ? [] : f.ReadAll().split(/\r?\n/);
        f.Close();
        for (var i = 0; i < lines.length; i++) {
            var m = /^(\d+)\s+wear=(\d*)\s+temp=(\d*)\s+hours=(\d*)/.exec(lines[i]);
            if (m) out[m[1]] = { wear: num(m[2]), temp: num(m[3]) || null, hours: num(m[4]) };
        }
    } catch (e) { }
    return out;
}

// ---- details flyout -------------------------------------------------------

function diskDetails(d) {
    var dd = null, s = smart[d.num], h = d.health;
    try {
        var e = new Enumerator(wmi.ExecQuery("SELECT SerialNumber, FirmwareRevision, BytesPerSector FROM Win32_DiskDrive WHERE Index=" + d.num));
        if (!e.atEnd()) dd = e.item();
    } catch (err) { }
    var vols = [];
    for (var i = 0; i < d.letters.length; i++) {
        var v = lastVols[d.letters[i]];
        if (v) vols.push([d.letters[i] + " " + v.label.replace(/\s*\(\w\)$/, ""),
            T("freeOf").replace("{f}", fmtBytes(v.free)).replace("{t}", fmtBytes(v.size)) + (v.fs ? " · " + v.fs : "")]);
    }
    return [
        { title: d.name, rows: [
            [T("dModel"), d.model],
            [T("dSerial"), dd ? trim(dd.SerialNumber || "").replace(/\.$/, "") : ""],
            [T("dFirmware"), dd ? dd.FirmwareRevision : ""],
            [T("dBus"), BUS[d.bus] || ""],
            [T("dType"), d.media == 3 ? "HDD" : (d.media == 4 ? "SSD" : "")],
            [T("dCapacity"), d.size ? diskSize(d.size) + " (" + fmtBytes(d.size) + ")" : ""],
            [T("dSector"), dd && dd.BytesPerSector ? dd.BytesPerSector + " " + T("B") : ""],
            [T("dDiskNo"), String(d.num)]] },
        { title: T("dHealthSec"), rows: [
            [T("dHealth"), T(h == 0 ? "healthy" : (h == 1 ? "warning" : (h == 2 ? "unhealthy" : "unknown")))],
            [T("dLife"), s && s.wear != null ? Math.max(0, 100 - s.wear) + "%" : ""],
            [T("dTemp"), s && s.temp ? fmtTemp(s.temp, unit) + unit : ""],
            [T("dHours"), s && s.hours ? s.hours + " " + T("hoursUnit") : ""]] },
        { title: T("dVolumes"), rows: vols }
    ];
}

// ---- layout ---------------------------------------------------------------

function readSettings() {
    LANG = langCode(getSetting("lang"));
    applyTheme(getSetting("theme"));
    W = parseInt(getSetting("width"), 10);
    IW = W - 2 * PAD;
    narrow = W < 240;
    accent = ACCENTS[getSetting("accent")] || ACCENTS.blue;
    writeColor = getSetting("accent") == "purple" ? ACCENTS.pink : ACCENTS.purple;
    unit = getSetting("unit");
    graphH = parseInt(getSetting("graph"), 10);
    interval = parseInt(getSetting("interval"), 10);
    showVolumes = getSetting("volumes") != "off";
}

function volumeRow(root, y) {
    var r = {}, valW = narrow ? 46 : 100;
    r.name = label(root, PAD, y, IW - 34 - valW, 11, THEME.dim);
    r.val = label(root, W - PAD - 34 - valW, y + (narrow ? 1 : 0), valW - 4, narrow ? 10 : 11, THEME.faint, "right");
    r.pct = label(root, W - PAD - 34, y, 34, 11, THEME.text, "right", true);
    r.bar = new Bar(root, PAD, y + 18, IW, 4);
    return r;
}

function rebuild() {
    if (timer) clearInterval(timer);
    if (ui) for (var j = 0; j < ui.disks.length; j++) keepGraph("disk" + disks[j].num, ui.disks[j].graph);
    readSettings();

    var perf = readPerf();
    layoutSig = perfSignature(perf);
    disks = [];
    var all = listDisks();
    for (var i = 0; i < all.length; i++) {
        if (getSetting(all[i].key) == "off") continue;
        var p = perf[all[i].num];
        all[i].letters = p ? p.letters : [];
        disks.push(all[i]);
    }

    var root = $("root");
    root.innerHTML = "";
    ui = { disks: [] };
    var y = header(root, 10, "disk", T("hdrDrives"));

    // Without the performance counters there is no activity: a line to repair them
    if (perfCountersBroken()) {
        ui.perf = label(root, PAD, y + 2, IW, 11, THEME.hot);
        counterRepairLink(ui.perf);
        y += 22;
    }

    if (!disks.length) {
        setText(label(root, PAD, y + 4, IW, 11, THEME.dim), T("noDisks"));
        y += 30;
    }

    for (i = 0; i < disks.length; i++) {
        var d = disks[i], b = { volumes: [] };
        if (i > 0) {
            rect(root, PAD, y, IW, 1, THEME.sep);
            y += 9;
        }
        b.name = label(root, PAD, y + 2, IW, narrow ? 12 : 13, THEME.text, "left", true);
        setLinkText(b.name, d.name);
        b.name.title = d.model + "\n" + T("detailsTip");
        b.name.style.cursor = "hand";
        b.name.onclick = (function (disk) { return function () { toggleDetails(diskDetails(disk)); }; })(d);
        y += 21;

        // "NVMe · SSD" followed by the temperature in its own color
        b.sub = label(root, PAD, y, IW - 70, narrow ? 10 : 11, THEME.dim);
        b.kind = document.createElement("span");
        b.temp = document.createElement("span");
        b.temp.title = T("tempTip");
        b.sub.appendChild(b.kind);
        b.sub.appendChild(b.temp);
        // NVMe implies SSD, and the size is left out when the model name already says it
        var kind = [];
        if (BUS[d.bus]) kind.push(BUS[d.bus]);
        if (d.media == 3) kind.push("HDD");
        else if (d.media == 4 && d.bus != 17) kind.push("SSD");
        if (d.size && !/\d\s*[TG]B/i.test(d.name)) kind.push(diskSize(d.size));
        setText(b.kind, kind.join(" · "));
        b.health = label(root, W - PAD - 70, y, 70, narrow ? 10 : 11, THEME.dim, "right");
        y += 19;

        // One row per partition, or a single row for the whole disk
        var groups = showVolumes ? d.letters.slice(0) : (d.letters.length ? [d.letters.join(" ")] : []);
        for (var k = 0; k < groups.length; k++) {
            var row = volumeRow(root, y);
            row.letters = groups[k].split(" ");
            b.volumes.push(row);
            y += 28;
        }

        b.read = label(root, PAD, y, narrow ? 64 : IW / 3, 10, accent);
        b.write = label(root, PAD + (narrow ? 64 : IW / 3), y, narrow ? 64 : IW / 3, 10, writeColor);
        b.act = label(root, W - PAD - 40, y - 1, 40, 11, THEME.text, "right", true);
        b.act.title = T("actTip");
        y += 18;

        if (graphH > 0) {
            // Read as an area, write as a line, scaled to the busiest moment on screen
            b.graph = new Graph(root, PAD, y, IW, graphH, [{ color: accent, area: true }, { color: writeColor, area: false }]);
            b.scaleLabel = cornerLabel(root, PAD + IW - 1, y + 1, 8);
            b.graph.span = historySpan(IW, interval);
            restoreGraph("disk" + d.num, b.graph);
            b.graph.tip(interval, [T("read"), T("write")], function (s, v) { return fmtByteRate(v); });
            b.scale = 0;
            y += graphH + 6;
        }
        ui.disks.push(b);
    }

    updateBadge(root);
    paintFrame(W, y + 6);
    nextHealth = now() + 300000;
    nextVolumes = 0;
    nextTemps = 0;
    nextSmart = 0;
    tick(perf);
    timer = setInterval(function () { tick(null); }, interval);
}

// ---- update ---------------------------------------------------------------

function tick(perf) {
    try {
        perf = perf || readPerf();
        if (ui.perf) counterRepairLink(ui.perf);
        if (perfSignature(perf) != layoutSig) {   // disk added, removed or repartitioned
            rebuild();
            return;
        }
        if (now() >= nextHealth) {
            nextHealth = now() + 300000;
            var fresh = listDisks();
            for (var i = 0; i < disks.length; i++)
                for (var j = 0; j < fresh.length; j++) if (fresh[j].num == disks[i].num) disks[i].health = fresh[j].health;
        }
        if (now() >= nextVolumes) {
            nextVolumes = now() + 10000;
            lastVols = readVolumes();
            showVolumesInfo(lastVols);
        }
        if (now() >= nextSmart) {
            nextSmart = now() + 60000;
            smart = readSmart();
            nextTemps = 0;
        }
        if (now() >= nextTemps) {
            nextTemps = now() + 15000;
            showTemps(readTemps());
        }
    } catch (e) {
        if (ui.disks.length) reportError(ui.disks[0].sub, "tick", e);
        return;
    }

    for (i = 0; i < disks.length; i++) {
        var d = disks[i], b = ui.disks[i], p = perf[d.num];
        showHealth(d, b);
        if (!p) continue;
        var act = clamp(100 - (parseFloat(p.item.PercentIdleTime) || 0), 0, 100);
        var rd = parseFloat(p.item.DiskReadBytesPersec) || 0, wr = parseFloat(p.item.DiskWriteBytesPersec) || 0;
        setText(b.read, T("read") + " " + fmtByteRate(rd));
        setText(b.write, T("write") + " " + fmtByteRate(wr));
        setText(b.act, Math.round(act) + "%");
        setColor(b.act, pctColor(act));
        if (b.graph) pushRW(b, rd, wr);
    }
}

// SMART verdict plus, for SSDs, the life left; colors follow whichever is worse
function showHealth(d, b) {
    var h = d.health, s = smart[d.num], life = s && s.wear != null ? Math.max(0, 100 - s.wear) : null;
    var color = h == 0 ? LEVELS[1] : (h == 1 ? LEVELS[3] : (h == 2 ? THEME.hot : THEME.faint));
    if (life != null && life < 10) color = THEME.hot;
    else if (life != null && life < 20 && h == 0) color = LEVELS[3];
    var tip = T("healthTip");
    if (life != null) tip += "\n" + T("lifeTip").replace("{l}", life).replace("{w}", s.wear);
    if (s && s.hours) tip += "\n" + T("hoursTip").replace("{h}", s.hours);
    if (!s && d.media == 4) tip += "\n" + T("ssdHint");
    var text = T(h == 0 ? "healthy" : (h == 1 ? "warning" : (h == 2 ? "unhealthy" : "unknown"))) +
        (life != null ? " " + life + "%" : "");
    setText(b.health, text);
    setColor(b.health, color);
    // The verdict takes the room it needs and the line left of it the rest, whatever the font
    var hw = Math.min(textWidth(text, narrow ? 10 : 11) + 2, IW - 60);
    b.health.style.left = (W - PAD - hw) + "px";
    b.health.style.width = hw + "px";
    b.sub.style.width = (IW - hw - 6) + "px";
    b.health.title = tip;
}

// Smallest 1/2/5 step in binary units (KB/s, MB/s, ...) that covers v bytes per second
function niceScale(v) {
    v = Math.max(v, 10240);
    var mult = 1;
    while (v / mult >= 1000) mult *= 1024;
    var m = v / mult, p = Math.pow(10, Math.floor(Math.log(m) / Math.LN10)), steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= m) return steps[i] * p * mult;
    return 10 * p * mult;
}

// Read and write on one scale, the busiest moment on screen rounded up
function pushRW(b, rd, wr) {
    b.graph.push([rd, wr]);
    var sc = niceScale(b.graph.peak());
    if (sc != b.scale) {
        b.scale = sc;
        b.graph.setMax(sc);
        setCorner(b.scaleLabel, scaled(sc, ["Bs", "KBs", "MBs", "GBs"], 1024, true));
    }
}

function showVolumesInfo(vols) {
    for (var i = 0; i < disks.length; i++) {
        var rows = ui.disks[i].volumes;
        for (var k = 0; k < rows.length; k++) {
            var r = rows[k], size = 0, free = 0, name = r.letters.join(" ");
            for (var n = 0; n < r.letters.length; n++) {
                var v = vols[r.letters[n]];
                if (!v) continue;
                size += v.size;
                free += v.free;
                // Labels often repeat the letter: "GAMES (D)"
                if (r.letters.length == 1 && v.label) name += " " + v.label.replace(/\s*\(\w\)$/, "");
            }
            var used = size ? (size - free) / size * 100 : null;
            setText(r.name, name);
            setText(r.val, size ? fmtBytes(free) + (narrow ? "" : " " + T("free")) : "");
            setText(r.pct, used == null ? "–" : Math.round(used) + "%");
            setColor(r.pct, pctColor(used));
            r.bar.set(used, loadColor(used || 0, accent));
            r.name.title = r.val.title = r.pct.title = size ?
                T("freeOf").replace("{f}", fmtBytes(free)).replace("{t}", fmtBytes(size)) : "";
        }
    }
}

function showTemps(temps) {
    for (var i = 0; i < disks.length; i++) {
        var s = smart[disks[i].num], t = s && s.temp ? s.temp : temps[disks[i].model];
        var el = ui.disks[i].temp, has = t != null && !isNaN(t);
        setText(el, has ? " · " + fmtTemp(t, unit) : "");
        setColor(el, levelColor(t == null || isNaN(t) ? null : t, DRIVE_TEMP_STEPS));
    }
}
