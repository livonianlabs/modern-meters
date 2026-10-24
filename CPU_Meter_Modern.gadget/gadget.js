// CPU Meter Modern: total + per-thread load, clock, core temps, RAM/commit, history graph.

var W, IW, accent, unit, view, graphH, interval, showMem, showTop, live, narrow;
var ui = null, timer = null, liveTimer = null, liveItem = null;

var wmi, refresher, cpuSet, memObj;
var cpuName = "CPU", nCores = 0, nLogical = 0, nHT = 0, baseMHz = 0, totalRam = 0, bootTime = null;
var coreTemp = null;

function pad2(n) { return (n < 10 ? "0" : "") + n; }

// Time since Windows started: "3d 4h", "4h 12m", "12m"; short: the largest unit only
function uptime(short) {
    var m = Math.max(0, Math.floor((new Date().getTime() - bootTime.getTime()) / 60000));
    var d = Math.floor(m / 1440), h = Math.floor(m / 60) % 24, u = T("upUnits");
    if (d) return d + u[0] + (short ? "" : " " + h + u[1]);
    if (h) return h + u[1] + (short ? "" : " " + (m % 60) + u[2]);
    return m + u[2];
}

function init() {
    hookSettings(rebuild);
    watchUpdates(rebuild);
    probe();
    if (IS_GADGET) System.Gadget.Flyout.onHide = function () { procs = null; };
    rebuild();
}

function shutdown() {
    if (timer) clearInterval(timer);
    if (liveTimer) clearInterval(liveTimer);
    if (ui && ui.alarm) ui.alarm.dispose();
}

// ---- data sources ---------------------------------------------------------

function cleanCpuName(s) {
    return trim(String(s)
        .replace(/\((R|TM|tm|r)\)/g, "")
        .replace(/\s+(CPU|Processor)\b/g, "")
        .replace(/\s+@.*$/, "")
        .replace(/\s+\d+-Core/i, "")
        .replace(/\s+with .*$/i, "")
        .replace(/\s+/g, " "));
}

function probe() {
    wmi = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", "root\\cimv2");
    var e = new Enumerator(wmi.ExecQuery(
        "SELECT Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed FROM Win32_Processor"));
    for (; !e.atEnd(); e.moveNext()) {
        var p = e.item();
        if (nCores == 0) { cpuName = cleanCpuName(p.Name); baseMHz = p.MaxClockSpeed; }
        nCores += p.NumberOfCores;
        nLogical += p.NumberOfLogicalProcessors;
    }
    nHT = clamp(nLogical - nCores, 0, nCores);

    e = new Enumerator(wmi.ExecQuery("SELECT TotalVisibleMemorySize, LastBootUpTime FROM Win32_OperatingSystem"));
    totalRam = parseFloat(e.item().TotalVisibleMemorySize) * 1024;
    // "20261021081530.500000+180", in local time
    var b = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/.exec(String(e.item().LastBootUpTime || ""));
    if (b) bootTime = new Date(+b[1], b[2] - 1, +b[3], +b[4], +b[5], +b[6]);

    refresher = new ActiveXObject("WbemScripting.SWbemRefresher");
    cpuSet = refresher.AddEnum(wmi, "Win32_PerfFormattedData_Counters_ProcessorInformation").ObjectSet;
    memObj = refresher.Add(wmi, "Win32_PerfFormattedData_PerfOS_Memory=@").Object;
    refresher.Refresh();

    coreTemp = openCoreTemp();
}

// Logical processors are enumerated with SMT siblings first (P-cores on Intel hybrid),
// followed by single-thread cores, so a thread maps to its physical core like this:
function coreOfThread(t) {
    return t < 2 * nHT ? Math.floor(t / 2) : t - nHT;
}

function threadsOfCore(c) {
    return c < nHT ? [2 * c, 2 * c + 1] : [c + nHT];
}

function isHybrid() {
    return nHT > 0 && nHT < nCores;
}

function coreLabel(c) {
    if (isHybrid()) return c < nHT ? "P" + (c + 1) : "E" + (c - nHT + 1);
    return "C" + (c + 1);
}

