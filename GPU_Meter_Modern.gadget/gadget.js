// GPU Meter Modern: GPU stats from one of two providers, both sampled outside the gadget
// so the Sidebar never blocks:
//  - nvidia-smi: launched hidden (one at a time), writes one CSV line read on the next tick
//    (full data: clocks, temperature, power, fan, memory controller).
//  - Windows (any vendor): gpuhelper.js runs hidden in the background and writes key=value
//    records from the GPU performance counters and D3DKMT (ModernMetersGpu.dll), the sources
//    Task Manager uses; LibreHardwareMonitor adds what the driver doesn't report if it runs.

var W, IW, accent, unit, graphH, interval, gpuIndex, source, showDetails, showTop, showAll, narrow, vramLimit;
var ui = null, timer = null;
var shell, fso, wmi, smiPath = null, provider = null, misses = 0;
var gpus = [], card = null;   // listGpus() (defaults.js), and the one picked in the settings
var extras = [];              // the other cards, when all are shown: { card, provider, ui, misses }

function init() {
    shell = new ActiveXObject("WScript.Shell");
    fso = new ActiveXObject("Scripting.FileSystemObject");
    wmi = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", "root\\cimv2");
    smiPath = findSmi();
    gpus = listGpus();
    for (var i = 0; i < gpus.length; i++) gpus[i].index = i;
    hookSettings(rebuild);
    watchUpdates(rebuild);
    if (IS_GADGET) System.Gadget.Flyout.onHide = function () { procs = null; };
    rebuild();
}

function shutdown() {
    if (timer) clearInterval(timer);
    stopProviders();
    disposeAlarms();
}

function stopProviders() {
    if (provider) provider.stop();
    for (var i = 0; i < extras.length; i++) if (extras[i].provider) extras[i].provider.stop();
    extras = [];
}

