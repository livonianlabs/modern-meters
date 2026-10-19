// Background sampler for GPU Meter Modern (AMD, Intel, or NVIDIA without nvidia-smi), run
// hidden via wscript.exe:
//   gpuhelper.js <outFile> <heartbeatFile> <luid> <intervalMs> <lhmIndex>
// luid ("0x00000000_0x000156AA") picks the card in the Windows GPU performance counters (the
// ones Task Manager uses: load, engines, memory). Temperature, fan, power and clocks come from
// ModernMetersGpu.dll (D3DKMT, also what Task Manager shows), and LibreHardwareMonitor /
// OpenHardwareMonitor fills in what the driver doesn't report if it runs.
// Enumerating ~1000 engine counters takes ~150 ms, which is why this lives outside the gadget.
// Exits on its own once the gadget stops touching the heartbeat file.

var args = WScript.Arguments;
var outFile = args(0), hbFile = args(1), luid = String(args(2)).toUpperCase().replace(/0X/g, "0x");
var interval = parseInt(args(3), 10) || 1000, gpuIndex = parseInt(args(4), 10) || 0;
var fso = new ActiveXObject("Scripting.FileSystemObject");
var locator = new ActiveXObject("WbemScripting.SWbemLocator");
var wmi = locator.ConnectServer(".", "root\\cimv2");

// ---- D3DKMT (ModernMetersGpu.dll, registered by the gadget) ---------------

var kmt = null;
try {
    kmt = new ActiveXObject("ModernMeters.GpuReader");
    if (!kmt.Open(luid)) kmt = null;
} catch (e) {
    kmt = null;
}

function readKmt(rec) {
    if (!kmt || !kmt.Refresh()) return;
    rec.push("kmt=1");
    if (kmt.Temperature >= 0) rec.push("temp=" + kmt.Temperature);
    if (kmt.PowerPct >= 0) rec.push("powerpct=" + kmt.PowerPct);
    if (kmt.FanRpm >= 0) rec.push("fanrpm=" + kmt.FanRpm);
    if (kmt.FanPct >= 0) rec.push("fan=" + kmt.FanPct);
    if (kmt.CoreMHz > 0) rec.push("clock=" + kmt.CoreMHz);
    if (kmt.MemMHz > 0) rec.push("mclock=" + kmt.MemMHz);
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
        rec.push("lhm=1");
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

    var byType = {}, tag = ("luid_" + luid + "_").toUpperCase();
    for (var e = new Enumerator(engines); !e.atEnd(); e.moveNext()) {
        var it = e.item(), u = it.UtilizationPercentage;
        if (u == 0) continue;
        var name = it.Name;
        if (name.toUpperCase().indexOf(tag) < 0) continue;
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
        if (e.item().Name.toUpperCase() == tag + "PHYS_0") {
            ded = parseFloat(e.item().DedicatedUsage);
            shared = parseFloat(e.item().SharedUsage);
        }

    var rec = [
        "usage=" + Math.round(usage),
        "td=" + Math.round(byType["3D"] || 0), "copy=" + Math.round(byType["Copy"] || 0),
        "enc=" + Math.round(enc), "dec=" + Math.round(dec),
        "vram=" + Math.round(ded / 1048576), "shared=" + Math.round(shared / 1048576)
    ];
    // LibreHardwareMonitor first: the driver's own readings (D3DKMT) win where both exist,
    // LHM adds what the driver leaves out (watts, or temperature on many integrated GPUs)
    readHw(rec);
    readKmt(rec);
    writeAtomic(rec.join("\r\n") + "\r\nend=1\r\n");
}
try { fso.DeleteFile(outFile, true); } catch (e) { }
