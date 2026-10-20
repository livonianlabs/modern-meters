// Network Meter Modern: download/upload speed of the internet adapter with an auto-scaled
// history graph, Wi-Fi network and signal, IP addresses, firewall state and traffic totals.
//  - Speed and totals: raw Tcpip_NetworkInterface counters through a WMI refresher.
//  - Wi-Fi: "netsh wlan show interfaces" run hidden, one at a time, into a temp file.
//  - External IP: asynchronous HTTPS request to api.ipify.org.
//  - Connection alarm: the internet adapter (the one with a default gateway) disappearing.

addStrings({
    en: {
        noNet: "no connection", ethernet: "Ethernet", intIp: "IP", extIp: "External IP",
        firewall: "Firewall", link: "Link", on: "On", off: "Off",
        priv: "Private", pub: "Public", domain: "Domain",
        session: "Session", total: "Total",
        bps: "bit/s", kbps: "kbit/s", Mbps: "Mbit/s", Gbps: "Gbit/s",
        lookup: "Double-click to look up again.", showTip: "Click to show.", hideTip: "Click to hide.", sessionTip: "Since the gadget started. Click to reset.",
        totalTip: "Since {d}. Double-click to reset.",
        connOn: "Connection-lost alarm is on. Click to turn off.",
        connOff: "Connection-lost alarm is off. Click to turn on.",
        connStop: "Connection lost! Click to silence until it is back.",
        detailsTip: "Click for adapter details",
        dAdapter: "Adapter", dConn: "Connection", dWifi: "Wi-Fi", dAddr: "Addresses",
        dName: "Name", dModel: "Model", dMac: "MAC address", dSpeed: "Link speed", dDhcp: "DHCP",
        dLeaseFrom: "Lease obtained", dLeaseTo: "Lease expires", dDhcpServer: "DHCP server",
        dIpv4: "IPv4", dIpv6: "IPv6", dMask: "Subnet mask", dGateway: "Gateway", dDns: "DNS servers",
        dSuffix: "DNS suffix", dExt: "External IP", dHidden: "hidden (click an IP on the gadget)",
        dYes: "yes", dNo: "no"
    },
    ru: {
        noNet: "нет подключения", ethernet: "Ethernet", intIp: "IP", extIp: "Внешний IP",
        firewall: "Брандмауэр", link: "Канал", on: "вкл", off: "выкл",
        priv: "частная", pub: "общая", domain: "домен",
        session: "Сеанс", total: "Всего",
        bps: "бит/с", kbps: "Кбит/с", Mbps: "Мбит/с", Gbps: "Гбит/с",
        lookup: "Двойной клик — запросить заново.", showTip: "Нажмите, чтобы показать.", hideTip: "Нажмите, чтобы скрыть.", sessionTip: "С запуска гаджета. Нажмите, чтобы обнулить.",
        totalTip: "С {d}. Двойной клик — обнулить.",
        connOn: "Сигнал обрыва связи включён. Нажмите, чтобы выключить.",
        connOff: "Сигнал обрыва связи выключен. Нажмите, чтобы включить.",
        connStop: "Связь пропала! Нажмите, чтобы заглушить до её возвращения.",
        detailsTip: "Нажмите, чтобы увидеть подробности адаптера",
        dAdapter: "Адаптер", dConn: "Подключение", dWifi: "Wi-Fi", dAddr: "Адреса",
        dName: "Имя", dModel: "Модель", dMac: "MAC-адрес", dSpeed: "Скорость канала", dDhcp: "DHCP",
        dLeaseFrom: "Аренда получена", dLeaseTo: "Аренда истекает", dDhcpServer: "DHCP-сервер",
        dIpv4: "IPv4", dIpv6: "IPv6", dMask: "Маска подсети", dGateway: "Шлюз", dDns: "DNS-серверы",
        dSuffix: "DNS-суффикс", dExt: "Внешний IP", dHidden: "скрыт (клик по IP на гаджете)",
        dYes: "да", dNo: "нет"
    }
});

