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

// Where setup.ps1 puts the Core Temp it downloads
var CT_DIR = "%LOCALAPPDATA%\\ModernMeters\\CoreTemp";
var ctAskedAt = 0;

// Starts Core Temp: through a "Start with Windows" task when there is one (Core Temp's own or
// ours; no prompt, the task already runs elevated), else an installed exe (Windows asks for
// administrator approval). Without either, the first click asks and a second one within a few
// seconds downloads the standalone Core Temp from its author's site (setup.ps1, elevated), which
// also sets up the task. Without the note on the graph to ask on, the administrator prompt asks.
function startCoreTemp() {
    if (setupBusy(setupState("CoreTemp"))) return;
    try {
        var svc = new ActiveXObject("Schedule.Service");
        svc.Connect();
        var e = new Enumerator(svc.GetFolder("\\").GetTasks(1));
        for (; !e.atEnd(); e.moveNext()) {
            if (/Core Temp\.exe/i.test(e.item().Xml)) { e.item().Run(""); return; }
        }
    } catch (err) { }
    var sh = new ActiveXObject("WScript.Shell"), fso = new ActiveXObject("Scripting.FileSystemObject");
    var paths = ["%ProgramFiles%\\Core Temp\\Core Temp.exe", "%ProgramFiles(x86)%\\Core Temp\\Core Temp.exe", CT_DIR + "\\Core Temp.exe"];
    for (var i = 0; i < paths.length; i++) {
        var p = sh.ExpandEnvironmentStrings(paths[i]);
        if (fso.FileExists(p)) {
            try { new ActiveXObject("Shell.Application").ShellExecute(p, "", "", "runas", 1); } catch (err2) { }
            return;
        }
    }
    if (ui.ctNote && !(now() - ctAskedAt < 8000)) {
        ctAskedAt = now();
        showCoreTempNote();
        return;
    }
    ctAskedAt = 0;
    runSetup("CoreTemp", " -Dir \"" + sh.ExpandEnvironmentStrings(CT_DIR) + "\" -User \"" +
        sh.ExpandEnvironmentStrings("%USERDOMAIN%\\%USERNAME%") + "\"");
    showCoreTempNote();
}

// The note on the graph while Core Temp isn't running: the link to start it, the question
// before a download, a spinner during it, or why it failed
function showCoreTempNote() {
    var el = ui.ctNote;
    if (!el) return;
    var st = setupState("CoreTemp");
    if (setupBusy(st)) {
        setColor(el, THEME.dim);
        el.title = T("ctGettingTip");
        spinText(el, T("ctGetting"), function () { return setupBusy(setupState("CoreTemp")); });
        return;
    }
    if (el._spin) { clearInterval(el._spin); el._spin = null; }
    var asking = now() - ctAskedAt < 8000;
    setColor(el, asking ? THEME.text : LEVELS[3]);
    setText(el, T(asking ? "ctAsk" : "ctNotRunning"));
    el.title = asking ? T("ctAskTip") : T("ctStart") +
        (st.state == "failed" ? "\n\n" + T("ctFailed").replace("%s", st.error || "?") : "");
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
