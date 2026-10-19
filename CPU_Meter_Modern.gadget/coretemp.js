// Loads ModernMetersCoreTemp.dll (our .NET 4 COM class over Core Temp's shared memory, source in
// tools/coretemp).

var CT_CLASS = "ModernMeters.CoreTempReader";

function openCoreTemp() {
    if (!IS_GADGET) {
        try { return new ActiveXObject(CT_CLASS); } catch (e) { return null; }
    }
    try {
        registerDotNet("{5b0f6f5e-3c1d-4a7e-9a52-8d3c6e1f2a47}", CT_CLASS, "ModernMetersCoreTemp");
        return new ActiveXObject(CT_CLASS);
    } catch (e) {
        return null;
    }
}

// Starts Core Temp: through its own "Start with Windows" task when there is one (no prompt, the
// task already runs elevated), else the installed exe (Windows asks for administrator approval),
// else the download page
function startCoreTemp() {
    try {
        var svc = new ActiveXObject("Schedule.Service");
        svc.Connect();
        var e = new Enumerator(svc.GetFolder("\\").GetTasks(1));
        for (; !e.atEnd(); e.moveNext()) {
            if (/Core Temp\.exe/i.test(e.item().Xml)) { e.item().Run(""); return; }
        }
    } catch (err) { }
    var sh = new ActiveXObject("WScript.Shell"), fso = new ActiveXObject("Scripting.FileSystemObject");
    var paths = ["%ProgramFiles%\\Core Temp\\Core Temp.exe", "%ProgramFiles(x86)%\\Core Temp\\Core Temp.exe"];
    for (var i = 0; i < paths.length; i++) {
        var p = sh.ExpandEnvironmentStrings(paths[i]);
        if (fso.FileExists(p)) {
            try { new ActiveXObject("Shell.Application").ShellExecute(p, "", "", "runas", 1); } catch (err2) { }
            return;
        }
    }
    try { sh.Run(CORETEMP_URL); } catch (err3) { }
}

// Returns per-physical-core temperatures in Celsius, or null when Core Temp isn't running
function readCoreTemps(reader, count) {
    if (!reader) return null;
    try {
        reader.Refresh();
        var f = reader.Fahrenheit, out = [], any = false;
        for (var i = 0; i < count; i++) {
            var t = parseFloat(reader.GetTemp(i));
            if (isNaN(t) || t <= 0) { out.push(null); continue; }
            out.push(f ? (t - 32) * 5 / 9 : t);
            any = true;
        }
        return any ? out : null;
    } catch (e) {
        return null;
    }
}
