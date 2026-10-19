// Background sampler for GPU Meter Modern (any GPU vendor), run hidden via wscript.exe:
//   gpuhelper.js <outFile> <heartbeatFile> <gpuIndex> <intervalMs>
// Reads the Windows GPU performance counters (the ones Task Manager uses) and, if
// LibreHardwareMonitor / OpenHardwareMonitor is running, its sensors (temp, fan, power, clocks).
// Enumerating ~1000 engine counters takes ~150 ms, which is why this lives outside the gadget.
// Exits on its own once the gadget stops touching the heartbeat file.

var args = WScript.Arguments;
var outFile = args(0), hbFile = args(1), gpuIndex = parseInt(args(2), 10) || 0, interval = parseInt(args(3), 10) || 1000;
var fso = new ActiveXObject("Scripting.FileSystemObject");
var locator = new ActiveXObject("WbemScripting.SWbemLocator");
var wmi = locator.ConnectServer(".", "root\\cimv2");

var HKLM = 0x80000002;
var CLASS_KEY = "SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";

function regCall(reg, method, sub, value) {
    var p = reg.Methods_.Item(method).InParameters.SpawnInstance_();
    p.hDefKey = HKLM;
    p.sSubKeyName = sub;
    if (value != null) p.sValueName = value;
    return reg.ExecMethod_(method, p);
}

// Display adapters that have dedicated memory, in registry order: [{name, vramMB}]
function listAdapters() {
    var out = [];
    try {
        var reg = locator.ConnectServer(".", "root\\default").Get("StdRegProv");
        var keys = regCall(reg, "EnumKey", CLASS_KEY).sNames;
        if (keys == null) return out;
        keys = new VBArray(keys).toArray().sort();
        for (var i = 0; i < keys.length; i++) {
            if (!/^\d{4}$/.test(keys[i])) continue;
            var sub = CLASS_KEY + "\\" + keys[i];
            var name = regCall(reg, "GetStringValue", sub, "DriverDesc").sValue;
            var mem = parseFloat(regCall(reg, "GetQWORDValue", sub, "HardwareInformation.qwMemorySize").uValue);
            if (!mem) {
                var dw = regCall(reg, "GetDWORDValue", sub, "HardwareInformation.MemorySize").uValue;
                mem = parseFloat(dw);
            }
            if (name && mem > 0) out.push({ name: name, vramMB: mem / 1048576 });
        }
    } catch (e) { }
    return out;
}

function driverVersion(name) {
    try {
        var e = new Enumerator(wmi.ExecQuery("SELECT Name,DriverVersion FROM Win32_VideoController"));
        for (; !e.atEnd(); e.moveNext()) if (e.item().Name == name) return e.item().DriverVersion;
    } catch (e2) { }
    return "";
}

// ---- LibreHardwareMonitor / OpenHardwareMonitor ---------------------------

var hw = null, hwRetry = 0;

function connectHw() {
    var spaces = ["root\\LibreHardwareMonitor", "root\\OpenHardwareMonitor"];
    for (var i = 0; i < spaces.length; i++) {
        try {
            var svc = locator.ConnectServer(".", spaces[i]);
            var gpus = [];
            var e = new Enumerator(svc.ExecQuery("SELECT Identifier,Name,HardwareType FROM Hardware"));
            for (; !e.atEnd(); e.moveNext())
                if (/^Gpu/i.test(String(e.item().HardwareType))) gpus.push(String(e.item().Identifier));
            gpus.sort();
            if (gpus.length > gpuIndex) return { svc: svc, id: gpus[gpuIndex] };
            if (gpus.length) return { svc: svc, id: gpus[0] };
        } catch (e3) { }
    }
    return null;
}

