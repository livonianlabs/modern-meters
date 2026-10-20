// GPU Meter Modern: GPU stats from one of two providers, both sampled outside the gadget
// so the Sidebar never blocks:
//  - nvidia-smi: launched hidden (one at a time), writes one CSV line read on the next tick
//    (full data: clocks, temperature, power, fan, memory controller).
//  - Windows (any vendor): gpuhelper.js runs hidden in the background and writes key=value
//    records from the GPU performance counters and D3DKMT (ModernMetersGpu.dll), the sources
//    Task Manager uses; LibreHardwareMonitor adds what the driver doesn't report if it runs.

var W, IW, accent, unit, graphH, interval, gpuIndex, source, showDetails, narrow;
var ui = null, timer = null;
var shell, fso, wmi, smiPath = null, provider = null, misses = 0;
var gpus = [], card = null;   // listGpus() (defaults.js), and the one picked in the settings

function init() {
    shell = new ActiveXObject("WScript.Shell");
    fso = new ActiveXObject("Scripting.FileSystemObject");
    wmi = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", "root\\cimv2");
    smiPath = findSmi();
    gpus = listGpus();
    hookSettings(rebuild);
    watchUpdates(rebuild);
    rebuild();
}

function shutdown() {
    if (timer) clearInterval(timer);
    if (provider) provider.stop();
    if (ui && ui.alarm) ui.alarm.dispose();
}

function tempPath(name) {
    return shell.ExpandEnvironmentStrings("%TEMP%") + "\\gpu_meter_modern_" + gpuIndex + "_" + name;
}

function readFile(path) {
    if (!fso.FileExists(path)) return null;
    try {
        var f = fso.OpenTextFile(path, 1);
        var text = f.AtEndOfStream ? "" : f.ReadAll();
        f.Close();
        return text;
    } catch (e) {
        return null;
    }
}

function mhz(v) {
    return Math.round(v || 0);
}

// ---- provider: nvidia-smi -------------------------------------------------

var SMI_FIELDS = [
    "name", "driver_version", "utilization.gpu", "utilization.memory",
    "utilization.encoder", "utilization.decoder", "memory.used", "memory.total",
    "temperature.gpu", "fan.speed", "power.draw", "power.limit",
    "clocks.gr", "clocks.mem", "pstate", "pcie.link.gen.current", "pcie.link.width.current"
];

function findSmi() {
    var win = shell.ExpandEnvironmentStrings("%WINDIR%");
    var pf = shell.ExpandEnvironmentStrings("%ProgramW6432%");
    var candidates = [
        win + "\\System32\\nvidia-smi.exe",
        win + "\\Sysnative\\nvidia-smi.exe",
        pf + "\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"
    ];
    for (var i = 0; i < candidates.length; i++)
        if (fso.FileExists(candidates[i])) return candidates[i];
    return null;
}

// Only one nvidia-smi runs at a time. If it doesn't finish (driver reset, out of memory,
// "unable to start" dialog) it is killed and the next launch waits longer, up to 5 minutes,
// so a broken driver never piles up processes.
var SMI_TIMEOUT = 15000, SMI_MAX_WAIT = 300000;

function SmiProvider() {
    this.out = tempPath("smi.csv");
    this.launched = 0;
    this.wait = SMI_TIMEOUT;
}

SmiProvider.prototype.start = function () {
    this.kill();
    try { fso.DeleteFile(this.out, true); } catch (e) { }
    // nvidia-smi only has the fan in percent; the D3DKMT reader adds its RPM
    this.kmt = null;
    if (!card) return;
    try {
        if (IS_GADGET) registerDotNet("{8c41d7a2-6f0e-4b9d-b3a5-2e7f19c4d860}", "ModernMeters.GpuReader", "ModernMetersGpu");
        var k = new ActiveXObject("ModernMeters.GpuReader");
        if (k.Open(card.luid)) this.kmt = k;
    } catch (e2) { }
};

SmiProvider.prototype.stop = function () {
    this.kill();
    try { if (this.kmt) this.kmt.Close(); } catch (e) { }
    this.kmt = null;
};