// The rows of the per-core section, grouped into P-cores / E-cores on hybrid CPUs.
// Each item reads either one thread or one core (average of its threads). In a single
// column, the two threads of an SMT core form a pair: label and temperature on the first.
function cellGroups(pairRows) {
    var cores = view == "cores", eColor = accent == ACCENTS.teal ? ACCENTS.blue : ACCENTS.teal;
    function items(c0, c1) {
        var out = [];
        for (var c = c0; c < c1; c++) {
            var th = cores ? [-1] : threadsOfCore(c);
            for (var j = 0; j < th.length; j++)
                out.push({
                    core: c,
                    thread: th[j],
                    label: cores || j == 0 || !pairRows ? coreLabel(c) : "",
                    showTemp: cores || j == 0 || !pairRows,
                    pairEnd: pairRows && th.length > 1 && j == th.length - 1
                });
        }
        return out;
    }
    if (!isHybrid()) {
        var all = items(0, nCores);
        if (nHT == 0) for (var i = 0; i < all.length; i++) all[i].label = String(i + 1);
        return [{ title: null, color: accent, items: all }];
    }
    return [
        { title: T("pcores"), info: nHT + "C · " + 2 * nHT + "T", color: accent, items: items(0, nHT) },
        { title: T("ecores"), info: (nCores - nHT) + "C", color: eColor, items: items(nHT, nCores) }
    ];
}

function sample() {
    refresher.Refresh();
    var threads = [], total = 0, clock = baseMHz;
    for (var e = new Enumerator(cpuSet); !e.atEnd(); e.moveNext()) {
        var it = e.item(), name = it.Name;
        var u = it.PercentProcessorUtility;
        u = clamp(u == null ? parseFloat(it.PercentProcessorTime) : parseFloat(u), 0, 100);
        if (name == "_Total") {
            total = u;
            var mhz = parseFloat(it.ProcessorFrequency) || baseMHz;
            clock = mhz * (parseFloat(it.PercentProcessorPerformance) || 100) / 100;
            continue;
        }
        var comma = name.indexOf(",");
        if (comma < 0 || name.indexOf("_Total") >= 0) continue;
        threads.push({ g: parseInt(name.substring(0, comma), 10), i: parseInt(name.substring(comma + 1), 10), u: u });
    }
    threads.sort(function (a, b) { return a.g != b.g ? a.g - b.g : a.i - b.i; });
    var loads = [];
    for (var i = 0; i < threads.length; i++) loads.push(threads[i].u);

    var avail = parseFloat(memObj.AvailableBytes);
    return {
        total: total,
        clock: clock,
        loads: loads,
        temps: readCoreTemps(coreTemp, nCores),
        ramUsed: totalRam - avail,
        commit: parseFloat(memObj.CommittedBytes),
        commitLimit: parseFloat(memObj.CommitLimit)
    };
}

// ---- layout ---------------------------------------------------------------

function readSettings() {
    LANG = langCode(getSetting("lang"));
    applyTheme(getSetting("theme"));
    W = parseInt(getSetting("width"), 10);
    IW = W - 2 * PAD;
    narrow = W < 240;
    accent = ACCENTS[getSetting("accent")] || ACCENTS.blue;
    unit = getSetting("unit");
    view = getSetting("view");
    graphH = parseInt(getSetting("graph"), 10);
    interval = parseInt(getSetting("interval"), 10);
    showMem = getSetting("mem") != "off";
    showTop = getSetting("top") != "off";
    live = getSetting("live") == "on";
}

// The label may run under the value: values are right-aligned and short enough to leave room
function meterRow(root, y, name, kind) {
    var r = {}, dx = rowIcon(root, PAD, y, kind);
    setText(label(root, PAD + dx, y, IW - 34 - dx, 11, THEME.dim), name);
    r.val = narrow ? label(root, PAD + 40, y + 1, IW - 40 - 34, 10, THEME.text, "right") :
        label(root, PAD + 40, y, IW - 40 - 34, 11, THEME.text, "right");
    r.pct = label(root, W - PAD - 34, y, 34, 11, THEME.text, "right", true);
    r.bar = new Bar(root, PAD, y + 18, IW, 4);
    return r;
}