function readHw(rec) {
    if (!hw) {
        if (hwRetry-- > 0) return;
        hw = connectHw();
        hwRetry = 30;
        if (!hw) return;
    }
    try {
        var e = new Enumerator(hw.svc.ExecQuery("SELECT Name,SensorType,Value FROM Sensor WHERE Parent='" + hw.id + "'"));
        var temp = null, power = null, fanRpm = null, fanPct = null, clk = null, mclk = null;
        for (; !e.atEnd(); e.moveNext()) {
            var s = e.item(), type = String(s.SensorType), name = String(s.Name), v = parseFloat(s.Value);
            if (isNaN(v)) continue;
            if (type == "Temperature" && (temp == null || name == "GPU Core")) temp = v;
            else if (type == "Power" && (power == null || /Package|Total|GPU Power/i.test(name))) power = v;
            else if (type == "Fan" && fanRpm == null) fanRpm = v;
            else if (type == "Control" && fanPct == null) fanPct = v;
            else if (type == "Clock" && name == "GPU Core") clk = v;
            else if (type == "Clock" && name == "GPU Memory") mclk = v;
        }
        if (temp != null) rec.push("temp=" + temp);
        if (power != null) rec.push("power=" + power);
        if (fanRpm != null) rec.push("fanrpm=" + fanRpm);
        if (fanPct != null) rec.push("fan=" + fanPct);
        if (clk != null) rec.push("clock=" + clk);
        if (mclk != null) rec.push("mclock=" + mclk);
    } catch (e4) {
        hw = null;
    }
}

// ---- main loop ------------------------------------------------------------

var refresher = new ActiveXObject("WbemScripting.SWbemRefresher");
var engines = refresher.AddEnum(wmi, "Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine").ObjectSet;
var memory = refresher.AddEnum(wmi, "Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory").ObjectSet;
refresher.Refresh();

var adapters = listAdapters();
var info = adapters[gpuIndex] || adapters[0] || { name: "GPU", vramMB: 0 };
var driver = driverVersion(info.name);
var luid = null;

// Picks the adapter LUID: the gpuIndex-th adapter that has dedicated memory in use
function pickLuid() {
    var list = [];
    for (var e = new Enumerator(memory); !e.atEnd(); e.moveNext()) {
        var it = e.item(), m = /^luid_(\w+?_\w+?)_phys_0$/.exec(it.Name);
        if (m && parseFloat(it.DedicatedUsage) > 0) list.push(m[1]);
    }
    list.sort();
    return list[gpuIndex] || list[0] || null;
}

function heartbeatAlive() {
    try {
        return (new Date() - new Date(fso.GetFile(hbFile).DateLastModified)) < 15000;
    } catch (e) {
        return false;
    }
}

function writeAtomic(text) {
    var tmp = outFile + ".tmp";
    var f = fso.CreateTextFile(tmp, true);
    f.Write(text);
    f.Close();
    try { if (fso.FileExists(outFile)) fso.DeleteFile(outFile, true); fso.MoveFile(tmp, outFile); } catch (e) { }
}

while (heartbeatAlive()) {
    WScript.Sleep(interval);
    refresher.Refresh();
    if (!luid) luid = pickLuid();

    var byType = {}, tag = "luid_" + luid + "_";
    for (var e = new Enumerator(engines); !e.atEnd(); e.moveNext()) {
        var it = e.item(), u = it.UtilizationPercentage;
        if (u == 0) continue;
        var name = it.Name;
        if (name.indexOf(tag) < 0) continue;
        var type = name.substring(name.indexOf("engtype_") + 8);
        byType[type] = (byType[type] || 0) + parseFloat(u);
    }
    var usage = 0, dec = 0, enc = 0;
    for (var t in byType) {
        var v = Math.min(100, byType[t]);
        if (v > usage) usage = v;
        if (/Decode/i.test(t) && v > dec) dec = v;
        if (/Encode/i.test(t) && v > enc) enc = v;
    }

    var ded = 0, shared = 0;
    for (e = new Enumerator(memory); !e.atEnd(); e.moveNext())
        if (e.item().Name == "luid_" + luid + "_phys_0") {
            ded = parseFloat(e.item().DedicatedUsage);
            shared = parseFloat(e.item().SharedUsage);
        }

    var rec = [
        "name=" + info.name, "driver=" + driver, "usage=" + Math.round(usage),
        "td=" + Math.round(byType["3D"] || 0), "copy=" + Math.round(byType["Copy"] || 0),
        "enc=" + Math.round(enc), "dec=" + Math.round(dec),
        "vram=" + Math.round(ded / 1048576), "vramtotal=" + Math.round(info.vramMB),
        "shared=" + Math.round(shared / 1048576)
    ];
    readHw(rec);
    writeAtomic(rec.join("\r\n") + "\r\nend=1\r\n");
}
try { fso.DeleteFile(outFile, true); } catch (e) { }