var W, IW, accent, upColor, graphH, interval, bytesMode, wanted, showIp, showExt, showTotals, live, narrow;
var ui = null, timer = null, liveTimer = null, liveRef = null, liveSet = null, liveLast = null;
var shell, fso, wmi, refresher, netSet;
var adapter = null, lastAdapter = null, nextScan = 0, last = null, reveal = false, misses = 0;
var hist = [[], []], liveHist = [[], []], scale = 0;
var session = { down: 0, up: 0 }, totals = null, nextSave = 0;
var wlan = { info: null, done: false, launched: 0, next: 0 };
// Keeps the temp files of several gadget instances apart
var instanceId = Math.floor(Math.random() * 1e9);
var ext = { ip: null, req: null, sent: 0, next: 0, forIp: null };

function init() {
    shell = new ActiveXObject("WScript.Shell");
    fso = new ActiveXObject("Scripting.FileSystemObject");
    wmi = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", "root\\cimv2");
    refresher = new ActiveXObject("WbemScripting.SWbemRefresher");
    netSet = refresher.AddEnum(wmi, "Win32_PerfRawData_Tcpip_NetworkInterface").ObjectSet;
    totals = loadTotals();
    hookSettings(rebuild);
    watchUpdates(rebuild);
    rebuild();
}

function shutdown() {
    if (timer) clearInterval(timer);
    if (liveTimer) clearInterval(liveTimer);
    if (ui && ui.alarm) ui.alarm.dispose();
    saveTotals();
    if (ext.req) try { ext.req.abort(); } catch (e) { }
}

function now() { return new Date().getTime(); }

function tempPath(name) {
    return shell.ExpandEnvironmentStrings("%TEMP%") + "\\net_meter_modern_" + instanceId + "_" + name;
}

// ---- formatting -----------------------------------------------------------

function fmtRate(bytesPerSec, exact) {
    return bytesMode ? scaled(bytesPerSec, ["Bs", "KBs", "MBs", "GBs"], 1024, exact) :
        scaled(bytesPerSec * 8, ["bps", "kbps", "Mbps", "Gbps"], 1000, exact);
}

// Smallest 1/2/5 step (in the display unit) that covers v bytes per second
function niceScale(v) {
    var base = bytesMode ? 1024 : 1000, k = bytesMode ? 1 : 8, mult = 1;
    v = Math.max(v * k, bytesMode ? 10240 : 100000);
    while (v / mult >= 1000) mult *= base;
    var m = v / mult, p = Math.pow(10, Math.floor(Math.log(m) / Math.LN10)), steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= m) return steps[i] * p * mult / k;
    return 10 * p * mult / k;
}

// Higher is better: green, yellow, orange, red
function signalColor(p) {
    return p == null ? THEME.faint : LEVELS[p >= 70 ? 1 : (p >= 50 ? 2 : (p >= 30 ? 3 : 4))];
}

function fmtDate(ms) {
    var d = new Date(ms), dd = d.getDate(), mm = d.getMonth() + 1;
    return (dd < 10 ? "0" : "") + dd + "." + (mm < 10 ? "0" : "") + mm + "." + d.getFullYear();
}

// ---- adapter, firewall, profile -------------------------------------------