function disposeAlarms() {
    if (ui && ui.alarm) ui.alarm.dispose();
    if (ui && ui.vramAlarm) ui.vramAlarm.dispose();
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

// What old drivers still have when they don't know some of SMI_FIELDS
var SMI_SENSORS = ["temperature.gpu", "fan.speed", "power.draw", "power.limit"];

// Only one nvidia-smi runs at a time. If it doesn't finish (driver reset, out of memory,
// "unable to start" dialog) it is killed and the next launch waits longer, up to 5 minutes,
// so a broken driver never piles up processes.
var SMI_TIMEOUT = 15000, SMI_MAX_WAIT = 300000;

// c: the card (null when the registry lists none), key: file name prefix, "" for the main card,
// fields: what to ask for, SMI_FIELDS unless only a few sensors are wanted
function SmiProvider(c, key, fields) {
    this.card = c;
    this.fields = fields || SMI_FIELDS;
    this.out = tempPath(key + "smi.csv");
    this.launched = 0;
    this.wait = SMI_TIMEOUT;
    this.bad = 0;       // runs in a row without a usable line
    this.noUsage = 0;   // lines in a row without the GPU load
    this.everOk = false;
}

SmiProvider.prototype.start = function () {
    this.kill();
    try { fso.DeleteFile(this.out, true); } catch (e) { }
    // nvidia-smi only has the fan in percent; the D3DKMT reader adds its RPM
    this.kmt = null;
    if (!this.card || this.fields != SMI_FIELDS) return;
    try {
        if (IS_GADGET) registerDotNet("{8c41d7a2-6f0e-4b9d-b3a5-2e7f19c4d860}", "ModernMeters.GpuReader", "ModernMetersGpu");
        var k = new ActiveXObject("ModernMeters.GpuReader");
        if (k.Open(this.card.luid)) this.kmt = k;
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
        // An unknown field makes nvidia-smi quit without writing anything, so until it has worked
        // once a silent run is given up on sooner
        if (now - this.launched < (this.everOk ? this.wait : Math.min(this.wait, 6000))) return;
        // Previous run never produced output
        this.bad++;
        this.kill();
        this.wait = Math.min(this.wait * 2, SMI_MAX_WAIT);
    }
    this.launched = now;
    try {
        shell.Run("\"" + smiPath + "\" -i " + smiIndex(this.card) + " --query-gpu=" + this.fields.join(",") +
            " --format=csv,noheader,nounits -f \"" + this.out + "\"", 0, false);
    } catch (e) { }
};

// The fields of the latest line by name, or null while there is none
SmiProvider.prototype.read = function () {
    var text = readFile(this.out);
    var parts = text == null ? [] : trim(text).split(",");
    var ok = parts.length == this.fields.length;
    if (ok || (text != null && this.launched && new Date().getTime() - this.launched > 2000)) {
        // Finished (good or garbage): consume the file and allow the next launch
        try { fso.DeleteFile(this.out, true); } catch (e2) { }
        this.launched = 0;
        if (ok) { this.wait = SMI_TIMEOUT; this.everOk = true; }
        this.bad = ok ? 0 : this.bad + 1;
    }
    this.launch();
    if (!ok) return null;
    var r = {};
    for (var i = 0; i < this.fields.length; i++) r[this.fields[i]] = trim(parts[i]);
    return r;
};

SmiProvider.prototype.poll = function () {
    var r = this.read();
    if (!r) return null;
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
function smiIndex(c) {
    if (!c) return gpuIndex;
    var n = 0;
    for (var i = 0; i < gpus.length && gpus[i] != c; i++) if (gpus[i].vendor == "10DE") n++;
    return n;
}

// ---- provider: Windows (gpuhelper.js) -------------------------------------

function CounterProvider(c, key) {
    this.card = c;
    this.out = tempPath(key + "wmi.txt");
    this.hb = tempPath(key + "alive");
    this.driver = driverVersion(c.name);
    // Old NVIDIA drivers report no temperature to Windows, but nvidia-smi still has it
    this.smi = c.vendor == "10DE" && smiPath ? new SmiProvider(c, key + "s_", SMI_SENSORS) : null;
    this.sensors = null;
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
    if (this.smi) this.smi.stop();
};

CounterProvider.prototype.touch = function () {
    try { var f = fso.CreateTextFile(this.hb, true); f.Write("1"); f.Close(); } catch (e) { }
};

CounterProvider.prototype.start = function () {
    this.stop();
    this.touch();
    if (this.smi) this.smi.start();
    // The helper creates the D3DKMT reader through COM; without it it still has the counters
    if (IS_GADGET) try { registerDotNet("{8c41d7a2-6f0e-4b9d-b3a5-2e7f19c4d860}", "ModernMeters.GpuReader", "ModernMetersGpu"); } catch (e) { }
    var script = IS_GADGET ? System.Gadget.path + "\\gpuhelper.js" :
        unescape(location.pathname.replace(/^\/+/, "").replace(/[^\\\/]*$/, "")).replace(/\//g, "\\") + "gpuhelper.js";
    shell.Run("wscript.exe //B //Nologo \"" + script + "\" \"" + this.out + "\" \"" + this.hb + "\" " +
        this.card.luid + " " + Math.max(interval, 1000) + " " + this.card.index, 0, false);
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
    var ded = num(r.vram), shared = num(r.shared), temp = num(r.temp), power = num(r.power), powerLimit = null;
    // Without a temperature from Windows, nvidia-smi fills in the sensors (and is only run then)
    var sm = this.smi && temp == null ? this.smi.read() : null, fromSmi = false;
    if (sm) this.sensors = sm;
    if (temp == null && (sm = this.sensors)) {
        if (temp == null && (temp = num(sm["temperature.gpu"])) != null) fromSmi = true;
        if (power == null) { power = num(sm["power.draw"]); powerLimit = num(sm["power.limit"]); }
        if (fan == null && rpm == null) fan = num(sm["fan.speed"]);
    }
    var gb = function (mb) { return (mb / 1024).toFixed(1); };
    var d = {
        name: this.card.name,
        usage: num(r.usage),
        temp: temp,
        power: power,
        powerLimit: powerLimit,
        powerPct: num(r.powerpct),
        fan: fan,
        fanText: rpm != null && rpm == 0 && fan != null ? T("stopped") :
            rpm != null ? fanRpmText(rpm) : (fan == null ? T("na") : (fan == 0 ? T("stopped") : "")),
        sub: sub,
        enc: num(r.enc),
        dec: num(r.dec),
        link: temp == null ? T("noSensors") : fromSmi ? "t°: nvidia-smi" : T(r.lhm && !r.kmt ? "lhm" : "winSensors"),
        footer: T("driver") + " " + this.driver + (narrow ? "" : "  ·  " + T("counters"))
    };
    var sharedLabel = T(narrow ? "sharedShort" : "shared");
    if (this.card.integrated) {
        // Integrated graphics work out of shared system memory; their own carve-out is a footnote
        d.memLabel = sharedLabel;
        d.vramUsed = shared;
        d.vramTotal = this.card.sharedMB;
        d.row2 = { label: T("vram"), val: ded == null ? "" : fmtPair(gb(ded), gb(this.card.dedicatedMB), "GB", narrow), pct: pctOf(ded, this.card.dedicatedMB) };
    } else {
        d.vramUsed = ded;
        d.vramTotal = this.card.dedicatedMB;
        d.row2 = { label: sharedLabel, val: shared == null ? "" : gb(shared) + " " + T("GB"), pct: null, noPct: true };
    }
    return d;
};

// On Auto, a card nvidia-smi can't read moves to the Windows counters: an old driver may not
// know a field we ask for and answer nothing, and older mobile cards don't report their load.
SmiProvider.prototype.failing = function (d) {
    if (d) this.noUsage = d.usage == null ? this.noUsage + 1 : 0;
    return this.bad >= (this.everOk ? 2 : 1) || this.noUsage >= 3;
};

function fallBack(p, c, key, d) {
    if (source != "auto" || !c || !(p instanceof SmiProvider) || !p.failing(d)) return null;
    smiSkip(c, true);
    p.stop();
    var q = new CounterProvider(c, key);
    q.start();
    return q;
}

// Cards nvidia-smi couldn't read, so that a rebuild (a new version's badge, the settings) or a
// reload doesn't wait for it again: their LUIDs, which Windows hands out anew at every start, so
// nvidia-smi gets another try after a restart (a new driver, say). With set, marks c.
function smiSkip(c, set) {
    var list = String(getSetting("smiSkip") || "");
    if (!c) return false;
    if (set) {
        if (list.indexOf(c.luid) < 0) setSetting("smiSkip", (list ? list + " " : "") + c.luid);
        return true;
    }
    return list.indexOf(c.luid) >= 0;
}

// key: temp file prefix, "" for the main card. Forcing nvidia-smi leaves the other vendors' extra
// cards on the counters.
function pickProvider(c, key) {
    var nvidia = !c || c.vendor == "10DE";
    if ((source == "smi" && (!key || nvidia)) || (source == "auto" && smiPath && nvidia && !smiSkip(c)))
        return smiPath ? new SmiProvider(c, key) : null;
    return c ? new CounterProvider(c, key) : null;
}

// ---- top processes (flyout) -----------------------------------------------

var procs = null;   // the per-process GPU counters while the flyout is open

// The programs using the most video memory and GPU, from the counters Task Manager shows per
// process. Integrated graphics count their shared memory. A process's load is its busiest engine.
// Load needs two samples, so on the first call it is left out ("first").
function readProcs() {
    if (!procs) {
        var r = new ActiveXObject("WbemScripting.SWbemRefresher");
        procs = {
            refresher: r, first: true, names: {},
            mem: r.AddEnum(wmi, "Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory").ObjectSet,
            eng: r.AddEnum(wmi, "Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine").ObjectSet
        };
    }
    procs.refresher.Refresh();
    var tag = ("_luid_" + card.luid + "_").toUpperCase(), pids = {}, e, it, m;
    var pid = function (name) {
        var n = String(name).toUpperCase();
        if (n.indexOf(tag) < 0 || !(m = /^PID_(\d+)_/.exec(n))) return null;
        return pids[m[1]] || (pids[m[1]] = { mem: 0, eng: {} });
    };
    for (e = new Enumerator(procs.mem); !e.atEnd(); e.moveNext()) {
        it = e.item();
        var p = pid(it.Name);
        if (p) p.mem += parseFloat(card.integrated ? it.SharedUsage : it.DedicatedUsage) || 0;
    }
    if (!procs.first) {
        for (e = new Enumerator(procs.eng); !e.atEnd(); e.moveNext()) {
            it = e.item();
            var u = parseFloat(it.UtilizationPercentage) || 0, q = u ? pid(it.Name) : null;
            if (!q) continue;
            var type = String(it.Name).replace(/^.*engtype_/i, "");
            q.eng[type] = (q.eng[type] || 0) + u;
        }
    }
    // Program names by process ID, asked again only for processes not seen before. Win32_Process
    // takes half a second even for one process and the gadget stalls meanwhile; a refresher over
    // the process counters is several times faster.
    var unknown = false;
    for (var k in pids) if (!procs.names[k]) unknown = true;
    if (unknown) {
        try {
            if (!procs.procSet) {
                procs.procRefresher = new ActiveXObject("WbemScripting.SWbemRefresher");
                procs.procSet = procs.procRefresher.AddEnum(wmi, "Win32_PerfRawData_PerfProc_Process").ObjectSet;
            }
            procs.procRefresher.Refresh();
            for (e = new Enumerator(procs.procSet); !e.atEnd(); e.moveNext())
                procs.names[e.item().IDProcess] = String(e.item().Name).replace(/#\d+$/, "");
        } catch (err) { }
    }
    var by = {}, list = [];
    for (k in pids) {
        var name = procs.names[k] || "PID " + k, g = by[name], load = 0;
        if (!g) list.push(g = by[name] = { name: name, n: 0, mem: 0, gpu: 0 });
        for (var t in pids[k].eng) load = Math.max(load, pids[k].eng[t]);
        g.n++;
        g.mem += pids[k].mem;
        g.gpu = Math.min(100, g.gpu + load);
    }
    var first = procs.first;
    procs.first = false;
    return first ? { list: list, first: true } : { list: list };
}

function processDetails() {
    if (!card) return [];
    var r = readProcs(), list = r.list;
    var gpuRows = r.first ? [] : topRows(list, "gpu", function (v) { return v >= 0.5 ? Math.round(v) + "%" : ""; });
    return [
        { title: T(card.integrated ? "topShared" : "topVram"),
            rows: topRows(list, "mem", function (v) { return v >= 1048576 ? fmtBytes(v) : ""; }) },
        { title: T("topGpu"), rows: gpuRows }
    ];
}

// The busiest program on this card, now and then: reading every process's counters takes a
// moment
var topNext = 0;

function updateTop() {
    if (!ui.top || now() < topNext) return;
    topNext = now() + TOP_EVERY;
    var r = readProcs(), best = null;
    if (r.first) { topNext = now() + 1000; return; }
    for (var i = 0; i < r.list.length; i++) if (!best || r.list[i].gpu > best.gpu) best = r.list[i];
    ui.top.set(best && best.gpu >= 1 ? best.name : null, best ? best.gpu : 0);
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
    showTop = getSetting("top") != "off";
    showAll = getSetting("allCards") == "on";
    vramLimit = parseFloat(getSetting("vramAlarm")) || 0;
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
    stopProviders();
    disposeAlarms();
    if (ui && ui.graph) keepGraph("gpu", ui.graph);
    readSettings();
    provider = pickProvider(card, "");
    misses = 0;
    var vramColor = getSetting("accent") == "purple" ? ACCENTS.pink : ACCENTS.purple;

    var root = $("root");
    root.innerHTML = "";
    ui = {};
    var y = header(root, 10, "gpu", "GPU", card ? vendorOf(card.name, card.vendor) : null);

    // Clear of the load percentage on the right, up to "100%"
    ui.name = label(root, PAD, y + 3, IW - 58, narrow ? 12 : 13, THEME.text, "left", true);
    setText(ui.name, provider ? "GPU" : T(card ? "smiMissing" : "noGpu"));
    if (card) {
        ui.name.style.cursor = "hand";
        ui.name.title = T("procTip");
        ui.name.onclick = function () { toggleDetails(processDetails, 2000); };
    }
    ui.usage = label(root, W - PAD - 60, y - 3, 60, narrow ? 19 : 22, accent, "right", true);
    y += 22;
    ui.sub = label(root, PAD, y, IW - 50, 11, THEME.dim);
    setText(ui.sub, T("waiting"));
    // The cards are found through the performance counters
    if (!card && perfCountersBroken()) counterRepairLink(ui.sub);
    ui.temp = label(root, W - PAD - 60, y, 60, 11, THEME.dim, "right", true);
    ui.alarm = new Alarm(root, W - PAD - 50, y);
    ui.alarm.update(null);
    y += 22;

    // The graph and its legend go under the name, or at the very bottom in a style that wants
    // it there (the busiest program then keeps its own line up here)
    var drawGraph = function (y, withTop) {
        var ax = axisWidth();
        ui.graph = new Graph(root, PAD + ax, y, IW - ax, graphH, [
            { color: accent, area: true },
            { color: vramColor, area: false }
        ]);
        ui.graph.span = historySpan(IW - ax, interval);
        restoreGraph("gpu", ui.graph);
        ui.graph.tip(interval, ["GPU", "VRAM"], function (s, v) { return Math.round(v) + "%"; });
        percentAxis(root, PAD + ax, y, IW - ax, graphH, interval * ui.graph.span);
        y += graphH + 4;
        legend(root, PAD, y, accent, "GPU");
        legend(root, PAD + 46, y, vramColor, "VRAM");
        // The busiest program on the rest of the legend line when it fits
        if (withTop && showTop && card && IW - 100 - 32 >= 50) ui.top = new TopRow(root, y, PAD + 100);
        return y + 17;
    };
    if (graphH > 0 && !THEME.graphBottom) y = drawGraph(y, true);
    if (showTop && card && !ui.top) {
        ui.top = new TopRow(root, y - 2);
        y += 18;
    }
    topNext = 0;

    // Not in Rainbow, whose meters of old had only rows
    if (THEME.glass && !THEME.rowColors) {
        // A little smaller than the frames, to keep the gadget short
        var gs = 44, gx = Math.round(IW / 4 - gs / 2);
        ui.gLoad = new Gauge(root, PAD + gx, y, T("gpuLoad"), gs);
        ui.gTemp = new Gauge(root, PAD + Math.round(IW / 2) + gx, y, T("temperature"), gs);
        y += gs + 16;
    }

    ui.vram = meterRow(root, y, T("vram"), "ram");
    // Its percentage blinks while video memory is nearly full
    ui.vramAlarm = new Alarm(root, 0, 0, { el: ui.vram.pct, on: vramLimit > 0, limit: vramLimit, hyst: 3,
        tips: { stop: "vramStop" } });
    y += 28;
    ui.row2 = meterRow(root, y, "", "bus");
    y += 28;
    ui.power = meterRow(root, y, T("power"), "power");
    y += 28;
    ui.fan = meterRow(root, y, T("fan"), "fan");
    y += 29;

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
        y += 22;
    } else {
        y += 2;
    }
    if (graphH > 0 && THEME.graphBottom) {
        rect(root, PAD, y - 6, IW, 1, THEME.sep);
        y = drawGraph(y + 2, false) + 4;
    }

    if (showAll) {
        for (var i = 0; i < gpus.length; i++)
            if (gpus[i] != card) y = extraCard(root, y, gpus[i]);
    }

    updateBadge(root);
    paintFrame(W, y);
    if (provider) try { provider.start(); } catch (e) { reportError(ui.sub, "start", e); }
    for (i = 0; i < extras.length; i++) {
        var x = extras[i];
        if (x.provider) try { x.provider.start(); } catch (e2) { reportError(x.ui.sub, "start", e2); }
    }
    if (provider || extras.length) timer = setInterval(tick, interval);
}

// Another card, when all are shown: its name and load, clocks and temperature, then its memory.
// The alarms, graph and busiest program stay with the main card.
function extraCard(root, y, c) {
    var x = { card: c, provider: pickProvider(c, "x" + c.index + "_"), misses: 0, ui: {} };
    extras.push(x);
    rect(root, PAD, y - 6, IW, 1, THEME.sep);
    y += 2;
    // "UHD 770" when "UHD Graphics 770" doesn't fit, and short like the main card's name when
    // that one is ("GTX 770M" under "GTX 770M", not "GeForce GTX 770M")
    var strip = function (s) { return s.replace(/^(NVIDIA|AMD|Intel\(R\))\s+/i, ""); };
    var full = strip(c.name), w = IW - 44;
    // (setLinkText shrinks the font down to 85% before it shortens)
    var mainShort = card && textWidth(strip(card.name) + " ›", narrow ? 12 : 13, true) * 0.85 > IW - 58;
    x.ui.name = label(root, PAD, y, w, 11, THEME.text, "left", true);
    setText(x.ui.name, !mainShort && textWidth(full, 11, true) <= w ? full :
        full.replace(/^(GeForce|Radeon|Arc)\s+/i, "").replace(/\s+Graphics\b/i, ""));
    x.ui.name.title = c.name;
    x.ui.usage = label(root, W - PAD - 40, y - 2, 40, 13, accent, "right", true);
    y += 17;
    x.ui.sub = label(root, PAD, y, IW - 44, 10, THEME.dim);
    setText(x.ui.sub, x.provider ? T("waiting") : T("smiMissing"));
    x.ui.temp = label(root, W - PAD - 44, y, 44, 10, THEME.dim, "right", true);
    y += 17;
    x.ui.vram = meterRow(root, y, c.integrated ? T(narrow ? "sharedShort" : "shared") : T("vram"), "ram");
    return y + 37;
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
    if (provider) tickMain();
    for (var i = 0; i < extras.length; i++) if (extras[i].provider) tickExtra(extras[i]);
}

function tickMain() {
    var d, q;
    try { d = provider.poll(); } catch (e) { reportError(ui.sub, "poll", e); return; }
    try { q = fallBack(provider, card, "", d); } catch (e3) { reportError(ui.sub, "start", e3); }
    if (q) { provider = q; misses = 0; return; }
    if (!d) {
        if (!card && perfCountersBroken()) { counterRepairLink(ui.sub); return; }
        if (++misses == 5) {
            setText(ui.sub, T("nodata"));
            if (ui.graph) ui.graph.push([0, 0]);
            ui.alarm.update(null);
            ui.vramAlarm.update(null);
        }
        return;
    }
    misses = 0;

    var vramPct = pctOf(d.vramUsed, d.vramTotal);
    var gpuName = String(d.name).replace(/^(NVIDIA|AMD|Intel\(R\))\s+/i, "");
    // "RTX 3090" when "GeForce RTX 3090" doesn't fit
    if (card) setLinkText(ui.name, gpuName, gpuName.replace(/^(GeForce|Radeon|Arc)\s+/i, ""));
    else setText(ui.name, gpuName);
    setText(ui.usage, pctText(d.usage));
    setColor(ui.usage, pctColor(d.usage));
    setColor(ui.sub, THEME.dim);
    setText(ui.sub, d.sub);
    setText(ui.temp, d.temp == null ? "" : fmtTemp(d.temp, unit) + unit);
    setColor(ui.temp, tempColor(d.temp));
    ui.alarm.update(d.temp);
    if (ui.graph) ui.graph.push([d.usage, vramPct]);
    try { updateTop(); } catch (e) { }
    if (ui.gLoad) {
        ui.gLoad.set((d.usage || 0) / 100, levelIndex(d.usage || 0, LOAD_STEPS), pctText(d.usage));
        ui.gTemp.set(d.temp == null ? 0 : d.temp / 100, d.temp == null ? 0 : levelIndex(d.temp, TEMP_STEPS),
            d.temp == null ? "–" : fmtTemp(d.temp, unit) + unit);
    }

    setText(ui.vram.name, d.memLabel || T("vram"));
    show(ui.vram, d.vramUsed == null ? "" :
        fmtPair((d.vramUsed / 1024).toFixed(1), (d.vramTotal / 1024).toFixed(1), "GB", narrow), vramPct);
    ui.vramAlarm.update(vramPct);
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

function tickExtra(x) {
    var d, q, u = x.ui;
    try { d = x.provider.poll(); } catch (e) { reportError(u.sub, "poll", e); return; }
    try { q = fallBack(x.provider, x.card, "x" + x.card.index + "_", d); } catch (e3) { reportError(u.sub, "start", e3); }
    if (q) { x.provider = q; x.misses = 0; return; }
    if (!d) {
        if (++x.misses == 5) {
            setText(u.sub, T("nodata"));
            setText(u.vram.pct, "");
            u.vram.bar.set(0);
        }
        return;
    }
    x.misses = 0;
    setColor(u.sub, THEME.dim);
    setText(u.sub, d.sub);
    setText(u.usage, pctText(d.usage));
    setColor(u.usage, pctColor(d.usage));
    setText(u.temp, d.temp == null ? "" : fmtTemp(d.temp, unit) + unit);
    setColor(u.temp, tempColor(d.temp));
    show(u.vram, d.vramUsed == null ? "" :
        fmtPair((d.vramUsed / 1024).toFixed(1), (d.vramTotal / 1024).toFixed(1), "GB", narrow), pctOf(d.vramUsed, d.vramTotal));
}