function rebuild() {
    if (timer) clearInterval(timer);
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
    if (ui && ui.alarm) ui.alarm.dispose();
    if (ui && ui.graph) keepGraph("cpu", ui.graph.hist);
    readSettings();

    var root = $("root");
    root.innerHTML = "";
    ui = {};
    var y = header(root, 10, "cpu", "CPU", vendorOf(cpuName, null, true));

    // Clear of the load percentage on the right, up to "100%"
    ui.name = label(root, PAD, y + 3, IW - 58, narrow ? 12 : 13, THEME.text, "left", true);
    // "i7-14700KF" when "Core i7-14700KF" doesn't fit
    var shortName = cpuName.replace(/^(Intel|AMD)\s+/i, "");
    setLinkText(ui.name, narrow ? shortName : cpuName, shortName.replace(/^(Core|Ryzen)\s+/i, ""));
    ui.name.style.cursor = "hand";
    ui.name.title = T("procTip");
    ui.name.onclick = function () { toggleDetails(processDetails, 1500); };
    ui.total = label(root, W - PAD - 60, y - 3, 60, narrow ? 19 : 22, accent, "right", true);
    y += 22;
    ui.sub = label(root, PAD, y, IW - 50, 11, THEME.dim);
    ui.temp = label(root, W - PAD - 76, y, 76, 11, THEME.dim, "right", true);
    ui.alarm = new Alarm(root, W - PAD - 50, y);
    y += 22;

    if (graphH > 0) {
        var ax = axisWidth();
        ui.graph = new LiveGraph(root, PAD + ax, y, IW - ax, graphH, [{ color: accent, area: true }], live);
        var g = ui.graph.hist;
        g.span = historySpan(g.w, interval);
        restoreGraph("cpu", g);
        g.tip(interval, [""], function (s, v) { return Math.round(v) + "%"; });
        percentAxis(root, PAD + ax, y, ui.graph.histW, graphH, interval * g.span);
        // Shown over the graph while Core Temp isn't running, like the old gadgets did
        ui.ctNote = label(root, PAD + ax, y + Math.round(graphH / 2) - 8, IW - ax, 10, LEVELS[3], "center", true);
        setText(ui.ctNote, T("ctNotRunning"));
        setHint(ui.ctNote, T("ctStart"), startCoreTemp);
        ui.ctNote.style.display = "none";
        y += graphH + 10;
    }
    if (showTop) {
        ui.top = new TopRow(root, y - 4);
        topNext = 0;
        y += 18;
    }
    if (showMem) {
        ui.ram = meterRow(root, y, T("ram"), "ram");
        y += 30;
        ui.commit = meterRow(root, y, T("commit"), "commit");
        y += 30;
    }

    rect(root, PAD, y, IW, 1, THEME.sep);
    y += 7;

    var cells = view == "cores" ? nCores : nLogical;
    var hdr = label(root, PAD, y, IW, 10, THEME.faint, "left", true);
    setText(hdr, T(view == "cores" ? "cores" : "threads") + "  ·  " +
        (narrow ? cells : nCores + "C / " + nLogical + "T"));
    var sw = label(root, W - PAD - 90, y, 90, 10, THEME.faint, "right");
    setText(sw, (narrow ? "" : T("show")) + T(view == "cores" ? "toThreads" : "toCores"));
    sw.style.cursor = "hand";
    sw.onclick = function () {
        setSetting("view", view == "cores" ? "threads" : "cores");
        rebuild();
    };
    y += 18;

    var cols = W >= 380 ? 3 : (narrow ? 1 : 2), gap = 14, rowH = narrow ? 15 : 16;
    var cw = Math.floor((IW - gap * (cols - 1)) / cols);
    var lw = 24, pw = 32, tw = coreTemp ? 26 : 0;
    var bw = cw - lw - 6 - pw - tw;
    // Glass: half of the bar's room goes to a sparkline of that core after the percentage
    var sw = THEME.glass ? Math.round(bw / 2) : 0;
    if (sw) bw -= sw + 4;
    // Room for four whole blocks in Windows classic, taken from the sparkline
    if (sw && segmentWidth(bw, 4) > bw && sw - (segmentWidth(bw, 4) - bw) >= 16) {
        sw -= segmentWidth(bw, 4) - bw;
        bw = segmentWidth(bw, 4);
    }
    var groups = cellGroups(cols == 1);
    ui.cells = [];
    for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        if (grp.title) {
            if (g > 0) y += 4;
            rect(root, PAD, y + 6, 8, 2, grp.color);
            setText(label(root, PAD + 12, y, IW - 12, 10, THEME.dim, "left", true), grp.title);
            setText(label(root, W - PAD - 80, y, 80, 10, THEME.faint, "right"), grp.info);
            y += 17;
        }
        for (var i = 0; i < grp.items.length; i++) {
            var it = grp.items[i];
            var cx = PAD + (i % cols) * (cw + gap), cy = y;
            setText(label(root, cx, cy, lw, 10, THEME.faint, "right"), it.label);
            it.bar = new Bar(root, cx + lw + 6, cy + 7, bw, 4);
            it.pct = label(root, cx + lw + 6 + bw, cy, pw, 10, THEME.text, "right");
            if (tw && it.showTemp) it.temp = label(root, cx + cw - tw, cy, tw, 10, THEME.dim, "right");
            if (sw) it.spark = new Graph(root, cx + lw + 6 + bw + pw + 4, cy + 3, sw, 11, [{ color: grp.color, area: true }], true);
            it.color = grp.color;
            ui.cells.push(it);
            if (i % cols == cols - 1 || i == grp.items.length - 1) y += rowH + (it.pairEnd ? 3 : 0);
        }
    }
    y += 8;

    updateBadge(root);
    paintFrame(W, y);
    try { tick(); } catch (e) { reportError(ui.sub, "tick", e); }
    timer = setInterval(tick, interval);
    if (ui.graph && ui.graph.live) liveTimer = setInterval(liveTick, LIVE_MS);
}