// Fan speed in RPM from D3DKMT, or null
SmiProvider.prototype.fanRpm = function () {
    try {
        if (this.kmt && this.kmt.Refresh() && this.kmt.FanRpm >= 0) return this.kmt.FanRpm;
    } catch (e) { }
    return null;
};

// Terminates nvidia-smi instances writing to our file; returns how many were still alive
SmiProvider.prototype.kill = function () {
    var n = 0;
    try {
        var e = new Enumerator(wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='nvidia-smi.exe'"));
        for (; !e.atEnd(); e.moveNext()) {
            if (String(e.item().CommandLine).indexOf(this.out) < 0) continue;
            n++;
            try { e.item().Terminate(); } catch (err) { }
        }
    } catch (err2) { }
    return n;
};

SmiProvider.prototype.launch = function () {
    var now = new Date().getTime();
    if (this.launched) {
        if (now - this.launched < this.wait) return;
        // Previous run never produced output
        this.kill();
        this.wait = Math.min(this.wait * 2, SMI_MAX_WAIT);
    }
    this.launched = now;
    try {
        shell.Run("\"" + smiPath + "\" -i " + smiIndex() + " --query-gpu=" + SMI_FIELDS.join(",") +
            " --format=csv,noheader,nounits -f \"" + this.out + "\"", 0, false);
    } catch (e) { }
};

SmiProvider.prototype.poll = function () {
    var text = readFile(this.out);
    var parts = text == null ? [] : trim(text).split(",");
    var ok = parts.length == SMI_FIELDS.length;
    if (ok || (text != null && this.launched && new Date().getTime() - this.launched > 2000)) {
        // Finished (good or garbage): consume the file and allow the next launch
        try { fso.DeleteFile(this.out, true); } catch (e2) { }
        this.launched = 0;
        if (ok) this.wait = SMI_TIMEOUT;
    }
    this.launch();
    if (!ok) return null;
    var r = {};
    for (var i = 0; i < SMI_FIELDS.length; i++) r[SMI_FIELDS[i]] = trim(parts[i]);

    var fan = num(r["fan.speed"]), rpm = this.fanRpm(), clk = mhz(num(r["clocks.gr"])), mclk = mhz(num(r["clocks.mem"]));
    return {
        name: r.name,
        usage: num(r["utilization.gpu"]),
        vramUsed: num(r["memory.used"]),
        vramTotal: num(r["memory.total"]),
        row2: { label: T("memctl"), val: "", pct: num(r["utilization.memory"]) },
        temp: num(r["temperature.gpu"]),
        power: num(r["power.draw"]),
        powerLimit: num(r["power.limit"]),
        fan: fan,
        fanText: fan == null ? T("na") : (fan == 0 ? T("stopped") : fanRpmText(rpm)),
        sub: narrow ? clk + " / " + mclk + " " + T("MHz") :
            clk + " " + T("MHz") + "  ·  " + T("mem") + " " + mclk + " " + T("MHz"),
        enc: num(r["utilization.encoder"]),
        dec: num(r["utilization.decoder"]),
        link: r.pstate + "  ·  PCIe " + r["pcie.link.gen.current"] + ".0 x" + r["pcie.link.width.current"],
        footer: T("driver") + " " + r.driver_version + "  ·  nvidia-smi"
    };
};

// "1250 RPM"; narrow gadgets drop the unit, which would run into the label
function fanRpmText(rpm) {
    if (rpm == null) return "";
    return Math.round(rpm) + (narrow ? "" : " " + T("RPM"));
}

// nvidia-smi numbers only the NVIDIA cards
function smiIndex() {
    if (!card) return gpuIndex;
    var n = 0;
    for (var i = 0; i < gpus.length && gpus[i] != card; i++) if (gpus[i].vendor == "10DE") n++;
    return n;
}

// ---- provider: Windows (gpuhelper.js) -------------------------------------

function CounterProvider() {
    this.out = tempPath("wmi.txt");
    this.hb = tempPath("alive");
    this.driver = driverVersion(card.name);
}

function driverVersion(name) {
    try {
        var e = new Enumerator(wmi.ExecQuery("SELECT Name,DriverVersion FROM Win32_VideoController"));
        for (; !e.atEnd(); e.moveNext()) if (e.item().Name == name) return e.item().DriverVersion;
    } catch (err) { }
    return "";
}

// Kills helpers left over from a previous gadget instance writing to the same file
CounterProvider.prototype.stop = function () {
    try {
        var e = new Enumerator(wmi.ExecQuery(
            "SELECT CommandLine FROM Win32_Process WHERE Name='wscript.exe' OR Name='cscript.exe'"));
        for (; !e.atEnd(); e.moveNext()) {
            var cl = String(e.item().CommandLine);
            if (cl.indexOf("gpuhelper.js") >= 0 && cl.indexOf(this.out) >= 0) e.item().Terminate();
        }
    } catch (err) { }
    try { fso.DeleteFile(this.hb, true); } catch (err2) { }
};

CounterProvider.prototype.touch = function () {
    try { var f = fso.CreateTextFile(this.hb, true); f.Write("1"); f.Close(); } catch (e) { }
};

CounterProvider.prototype.start = function () {
    this.stop();
    this.touch();
    // The helper creates the D3DKMT reader through COM; without it it still has the counters
    if (IS_GADGET) try { registerDotNet("{8c41d7a2-6f0e-4b9d-b3a5-2e7f19c4d860}", "ModernMeters.GpuReader", "ModernMetersGpu"); } catch (e) { }
    var script = IS_GADGET ? System.Gadget.path + "\\gpuhelper.js" :
        unescape(location.pathname.replace(/^\/+/, "").replace(/[^\\\/]*$/, "")).replace(/\//g, "\\") + "gpuhelper.js";
    shell.Run("wscript.exe //B //Nologo \"" + script + "\" \"" + this.out + "\" \"" + this.hb + "\" " +
        card.luid + " " + Math.max(interval, 1000) + " " + gpuIndex, 0, false);
};

CounterProvider.prototype.poll = function () {
    this.touch();
    var text = readFile(this.out);
    if (text == null || text.indexOf("end=1") < 0) return null;
    var r = {}, lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var k = lines[i].indexOf("=");
        if (k > 0) r[lines[i].substring(0, k)] = lines[i].substring(k + 1);
    }
    var fan = num(r.fan), rpm = num(r.fanrpm), clk = num(r.clock), mclk = num(r.mclock);
    var sub = clk == null ? "3D " + r.td + "%  ·  Copy " + r.copy + "%" :
        mclk == null ? mhz(clk) + " " + T("MHz") :
        narrow ? mhz(clk) + " / " + mhz(mclk) + " " + T("MHz") :
        mhz(clk) + " " + T("MHz") + "  ·  " + T("mem") + " " + mhz(mclk) + " " + T("MHz");
    var ded = num(r.vram), shared = num(r.shared), temp = num(r.temp);
    var gb = function (mb) { return (mb / 1024).toFixed(1); };
    var d = {
        name: card.name,
        usage: num(r.usage),
        temp: temp,
        power: num(r.power),
        powerLimit: null,
        powerPct: num(r.powerpct),
        fan: fan,
        fanText: rpm != null && rpm == 0 && fan != null ? T("stopped") :
            rpm != null ? fanRpmText(rpm) : (fan == null ? T("na") : ""),
        sub: sub,
        enc: num(r.enc),
        dec: num(r.dec),
        link: temp == null ? T("noSensors") : T(r.lhm && !r.kmt ? "lhm" : "winSensors"),
        footer: T("driver") + " " + this.driver + (narrow ? "" : "  ·  " + T("counters"))
    };
    var sharedLabel = T(narrow ? "sharedShort" : "shared");
    if (card.integrated) {
        // Integrated graphics work out of shared system memory; their own carve-out is a footnote
        d.memLabel = sharedLabel;
        d.vramUsed = shared;
        d.vramTotal = card.sharedMB;
        d.row2 = { label: T("vram"), val: ded == null ? "" : fmtPair(gb(ded), gb(card.dedicatedMB), "GB", narrow), pct: pctOf(ded, card.dedicatedMB) };
    } else {
        d.vramUsed = ded;
        d.vramTotal = card.dedicatedMB;
        d.row2 = { label: sharedLabel, val: shared == null ? "" : gb(shared) + " " + T("GB"), pct: null, noPct: true };
    }
    return d;
};

function pickProvider() {
    if (source == "smi" || (source == "auto" && smiPath && (!card || card.vendor == "10DE")))
        return smiPath ? new SmiProvider() : null;
    return card ? new CounterProvider() : null;
}

// ---- layout ---------------------------------------------------------------

function readSettings() {
    LANG = langCode(getSetting("lang"));
    applyTheme(getSetting("theme"));
    W = parseInt(getSetting("width"), 10);
    IW = W - 2 * PAD;
    narrow = W < 240;
    accent = ACCENTS[getSetting("accent")] || ACCENTS.green;
    unit = getSetting("unit");
    graphH = parseInt(getSetting("graph"), 10);
    interval = parseInt(getSetting("interval"), 10);
    gpuIndex = parseInt(getSetting("gpu"), 10) || 0;
    card = gpus[gpuIndex] || gpus[0] || null;
    source = getSetting("source");
    showDetails = getSetting("details") != "off";
}

// The label may run under the value: values are right-aligned and short enough to leave room
function meterRow(root, y, name, kind) {
    var r = {}, dx = rowIcon(root, PAD, y, kind);
    r.name = label(root, PAD + dx, y, IW - 34 - dx, 11, THEME.dim);
    setText(r.name, name);
    r.val = narrow ? label(root, PAD + 40, y + 1, IW - 40 - 34, 10, THEME.text, "right") :
        label(root, PAD + 40, y, IW - 40 - 34, 11, THEME.text, "right");
    r.pct = label(root, W - PAD - 34, y, 34, 11, THEME.text, "right", true);
    r.bar = new Bar(root, PAD, y + 18, IW, 4);
    return r;
}

function legend(root, x, y, color, text) {
    rect(root, x, y + 7, 10, 2, color);
    setText(label(root, x + 14, y, 50, 10, THEME.dim), text);
}

function rebuild() {
    if (timer) clearInterval(timer);
    if (provider) provider.stop();
    if (ui && ui.alarm) ui.alarm.dispose();
    readSettings();
    provider = pickProvider();
    misses = 0;
    var vramColor = getSetting("accent") == "purple" ? ACCENTS.pink : ACCENTS.purple;

    var root = $("root");
    root.innerHTML = "";
    ui = {};
    var y = header(root, 10, "gpu", "GPU");

    ui.name = label(root, PAD, y + 3, IW - 44, narrow ? 12 : 13, THEME.text, "left", true);
    setText(ui.name, provider ? "GPU" : T(card ? "smiMissing" : "noGpu"));
    ui.usage = label(root, W - PAD - 60, y - 3, 60, narrow ? 19 : 22, accent, "right", true);
    y += 22;
    ui.sub = label(root, PAD, y, IW - 50, 11, THEME.dim);
    setText(ui.sub, T("waiting"));
    ui.temp = label(root, W - PAD - 60, y, 60, 11, THEME.dim, "right", true);
    ui.alarm = new Alarm(root, W - PAD - 50, y);
    ui.alarm.update(null);
    y += 22;

    if (graphH > 0) {
        var ax = axisWidth();
        ui.graph = new Graph(root, PAD + ax, y, IW - ax, graphH, [
            { color: accent, area: true },
            { color: vramColor, area: false }
        ]);
        percentAxis(root, PAD + ax, y, IW - ax, graphH, interval);
        y += graphH + 4;
        legend(root, PAD, y, accent, "GPU");
        legend(root, PAD + 50, y, vramColor, "VRAM");
        y += 20;
    }

    if (THEME.glass) {
        var gx = Math.round(IW / 4 - GAUGE_SIZE / 2);
        ui.gLoad = new Gauge(root, PAD + gx, y, T("gpuLoad"));
        ui.gTemp = new Gauge(root, PAD + Math.round(IW / 2) + gx, y, T("temperature"));
        y += GAUGE_SIZE + 18;
    }

    ui.vram = meterRow(root, y, T("vram"), "ram");
    y += 30;
    ui.row2 = meterRow(root, y, "", "bus");
    y += 30;
    ui.power = meterRow(root, y, T("power"), "power");
    y += 30;
    ui.fan = meterRow(root, y, T("fan"), "fan");
    y += 30;

    if (showDetails) {
        rect(root, PAD, y, IW, 1, THEME.sep);
        y += 7;
        if (narrow) {
            ui.codec = label(root, PAD, y, IW, 10, THEME.dim);
            y += 15;
            ui.link = label(root, PAD, y, IW, 10, THEME.dim);
        } else {
            ui.codec = label(root, PAD, y, IW / 2, 10, THEME.dim);
            ui.link = label(root, PAD + IW / 2, y, IW / 2, 10, THEME.dim, "right");
        }
        y += 16;
        ui.driver = label(root, PAD, y, IW, 10, THEME.faint);
        y += 24;
    } else {
        y += 2;
    }

    updateBadge(root);
    paintFrame(W, y);
    if (!provider) return;
    try { provider.start(); } catch (e) { reportError(ui.sub, "start", e); }
    timer = setInterval(tick, interval);
}

// ---- update ---------------------------------------------------------------

function pctOf(a, b) {
    return (a == null || !b) ? null : Math.min(100, a / b * 100);
}

function show(r, val, pct, noPct) {
    setText(r.val, val);
    setText(r.pct, noPct ? "" : pctText(pct));
    setColor(r.pct, pctColor(pct));
    r.bar.set(pct, loadColor(pct || 0, accent));
}

function pctText(v) {
    return v == null ? "–" : Math.round(v) + "%";
}

function tick() {
    var d;
    try { d = provider.poll(); } catch (e) { reportError(ui.sub, "poll", e); return; }
    if (!d) {
        if (++misses == 5) {
            setText(ui.sub, T("nodata"));
            if (ui.graph) ui.graph.push([0, 0]);
            ui.alarm.update(null);
        }
        return;
    }
    misses = 0;

    var vramPct = pctOf(d.vramUsed, d.vramTotal);
    setText(ui.name, String(d.name).replace(/^(NVIDIA|AMD|Intel\(R\))\s+/i, ""));
    setText(ui.usage, pctText(d.usage));
    setColor(ui.usage, pctColor(d.usage));
    setColor(ui.sub, THEME.dim);
    setText(ui.sub, d.sub);
    setText(ui.temp, d.temp == null ? "" : fmtTemp(d.temp, unit) + unit);
    setColor(ui.temp, tempColor(d.temp));
    ui.alarm.update(d.temp);
    if (ui.graph) ui.graph.push([d.usage, vramPct]);
    if (ui.gLoad) {
        ui.gLoad.set((d.usage || 0) / 100, levelIndex(d.usage || 0, LOAD_STEPS), pctText(d.usage));
        ui.gTemp.set(d.temp == null ? 0 : d.temp / 100, d.temp == null ? 0 : levelIndex(d.temp, TEMP_STEPS),
            d.temp == null ? "–" : fmtTemp(d.temp, unit) + unit);
    }

    setText(ui.vram.name, d.memLabel || T("vram"));
    show(ui.vram, d.vramUsed == null ? "" :
        fmtPair((d.vramUsed / 1024).toFixed(1), (d.vramTotal / 1024).toFixed(1), "GB", narrow), vramPct);
    setText(ui.row2.name, d.row2.label);
    show(ui.row2, d.row2.val, d.row2.pct, d.row2.noPct);
    if (d.power == null && d.powerPct != null) {
        // The driver reports power as a share of the card's limit, without watts
        show(ui.power, narrow ? "" : T("ofLimit"), d.powerPct);
    } else {
        show(ui.power, d.power == null ? T("na") :
            d.powerLimit ? fmtPair(Math.round(d.power), Math.round(d.powerLimit), "W", narrow) : Math.round(d.power) + " " + T("W"),
            pctOf(d.power, d.powerLimit), !d.powerLimit);
    }
    show(ui.fan, d.fanText, d.fan);

    if (ui.codec) {
        setText(ui.codec, T("enc") + " " + pctText(d.enc) + "  ·  " + T("dec") + " " + pctText(d.dec));
        setText(ui.link, d.link);
        setHint(ui.link, T("lhmHint"), d.link == T("noSensors") ? LHM_URL : null);
        setText(ui.driver, d.footer);
    }
}
