// SSD wear and drive temperatures for Drives Meter Modern. Windows only gives these to
// administrators, so a scheduled task (install-disk-health.ps1) runs this as SYSTEM every 5 minutes:
//   wscript.exe //B diskhealth.js <outFile>
// Writes one line per drive: "<disk number> wear=<% used> temp=<°C> hours=<power-on hours>".
//  - NVMe: the Windows reliability counters, filled from the standard NVMe health log.
//  - SATA: Windows leaves those counters at zero for many drives, so the raw SMART attribute
//    table is read instead (the same data CrystalDiskInfo shows).
//  - Hard drives are only asked when they had I/O since the previous run (read from performance
//    counters, which don't touch the drive), so a sleeping drive is never woken up.

var out = WScript.Arguments.length ? WScript.Arguments(0) : "C:\\ProgramData\\ModernMeters\\disk_health.txt";
var fso = new ActiveXObject("Scripting.FileSystemObject");
var locator = new ActiveXObject("WbemScripting.SWbemLocator");
var storage = locator.ConnectServer(".", "root\\Microsoft\\Windows\\Storage");
var cim = locator.ConnectServer(".", "root\\cimv2");
var statePath = fso.GetParentFolderName(out) + "\\diskhealth_state.txt";

// Normalized "life left" attributes by vendor: Samsung, generic/Kingston, Intel, Crucial, WD/SanDisk
var LIFE_ATTRS = [177, 231, 233, 202, 169];

var io = readIoCounts(), lastIo = readState(), pnp = readPnpIds();
var lines = [];
var e = new Enumerator(storage.ExecQuery("SELECT * FROM MSFT_PhysicalDisk WHERE MediaType=3 OR MediaType=4"));
for (; !e.atEnd(); e.moveNext()) {
    var disk = e.item(), id = String(disk.DeviceId), ssd = disk.MediaType == 4;
    if (!ssd && (io[id] == null || lastIo[id] == null || io[id] == lastIo[id])) continue;
    var r = { wear: null, temp: null, hours: null };
    try {
        var c = new Enumerator(disk.Associators_("MSFT_PhysicalDiskToStorageReliabilityCounter"));
        if (!c.atEnd()) {
            c = c.item();
            // Drives that don't report reliability data return zeros, so wear is only trusted
            // alongside a real temperature
            if (c.Temperature > 0) { r.temp = c.Temperature; if (ssd) r.wear = c.Wear; }
            if (c.PowerOnHours > 0) r.hours = c.PowerOnHours;
        }
    } catch (err) { }
    var s = pnp[id] ? readSmartTable(pnp[id]) : null;
    if (s) {
        if (ssd && s.life != null) r.wear = 100 - s.life;
        if (s.temp != null) r.temp = s.temp;
        if (s.hours != null) r.hours = s.hours;
    }
    lines.push(id + " wear=" + val(r.wear) + " temp=" + val(r.temp) + " hours=" + val(r.hours));
}

writeState(io);
writeAtomic(out, lines.join("\r\n") + "\r\n");

function val(v) {
    return v == null ? "" : String(v);
}

// Completed transfers per disk number; unchanged between runs means the drive was idle
function readIoCounts() {
    var out = {}, e = new Enumerator(cim.ExecQuery("SELECT Name, DiskTransfersPersec FROM Win32_PerfRawData_PerfDisk_PhysicalDisk"));
    for (; !e.atEnd(); e.moveNext()) {
        var m = /^(\d+)/.exec(String(e.item().Name));
        if (m) out[m[1]] = String(e.item().DiskTransfersPersec);
    }
    return out;
}

function readState() {
    var out = {};
    try {
        var f = fso.OpenTextFile(statePath, 1), lines = f.ReadAll().split(/\r?\n/);
        f.Close();
        for (var i = 0; i < lines.length; i++) {
            var kv = lines[i].split("=");
            if (kv.length == 2) out[kv[0]] = kv[1];
        }
    } catch (e) { }
    return out;
}

function writeState(io) {
    var s = [];
    for (var k in io) s.push(k + "=" + io[k]);
    writeAtomic(statePath, s.join("\r\n"));
}

function readPnpIds() {
    var out = {}, e = new Enumerator(cim.ExecQuery("SELECT Index, PNPDeviceID FROM Win32_DiskDrive"));
    for (; !e.atEnd(); e.moveNext()) out[String(e.item().Index)] = String(e.item().PNPDeviceID);
    return out;
}

// Raw SMART table of one ATA drive: {life, temp, hours}, or null (NVMe, USB bridges, ...).
// Fetched by instance so that no other drive is queried.
function readSmartTable(pnpId) {
    try {
        var wmi = locator.ConnectServer(".", "root\\wmi");
        var obj = wmi.Get("MSStorageDriver_ATAPISmartData.InstanceName=\"" +
            (pnpId + "_0").replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"");
        return parseSmart(new VBArray(obj.VendorSpecific).toArray());
    } catch (err) {
        return null;
    }
}

// 30 entries of 12 bytes after a 2-byte revision: id, flags(2), normalized, worst, raw(6), reserved
function parseSmart(b) {
    var attrs = {};
    for (var off = 2; off + 12 <= b.length; off += 12) {
        if (!b[off]) continue;
        var raw = 0;
        for (var k = 5; k >= 0; k--) raw = raw * 256 + b[off + 5 + k];
        attrs[b[off]] = { norm: b[off + 3], raw: raw, low: b[off + 5] };
    }
    var r = { life: null, temp: null, hours: null };
    for (var i = 0; i < LIFE_ATTRS.length && r.life == null; i++) {
        var a = attrs[LIFE_ATTRS[i]];
        if (a && a.norm > 0 && a.norm <= 100) r.life = a.norm;
    }
    var temp = attrs[194] || attrs[190];
    if (temp && temp.low > 0 && temp.low < 120) r.temp = temp.low;
    if (attrs[9]) r.hours = attrs[9].raw % 4294967296;
    return r;
}

function writeAtomic(path, text) {
    var dir = fso.GetParentFolderName(path);
    if (!fso.FolderExists(dir)) fso.CreateFolder(dir);
    var tmp = path + ".tmp";
    var f = fso.CreateTextFile(tmp, true);
    f.Write(text);
    f.Close();
    if (fso.FileExists(path)) fso.DeleteFile(path, true);
    fso.MoveFile(tmp, path);
}
