// Loads ModernMetersCoreTemp.dll (our .NET 4 COM class over Core Temp's shared memory, source in
// tools/coretemp). The class is registered per-user, pointing at the DLL inside this gadget folder.

var CT_CLSID = "{5b0f6f5e-3c1d-4a7e-9a52-8d3c6e1f2a47}";
var CT_CLASS = "ModernMeters.CoreTempReader";
var CT_ASM = "ModernMetersCoreTemp, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null";

function registerCoreTemp(shell) {
    var codeBase = "file:///" + System.Gadget.path.replace(/\\/g, "/") + "/ModernMetersCoreTemp.dll";
    var cls = "HKCU\\Software\\Classes\\" + CT_CLASS + "\\";
    var clsid = "HKCU\\Software\\Classes\\CLSID\\" + CT_CLSID + "\\";
    var inproc = clsid + "InprocServer32\\";
    shell.RegWrite(cls, CT_CLASS, "REG_SZ");
    shell.RegWrite(cls + "CLSID\\", CT_CLSID, "REG_SZ");
    shell.RegWrite(clsid, CT_CLASS, "REG_SZ");
    shell.RegWrite(clsid + "ProgId\\", CT_CLASS, "REG_SZ");
    shell.RegWrite(inproc, "mscoree.dll", "REG_SZ");
    shell.RegWrite(inproc + "ThreadingModel", "Both", "REG_SZ");
    shell.RegWrite(inproc + "Class", CT_CLASS, "REG_SZ");
    shell.RegWrite(inproc + "Assembly", CT_ASM, "REG_SZ");
    shell.RegWrite(inproc + "RuntimeVersion", "v4.0.30319", "REG_SZ");
    shell.RegWrite(inproc + "CodeBase", codeBase, "REG_SZ");
}

function openCoreTemp() {
    if (!IS_GADGET) {
        try { return new ActiveXObject(CT_CLASS); } catch (e) { return null; }
    }
    try {
        registerCoreTemp(new ActiveXObject("WScript.Shell"));
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