// Total load only, on its own refresher so the 5-per-second sampling stays cheap
function liveTick() {
    try {
        if (!liveItem) {
            var r = new ActiveXObject("WbemScripting.SWbemRefresher");
            liveItem = { refresher: r, obj: r.Add(wmi, "Win32_PerfFormattedData_Counters_ProcessorInformation.Name='_Total'").Object };
        }
        liveItem.refresher.Refresh();
        ui.graph.pushLive([clamp(parseFloat(liveItem.obj.PercentProcessorUtility) || 0, 0, 100)]);
    } catch (e) { }
}

// ---- top processes (flyout) -----------------------------------------------

var procs = null;   // the per-process counters while the flyout is open

// The busiest programs by CPU and by memory; the processes of one program are added up
// Every program's processor load (percent of one logical processor) and private memory, summed
// over its processes; null on the first call, which only starts the measuring
function readProcs() {
    if (!procs) {
        var r = new ActiveXObject("WbemScripting.SWbemRefresher");
        procs = { refresher: r, set: r.AddEnum(wmi, "Win32_PerfFormattedData_PerfProc_Process").ObjectSet, first: true };
    }
    procs.refresher.Refresh();
    var by = {}, list = [];
    for (var e = new Enumerator(procs.set); !e.atEnd(); e.moveNext()) {
        var p = e.item(), name = String(p.Name).replace(/#\d+$/, "");
        if (name == "_Total" || name == "Idle") continue;
        var r2 = by[name];
        if (!r2) list.push(r2 = by[name] = { name: name, n: 0, cpu: 0, mem: 0 });
        r2.n++;
        r2.cpu += parseFloat(p.PercentProcessorTime) || 0;
        r2.mem += parseFloat(p.WorkingSetPrivate) || 0;
    }
    // Load needs two samples, so it shows from the second one on
    var first = procs.first;
    procs.first = false;
    return first ? { list: list, first: true } : { list: list };
}

function processDetails() {
    var r = readProcs(), list = r.list;
    var cpuRows = r.first ? [] : topRows(list, "cpu", function (v) {
        v /= nLogical;
        return v >= 0.05 ? v.toFixed(1) + "%" : "";
    });
    return [
        { title: T("topCpu"), rows: cpuRows },
        { title: T("topRam"), rows: topRows(list, "mem", fmtBytes) }
    ];
}

// The busiest program, now and then: reading every process costs a little CPU itself
var topNext = 0;

function updateTop() {
    if (!ui.top || now() < topNext) return;
    topNext = now() + TOP_EVERY;
    var r = readProcs(), best = null;
    if (r.first) { topNext = now() + 1000; return; }
    for (var i = 0; i < r.list.length; i++) if (!best || r.list[i].cpu > best.cpu) best = r.list[i];
    var pct = best ? best.cpu / nLogical : 0;
    ui.top.set(pct >= 1 ? best.name : null, pct);
}

// ---- update ---------------------------------------------------------------

function showMeter(r, used, total) {
    var pct = used / total * 100;
    // Narrow glass rows also carry an icon, so the obvious "GB" makes room for it
    setText(r.val, fmtPair(fmtGB(used), fmtGB(total), narrow && THEME.glass ? null : "GB", narrow));
    setText(r.pct, Math.round(pct) + "%");
    setColor(r.pct, pctColor(pct));
    r.bar.set(pct, loadColor(pct, accent));
}

function tick() {
    var d;
    try { d = sample(); } catch (e) { reportError(ui.sub, "WMI", e); return; }

    setText(ui.total, Math.round(d.total) + "%");
    setColor(ui.total, pctColor(d.total));
    setColor(ui.sub, THEME.dim);
    var ghz = (d.clock / 1000).toFixed(2) + " " + T("GHz");
    if (narrow) {
        // Days and hours up, or just days when that doesn't fit
        setText(ui.sub, ghz + (bootTime ? "  ·  " + uptime(false) : ""));
        if (bootTime && ui.sub.scrollWidth > ui.sub.clientWidth) setText(ui.sub, ghz + "  ·  " + uptime(true));
    } else {
        setText(ui.sub, ghz + "  ·  " + T("base") + " " + (baseMHz / 1000).toFixed(1) +
            (bootTime ? "  ·  " + T("up") + " " + uptime(false) : ""));
    }
    if (bootTime) ui.sub.title = T("upTip").replace("%s", bootTime.getDate() + "." + pad2(bootTime.getMonth() + 1) + " " +
        bootTime.getHours() + ":" + pad2(bootTime.getMinutes()));
    var maxT = null;
    if (d.temps) for (var i = 0; i < d.temps.length; i++) if (d.temps[i] != null && (maxT == null || d.temps[i] > maxT)) maxT = d.temps[i];
    setText(ui.temp, maxT == null ? T("ctOff") : fmtTemp(maxT, unit) + unit);
    setHint(ui.temp, T("ctStart"), maxT == null ? startCoreTemp : null);
    if (ui.ctNote) ui.ctNote.style.display = maxT == null ? "" : "none";
    setColor(ui.temp, maxT == null ? THEME.faint : tempColor(maxT));
    ui.alarm.update(maxT);
    if (ui.graph) ui.graph.push([d.total]);
    try { updateTop(); } catch (e) { }

    if (ui.ram) {
        showMeter(ui.ram, d.ramUsed, totalRam);
        showMeter(ui.commit, d.commit, d.commitLimit);
    }

    for (var k = 0; k < ui.cells.length; k++) {
        var cell = ui.cells[k], load;
        if (cell.thread < 0) {
            var th = threadsOfCore(cell.core), sum = 0;
            for (var j = 0; j < th.length; j++) sum += d.loads[th[j]] || 0;
            load = sum / th.length;
        } else {
            load = d.loads[cell.thread] || 0;
        }
        cell.bar.set(load, loadColor(load, cell.color));
        setText(cell.pct, Math.round(load) + "%");
        setColor(cell.pct, pctColor(load));
        if (cell.spark) cell.spark.push([load]);
        if (cell.temp) {
            var t = d.temps ? d.temps[cell.core] : null;
            setText(cell.temp, fmtTemp(t, unit));
            setColor(cell.temp, tempColor(t));
        }
    }
}