// Counter instance names replace characters that are special in counter paths
function perfName(desc) {
    return desc.replace(/\(/g, "[").replace(/\)/g, "]").replace(/[#\/\\]/g, "_");
}

function vbList(v) {
    try { return v == null ? [] : new VBArray(v).toArray(); } catch (e) { return []; }
}

// The internet adapter is the one with a default gateway and the lowest metric
function scanAdapter() {
    var found = null, bestMetric = 1e9;
    var e = new Enumerator(wmi.ExecQuery("SELECT InterfaceIndex, Description, IPAddress, DefaultIPGateway, " +
        "IPConnectionMetric FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=TRUE"));
    for (; !e.atEnd(); e.moveNext()) {
        var c = e.item(), inst = perfName(c.Description);
        if (wanted == "auto") {
            if (!vbList(c.DefaultIPGateway).length || c.IPConnectionMetric >= bestMetric) continue;
            bestMetric = c.IPConnectionMetric;
        } else if (inst != wanted) {
            continue;
        }
        var ips = vbList(c.IPAddress), ip = "";
        for (var i = 0; i < ips.length && !ip; i++) if (/^\d+\.\d+\.\d+\.\d+$/.test(ips[i])) ip = ips[i];
        found = { index: c.InterfaceIndex, desc: c.Description, inst: inst, ip: ip || ips[0] || "" };
    }
    if (found) readSecurity(found);
    // Two misses in a row (a few seconds apart) count as a lost connection
    misses = found ? 0 : misses + 1;
    adapter = found;
    if (found) lastAdapter = found;
}

function readSecurity(a) {
    a.category = null;
    a.firewall = null;
    try {
        var std = new ActiveXObject("WbemScripting.SWbemLocator").ConnectServer(".", "root\\StandardCimv2");
        var e = new Enumerator(std.ExecQuery("SELECT NetworkCategory FROM MSFT_NetConnectionProfile WHERE InterfaceIndex=" + a.index));
        if (!e.atEnd()) a.category = e.item().NetworkCategory;   // 0 public, 1 private, 2 domain
    } catch (err) { }
    try {
        var fw = new ActiveXObject("HNetCfg.FwPolicy2");
        var bit = a.category == 2 ? 1 : (a.category == 1 ? 2 : 4);
        a.firewall = !!fw.FirewallEnabled(bit);
    } catch (err2) { }
}

// ---- speed and totals -----------------------------------------------------

// Returns {down, up, link} in bytes per second / bits per second, or null on the first sample
function sampleSpeed() {
    refresher.Refresh();
    var item = null;
    if (adapter) {
        var e = new Enumerator(netSet);
        for (; !e.atEnd(); e.moveNext()) if (e.item().Name == adapter.inst) { item = e.item(); break; }
    }
    if (!item) { last = null; return null; }
    var cur = {
        inst: item.Name,
        rx: parseFloat(item.BytesReceivedPersec),
        tx: parseFloat(item.BytesSentPersec),
        ts: parseFloat(item.Timestamp_Sys100NS) / 1e7
    };
    var prev = last;
    last = cur;
    if (!prev || prev.inst != cur.inst) return null;
    var dt = cur.ts - prev.ts, drx = cur.rx - prev.rx, dtx = cur.tx - prev.tx;
    // Counters restart when the adapter reconnects
    if (!(dt > 0) || drx < 0 || dtx < 0) return null;
    session.down += drx; session.up += dtx;
    totals.down += drx; totals.up += dtx;
    return { down: drx / dt, up: dtx / dt, link: parseFloat(item.CurrentBandwidth) };
}

function totalsPath() {
    return shell.ExpandEnvironmentStrings("%APPDATA%") + "\\ModernMeters\\network_totals.txt";
}

function loadTotals() {
    var t = { down: 0, up: 0, since: now() };
    try {
        var f = fso.OpenTextFile(totalsPath(), 1), lines = f.ReadAll().split(/\r?\n/);
        f.Close();
        for (var i = 0; i < lines.length; i++) {
            var kv = lines[i].split("=");
            if (kv.length == 2 && num(kv[1]) != null) t[kv[0]] = num(kv[1]);
        }
    } catch (e) { }
    return t;
}

function saveTotals() {
    if (!totals) return;
    try {
        var dir = fso.GetParentFolderName(totalsPath());
        if (!fso.FolderExists(dir)) fso.CreateFolder(dir);
        var f = fso.CreateTextFile(totalsPath(), true);
        f.Write("down=" + totals.down + "\r\nup=" + totals.up + "\r\nsince=" + totals.since + "\r\n");
        f.Close();
    } catch (e) { }
}

// ---- Wi-Fi (netsh) --------------------------------------------------------

function readUtf8(path) {
    if (!fso.FileExists(path)) return null;
    try {
        var s = new ActiveXObject("ADODB.Stream");
        s.Type = 2;
        s.Charset = "utf-8";
        s.Open();
        s.LoadFromFile(path);
        var t = s.ReadText();
        s.Close();
        return t;
    } catch (e) {
        return null;
    }
}

// netsh output is localized, so fields are recognized by value where the key may be translated.
// Each interface block starts with the same key as the first line (the interface name).
function parseWlan(text) {
    var blocks = [], cur = null, firstKey = null, lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var m = /^\s+(\S.*?)\s+:\s(.*)$/.exec(lines[i]);
        if (!m) continue;
        var key = m[1], val = trim(m[2]);
        if (firstKey == null) firstKey = key;
        if (key == firstKey) blocks.push(cur = { vals: {}, pairs: [] });
        if (!cur) continue;
        cur.vals[val] = true;
        cur.pairs.push([key, val]);
        if (key == "SSID") cur.ssid = val;
        var sig = /^(\d+)\s*%$/.exec(val);
        if (sig) cur.signal = parseInt(sig[1], 10);
        var band = /^([\d.]+)\s*(GHz|ГГц)$/.exec(val);
        if (band) cur.band = band[1];
    }
    for (var b = 0; b < blocks.length; b++)
        if (adapter && blocks[b].vals[adapter.desc] && blocks[b].ssid) return blocks[b];
    return null;
}

// Refreshed every 5 s; a netsh that hangs is killed and retried a minute later
function pollWlan() {
    var t = now(), out = tempPath("wlan.txt"), text = readUtf8(out);
    if (text != null) {
        try { fso.DeleteFile(out, true); } catch (e) { }
        wlan.info = parseWlan(text);
        wlan.done = true;
        wlan.launched = 0;
        wlan.next = t + 5000;
    }
    if (wlan.launched) {
        if (t - wlan.launched < 20000) return;
        killNetsh();
        wlan.launched = 0;
        wlan.next = t + 60000;
    }
    if (t < wlan.next || !adapter) return;
    wlan.launched = t;
    var tmp = tempPath("wlan.tmp");
    try {
        shell.Run("cmd /c chcp 65001 >nul & netsh wlan show interfaces > \"" + tmp + "\" & move /y \"" + tmp +
            "\" \"" + out + "\" >nul", 0, false);
    } catch (e2) { }
}

function killNetsh() {
    try {
        var e = new Enumerator(wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='netsh.exe'"));
        for (; !e.atEnd(); e.moveNext())
            if (/wlan show interfaces/i.test(String(e.item().CommandLine))) e.item().Terminate();
    } catch (err) { }
}

// ---- external IP ----------------------------------------------------------

// Looked up every 30 minutes, when the local IP changes and on click; failures retry in a minute
function pollExt() {
    if (!showExt || !showIp) return;
    var t = now();
    if (ext.req) {
        var state = 0;
        try { state = ext.req.readyState; } catch (e) { }
        if (state == 4) {
            var ok = false;
            try {
                var s = trim(ext.req.responseText);
                if (ext.req.status == 200 && /^[\d.:a-f]+$/i.test(s)) { ext.ip = s; ok = true; }
            } catch (e2) { }
            ext.req = null;
            ext.next = t + (ok ? 1800000 : 60000);
        } else if (t - ext.sent > 15000) {
            try { ext.req.abort(); } catch (e3) { }
            ext.req = null;
            ext.next = t + 60000;
        }
        return;
    }
    if (!adapter) return;
    if (adapter.ip != ext.forIp) {
        ext.forIp = adapter.ip;
        ext.ip = null;
        ext.next = 0;
    }
    if (t < ext.next) return;
    try {
        var r = new ActiveXObject("MSXML2.ServerXMLHTTP.6.0");
        r.open("GET", "https://api.ipify.org", true);
        r.send();
        ext.req = r;
        ext.sent = t;
    } catch (e4) {
        ext.next = t + 60000;
    }
}

// ---- details flyout -------------------------------------------------------

// Everything Windows knows about the internet adapter, plus the Wi-Fi link as netsh reports it.
// Addresses stay masked until they are revealed on the gadget.
function netDetails() {
    var a = adapter || lastAdapter;
    if (!a) return [{ title: T("dConn"), rows: [[T("dConn"), T("noNet")]] }];
    var hide = function (v) { return !v || reveal ? v : T("dHidden"); };
    var conf = null, nic = null;
    try {
        var e = new Enumerator(wmi.ExecQuery("SELECT * FROM Win32_NetworkAdapterConfiguration WHERE InterfaceIndex=" + a.index));
        if (!e.atEnd()) conf = e.item();
        e = new Enumerator(wmi.ExecQuery("SELECT NetConnectionID, Speed FROM Win32_NetworkAdapter WHERE InterfaceIndex=" + a.index));
        if (!e.atEnd()) nic = e.item();
    } catch (err) { }
    var v4 = [], v6 = [], ips = conf ? vbList(conf.IPAddress) : [];
    for (var i = 0; i < ips.length; i++) (/:/.test(ips[i]) ? v6 : v4).push(ips[i]);
    var dhcp = conf && conf.DHCPEnabled;
    var sections = [
        { title: (nic && nic.NetConnectionID) || T("dAdapter"), rows: [
            [T("dModel"), a.desc],
            [T("dMac"), conf ? hide(conf.MACAddress) : ""],
            [T("dSpeed"), nic && nic.Speed ? scaled(parseFloat(nic.Speed), ["bps", "kbps", "Mbps", "Gbps"], 1000) : ""]] },
        { title: T("dAddr"), rows: [
            [T("dIpv4"), hide(v4.join(", "))],
            [T("dIpv6"), hide(v6.join(", "))],
            [T("dMask"), conf ? vbList(conf.IPSubnet)[0] : ""],
            [T("dGateway"), conf ? vbList(conf.DefaultIPGateway).join(", ") : ""],
            [T("dDns"), conf ? vbList(conf.DNSServerSearchOrder).join(", ") : ""],
            [T("dSuffix"), conf ? conf.DNSDomain : ""],
            [T("dExt"), showExt && ext.ip ? hide(ext.ip) : ""]] },
        { title: T("dDhcp"), rows: [
            [T("dDhcp"), conf ? T(dhcp ? "dYes" : "dNo") : ""],
            [T("dDhcpServer"), dhcp ? conf.DHCPServer : ""],
            [T("dLeaseFrom"), dhcp ? cimDate(conf.DHCPLeaseObtained) : ""],
            [T("dLeaseTo"), dhcp ? cimDate(conf.DHCPLeaseExpires) : ""]] }
    ];
    if (wlan.info) {
        // The first pair is the interface name, already the section title above
        var rows = [], p = wlan.info.pairs;
        for (i = 1; i < p.length; i++) {
            // Skip what is shown above and the low-level noise (QoS, cipher suite ids)
            if (p[i][1] == a.desc || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(p[i][1]) || /QoS|Akm/i.test(p[i][0])) continue;
            rows.push([p[i][0], /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(p[i][1]) ? hide(p[i][1]) : p[i][1]]);
        }
        sections.push({ title: T("dWifi"), rows: rows });
    }
    return sections;
}

// ---- layout ---------------------------------------------------------------

function readSettings() {
    LANG = langCode(getSetting("lang"));
    applyTheme(getSetting("theme"));
    W = parseInt(getSetting("width"), 10);
    IW = W - 2 * PAD;
    narrow = W < 240;
    accent = ACCENTS[getSetting("accent")] || ACCENTS.teal;
    upColor = getSetting("accent") == "purple" ? ACCENTS.pink : ACCENTS.purple;
    graphH = parseInt(getSetting("graph"), 10);
    interval = parseInt(getSetting("interval"), 10);
    bytesMode = getSetting("rate") == "bytes";
    wanted = getSetting("adapter");
    showIp = getSetting("ip") != "off";
    showExt = getSetting("extIp") != "off";
    showTotals = getSetting("totals") != "off";
    live = getSetting("live") == "on";
}

function speedLabel(root, x, y, w, color, arrow) {
    var size = narrow ? 15 : 16;
    setText(label(root, x, y, 14, size, color, "left", true), arrow);
    return label(root, x + 15, y, w - 15, size, THEME.text, "left", true);
}

function infoRow(root, y, name, kind) {
    var r = {}, dx = rowIcon(root, PAD, y, kind);
    r.name = label(root, PAD + dx, y, IW - dx, 11, THEME.dim);
    setText(r.name, name);
    r.val = label(root, PAD, y, IW, narrow ? 10 : 11, THEME.text, "right");
    if (narrow) r.val.style.top = (y + 1) + "px";
    return r;
}

function totalRow(root, y, name, tip) {
    var r = {}, x = PAD + (narrow ? 48 : 60), w = W - PAD - x;
    r.name = label(root, PAD, y, 50, 11, THEME.dim);
    setText(r.name, name);
    r.name.title = tip;
    r.name.style.cursor = "hand";
    r.down = label(root, x, y + (narrow ? 1 : 0), w / 2, narrow ? 10 : 11, THEME.text);
    r.up = label(root, x + w / 2, y + (narrow ? 1 : 0), w / 2, narrow ? 10 : 11, THEME.text, "right");
    return r;
}

function rebuild() {
    if (timer) clearInterval(timer);
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
    liveLast = null;
    if (ui && ui.alarm) ui.alarm.dispose();
    readSettings();
    nextScan = 0;
    last = null;
    scale = 0;
    wlan.next = 0;

    var root = $("root");
    root.innerHTML = "";
    ui = {};
    var y = header(root, 10, "net", T("hdrNet"));

    ui.name = label(root, PAD, y + 3, IW - 18, narrow ? 12 : 13, THEME.text, "left", true);
    ui.name.style.cursor = "hand";
    ui.name.onclick = function () { toggleDetails(netDetails()); };
    ui.alarm = new Alarm(root, W - PAD - 14, y + 5, {
        limit: 1, hyst: 0.5, tips: { on: "connOn", off: "connOff", stop: "connStop" },
        onClear: function () { playSound("Windows Hardware Insert.wav", parseInt(getSetting("volume"), 10)); }
    });
    y += 22;
    ui.ssid = label(root, PAD, y, IW - 36, 11, THEME.dim);
    ui.signal = label(root, W - PAD - 36, y, 36, 11, THEME.dim, "right", true);
    y += 20;

    if (narrow) {
        ui.down = speedLabel(root, PAD, y, IW, accent, "↓");
        y += 22;
        ui.up = speedLabel(root, PAD, y, IW, upColor, "↑");
        y += 26;
    } else {
        ui.down = speedLabel(root, PAD, y, IW / 2, accent, "↓");
        ui.up = speedLabel(root, PAD + IW / 2, y, IW / 2, upColor, "↑");
        y += 28;
    }

    if (graphH > 0) {
        ui.graph = new LiveGraph(root, PAD, y, IW, graphH, [
            { color: accent, area: true },
            { color: upColor, area: false }
        ], live);
        ui.scale = label(root, PAD + 3, y + 1, ui.graph.histW - 6, 9, THEME.faint, "right");
        var ln = ui.graph.live ? ui.graph.live.n : 0;
        for (var s = 0; s < 2; s++) {
            hist[s] = fitTo(hist[s], ui.graph.hist.n);
            liveHist[s] = fitTo(liveHist[s], ln);
        }
        y += graphH + 8;
    }

    rect(root, PAD, y, IW, 1, THEME.sep);
    y += 7;
    if (showIp) {
        ui.ip = infoRow(root, y, T("intIp"), "ip");
        ui.ip.val.style.cursor = "hand";
        ui.ip.val.onclick = toggleReveal;
        y += 18;
        if (showExt) {
            ui.ext = infoRow(root, y, T("extIp"), "globe");
            ui.ext.val.style.cursor = "hand";
            ui.ext.val.onclick = toggleReveal;
            // A double click also fires two clicks, which leave the visibility as it was
            ui.ext.val.ondblclick = function () {
                if (ext.req || !reveal) return;
                ext.ip = null;
                ext.next = 0;
                pollExt();
                update(null);
            };
            y += 18;
        }
    }
    ui.fw = infoRow(root, y, T("firewall"), "shield");
    y += 18;
    ui.link = infoRow(root, y, T("link"), "pulse");
    y += 18;

    if (showTotals) {
        rect(root, PAD, y + 2, IW, 1, THEME.sep);
        y += 9;
        ui.session = totalRow(root, y, T("session"), T("sessionTip"));
        ui.session.name.onclick = function () { session = { down: 0, up: 0 }; update(null); };
        y += 18;
        ui.total = totalRow(root, y, T("total"), "");
        ui.total.name.ondblclick = function () {
            totals = { down: 0, up: 0, since: now() };
            saveTotals();
            update(null);
        };
        y += 18;
    }

    updateBadge(root);
    paintFrame(W, y + 6);
    tick();
    timer = setInterval(tick, interval);
    if (ui.graph && ui.graph.live) liveTimer = setInterval(liveTick, LIVE_MS);
}

// ---- update ---------------------------------------------------------------

function tick() {
    var speed = null;
    try {
        if (now() >= nextScan) {
            scanAdapter();
            nextScan = now() + (adapter ? 10000 : 3000);
        }
        speed = sampleSpeed();
        pollWlan();
        pollExt();
        if (now() >= nextSave) {
            if (nextSave) saveTotals();
            nextSave = now() + 60000;
        }
    } catch (e) {
        reportError(ui.ssid, "tick", e);
        return;
    }
    ui.alarm.update(misses >= 2 ? 1 : 0);
    if (ui.graph) pushGraph(speed);
    update(speed);
}

// Keeps the newest n values, padding with zeros on the left
function fitTo(a, n) {
    a = a.slice(-n);
    while (a.length < n) a.unshift(0);
    return a;
}

// One scale for the history and the live zone. On a new scale both are redrawn and true is
// returned; otherwise the caller pushes just its newest sample.
function rescale() {
    var peak = 0, sets = [hist, liveHist];
    for (var k = 0; k < 2; k++)
        for (var s = 0; s < 2; s++)
            for (var i = 0; i < sets[k][s].length; i++) if (sets[k][s][i] > peak) peak = sets[k][s][i];
    var sc = niceScale(peak);
    if (sc == scale) return false;
    scale = sc;
    ui.graph.hist.load(percents(hist));
    if (ui.graph.live) ui.graph.live.load(percents(liveHist));
    setText(ui.scale, fmtRate(sc, true));
    return true;
}

function percents(h) {
    var out = [[], []];
    for (var s = 0; s < 2; s++) for (var i = 0; i < h[s].length; i++) out[s].push(h[s][i] / scale * 100);
    return out;
}

function pushSeries(h, graph, down, up) {
    h[0].shift(); h[0].push(down);
    h[1].shift(); h[1].push(up);
    if (!rescale()) graph.push([down / scale * 100, up / scale * 100]);
}

function pushGraph(speed) {
    pushSeries(hist, ui.graph.hist, speed ? speed.down : 0, speed ? speed.up : 0);
}

// Live zone: the same adapter counters on their own refresher, 5 times a second
function liveTick() {
    try {
        if (!liveRef) {
            liveRef = new ActiveXObject("WbemScripting.SWbemRefresher");
            liveSet = liveRef.AddEnum(wmi, "Win32_PerfRawData_Tcpip_NetworkInterface").ObjectSet;
        }
        liveRef.Refresh();
        var item = null, e = new Enumerator(liveSet);
        for (; adapter && !e.atEnd(); e.moveNext()) if (e.item().Name == adapter.inst) { item = e.item(); break; }
        if (!item) { liveLast = null; return; }
        var cur = { inst: item.Name, rx: parseFloat(item.BytesReceivedPersec), tx: parseFloat(item.BytesSentPersec),
            ts: parseFloat(item.Timestamp_Sys100NS) / 1e7 };
        var prev = liveLast;
        liveLast = cur;
        if (!prev || prev.inst != cur.inst) return;
        var dt = cur.ts - prev.ts, drx = cur.rx - prev.rx, dtx = cur.tx - prev.tx;
        if (!(dt > 0) || drx < 0 || dtx < 0) return;
        pushSeries(liveHist, ui.graph.live, drx / dt, dtx / dt);
    } catch (err) { }
}

// IP addresses stay masked until clicked, and are masked again whenever the gadget starts
function toggleReveal() {
    reveal = !reveal;
    update(null);
}

function showIpValue(el, ip, tip) {
    var masked = !reveal && /\d/.test(ip);
    setText(el, masked ? "•••.•••.•••.•••" : ip);
    setColor(el, masked ? THEME.faint : THEME.text);
    el.title = tip;
}

function update(speed) {
    var a = adapter, w = wlan.info;
    setText(ui.name, a ? a.desc.replace(/\((R|TM)\)/gi, "").replace(/\s+\d+MHz$/i, "").replace(/\s+/g, " ") : T("noNet"));
    ui.name.title = a ? a.desc + "\n" + T("detailsTip") : "";
    setColor(ui.name, a ? THEME.text : THEME.hot);
    setText(ui.ssid, a ? (w ? w.ssid : (wlan.done ? T("ethernet") : "")) : "");
    setText(ui.signal, w && w.signal != null ? w.signal + "%" : "");
    setColor(ui.signal, signalColor(w ? w.signal : null));

    if (speed || !a) {
        setText(ui.down, fmtRate(speed ? speed.down : 0));
        setText(ui.up, fmtRate(speed ? speed.up : 0));
    }

    if (ui.ip) showIpValue(ui.ip.val, a ? a.ip : "–", T(reveal ? "hideTip" : "showTip"));
    if (ui.ext) showIpValue(ui.ext.val, ext.ip || (ext.req ? "…" : "–"),
        T(reveal ? "hideTip" : "showTip") + (reveal ? " " + T("lookup") : ""));

    var cat = a ? a.category : null;
    var catText = cat == 2 ? T("domain") : (cat == 1 ? T("priv") : (cat == 0 ? T("pub") : ""));
    var fwText = !a || a.firewall == null ? "–" : (a.firewall ? T("on") : T("off"));
    setText(ui.fw.val, fwText + (catText ? " · " + catText : ""));
    setColor(ui.fw.val, a && a.firewall === false ? THEME.hot : (a && a.firewall ? LEVELS[1] : THEME.text));

    var link = speed && speed.link ? scaled(speed.link, ["bps", "kbps", "Mbps", "Gbps"], 1000) : (a ? ui.link.val._t || "" : "–");
    if (speed && w && w.band) link += " · " + w.band + " " + T("GHz");
    setText(ui.link.val, link);

    if (ui.session) {
        setText(ui.session.down, "↓ " + fmtBytes(session.down));
        setText(ui.session.up, "↑ " + fmtBytes(session.up));
        setText(ui.total.down, "↓ " + fmtBytes(totals.down));
        setText(ui.total.up, "↑ " + fmtBytes(totals.up));
        ui.total.name.title = T("totalTip").replace("{d}", fmtDate(totals.since));
    }
}
