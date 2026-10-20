// Weather Meter Modern: current weather, a Windy-style hourly chart (temperature,
// precipitation, wind or pressure, switched by tabs) and a few days ahead.
//  - Forecast: Open-Meteo (free, no key), every 30 minutes, cached for a quick start.
//  - Place in Auto mode: the Windows location service through locate.ps1 (follows you from
//    town to town), else the IP address (get.geojs.io); named via OpenStreetMap Nominatim.
//    Coordinates are rounded to ~1 km before they leave the PC.
//  - Or a place picked in the location flyout (place.html), with a short list of recent ones.
//  - Map tab (can be turned off): RainViewer rain radar of the last 80 minutes, looped over a
//    dark Esri map; downloaded only while the tab is open.
// All requests are asynchronous and polled by a 1 s timer, so the Sidebar never blocks.

addStrings({
    en: {
        hdrWeather: "WEATHER", feels: "feels like", locating: "locating…", noWeather: "no weather data",
        tabTemp: "Temp", tabRain: "Rain", tabWind: "Wind", tabPress: "Pressure", tabMap: "Map",
        mapHint: "Rain radar. Click to open Windy for this place", radarWait: "loading radar…",
        today: "Today", isThis: "Is this %s?", yes: "Yes", change: "change", placeHint: "Click to pick another place",
        auto: "auto", gusts: "gusts", mm: "mm", ms: "m/s", kmh: "km/h", mph: "mph", kn: "kn",
        hpa: "hPa", mmhg: "mmHg", inhg: "inHg", updated: "updated", herePlace: "current location",
        days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        dry: "No rain expected",
        plTitle: "Location", plAuto: "Auto — where I am", plSearch: "Find a city", plFind: "Find",
        plRecent: "Recent", plSearching: "searching…", plFailed: "no connection", plNothing: "nothing found",
        wx0: "Clear", wx1: "Mostly clear", wx2: "Partly cloudy", wx3: "Overcast", wx45: "Fog",
        wx51: "Drizzle", wx56: "Freezing drizzle", wx61: "Rain", wx63: "Rain", wx65: "Heavy rain",
        wx66: "Freezing rain", wx71: "Snow", wx75: "Heavy snow", wx77: "Snow grains",
        wx80: "Showers", wx82: "Heavy showers", wx85: "Snow showers", wx95: "Thunderstorm", wx96: "Thunderstorm, hail"
    },
    ru: {
        hdrWeather: "ПОГОДА", feels: "ощущается", locating: "определяю место…", noWeather: "нет данных о погоде",
        tabTemp: "Темп.", tabRain: "Осадки", tabWind: "Ветер", tabPress: "Давл.", tabMap: "Карта",
        mapHint: "Радар осадков. Нажмите, чтобы открыть Windy для этого места", radarWait: "загружаю радар…",
        today: "Сегодня", isThis: "Это %s?", yes: "Да", change: "сменить", placeHint: "Нажмите, чтобы выбрать другое место",
        auto: "авто", gusts: "порывы", mm: "мм", ms: "м/с", kmh: "км/ч", mph: "миль/ч", kn: "уз",
        hpa: "гПа", mmhg: "мм рт. ст.", inhg: "дюйм рт. ст.", updated: "обновлено", herePlace: "текущее место",
        days: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
        dry: "Без осадков",
        plTitle: "Место", plAuto: "Авто — где я сейчас", plSearch: "Найти город", plFind: "Найти",
        plRecent: "Недавние", plSearching: "ищу…", plFailed: "нет связи", plNothing: "ничего не найдено",
        wx0: "Ясно", wx1: "Малооблачно", wx2: "Переменная облачность", wx3: "Пасмурно", wx45: "Туман",
        wx51: "Морось", wx56: "Ледяная морось", wx61: "Дождь", wx63: "Дождь", wx65: "Ливень",
        wx66: "Ледяной дождь", wx71: "Снег", wx75: "Сильный снег", wx77: "Снежная крупа",
        wx80: "Кратковременный дождь", wx82: "Сильный ливень", wx85: "Снегопад", wx95: "Гроза", wx96: "Гроза с градом"
    }
});

var W, IW, accent, graphH, narrow, hours, days, tUnit, wUnit, pUnit, tab, showMap;
var ui = null, timer = null, shell, fso;
var instanceId = Math.floor(Math.random() * 1e9);

var FORECAST_EVERY = 30 * 60000, LOCATE_EVERY = 30 * 60000, IP_EVERY = 3 * 3600000;
var SOURCE_W = 56;   // "Open-Meteo" credit at the end of the place line

// place: { lat, lon, name, src: "win" | "ip" | "pick" }
var place = null, forecast = null, forecastAt = 0, forecastFor = "";
var loc = { running: 0, next: 0, ipNext: 0, ip: null };
var http = { fc: new Http(), ip: new Http(), name: new Http(), radar: new Http() };

// Radar frames from RainViewer: [{ time, path }], refreshed every 10 minutes while the map shows
var RADAR_EVERY = 10 * 60000, RADAR_FRAMES = 9, MAP_ZOOM = 7;
var radar = { host: "", frames: [], at: 0, anim: null, idx: 0, hold: 0, layers: [] };

function init() {
    shell = new ActiveXObject("WScript.Shell");
    fso = new ActiveXObject("Scripting.FileSystemObject");
    hookSettings(rebuild);
    watchUpdates(rebuild);
    loadCache();
    rebuild();
    timer = setInterval(tick, 1000);
}

function shutdown() {
    if (timer) clearInterval(timer);
    stopMapAnim();
}

function now() { return new Date().getTime(); }

// ---- async HTTP --------------------------------------------------------------

function Http() { this.r = null; this.sent = 0; }

Http.prototype.get = function (url) {
    try {
        var r = new ActiveXObject("MSXML2.ServerXMLHTTP.6.0");
        r.open("GET", url, true);
        // Nominatim's usage policy asks every app to identify itself
        r.setRequestHeader("User-Agent", "ModernMeters/" + VERSION + " (github.com/silverenio/modern-meters)");
        r.send();
        this.r = r;
        this.sent = now();
    } catch (e) {
        this.r = null;
    }
};

Http.prototype.busy = function () { return this.r != null; };

// Parsed JSON once the reply is in, null on failure, undefined while waiting
Http.prototype.poll = function () {
    if (!this.r) return undefined;
    var state = 0;
    try { state = this.r.readyState; } catch (e) { }
    if (state != 4) {
        if (now() - this.sent < 30000) return undefined;
        try { this.r.abort(); } catch (e2) { }
        this.r = null;
        return null;
    }
    var r = this.r, data = null;
    this.r = null;
    try { if (r.status == 200) data = parseJson(r.responseText); } catch (e3) { }
    return data;
};

// JSON without the JSON object (the Sidebar's engine predates it): the text is checked to hold
// nothing but JSON tokens before it is evaluated (the json2.js approach)
function parseJson(text) {
    var s = String(text);
    if (!/^[\],:{}\s]*$/.test(s.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
        .replace(/(?:^|:|,)(?:\s*\[)+/g, ""))) return null;
    return eval("(" + s + ")");
}

// ---- settings ----------------------------------------------------------------

function readSettings() {
    LANG = langCode(getSetting("lang"));
    applyTheme(getSetting("theme"));
    W = parseInt(getSetting("width"), 10);
    IW = W - 2 * PAD;
    narrow = W < 240;
    accent = ACCENTS[getSetting("accent")] || ACCENTS.orange;
    graphH = parseInt(getSetting("graph"), 10) || 64;
    hours = parseInt(getSetting("hours"), 10) || 24;
    days = parseInt(getSetting("days"), 10) || 3;
    tUnit = getSetting("unit");
    wUnit = getSetting("wind");
    pUnit = getSetting("pressure");
    if (pUnit == "auto") pUnit = LANG == "ru" || LANG == "uk" ? "mmhg" : "hpa";
    showMap = getSetting("map") != "off";
    tab = getSetting("tab");
    if (tab == "map" && !showMap) tab = "temp";
}

function pickedPlace() {
    var p = String(getSetting("pick")).split(";");
    return p.length >= 3 && !isNaN(parseFloat(p[0])) ? { lat: parseFloat(p[0]), lon: parseFloat(p[1]), name: p.slice(2).join(";"), src: "pick" } : null;
}

function recentPlaces() {
    var out = [], items = String(getSetting("recent")).split("|");
    for (var i = 0; i < items.length; i++) {
        var p = items[i].split(";");
        if (p.length == 3 && !isNaN(parseFloat(p[1]))) out.push({ name: p[0], lat: parseFloat(p[1]), lon: parseFloat(p[2]) });
    }
    return out;
}

function remember(p) {
    var list = recentPlaces(), out = [p.name + ";" + p.lat + ";" + p.lon];
    for (var i = 0; i < list.length && out.length < 5; i++)
        if (list[i].name != p.name) out.push(list[i].name + ";" + list[i].lat + ";" + list[i].lon);
    setSetting("recent", out.join("|").replace(/\|$/, ""));
}

// ---- location ------------------------------------------------------------------

// ~1 km: enough for a forecast, not enough to point at a house
function round2(v) { return Math.round(v * 100) / 100; }

function locPath() {
    return shell.ExpandEnvironmentStrings("%TEMP%") + "\\weather_meter_modern_" + instanceId + "_loc.txt";
}

function scriptPath(name) {
    return IS_GADGET ? System.Gadget.path + "\\" + name :
        unescape(location.pathname.replace(/^\/+/, "").replace(/[^\\\/]*$/, "")).replace(/\//g, "\\") + name;
}

function updateLocation() {
    if (getSetting("mode") == "pick") {
        var p = pickedPlace();
        if (p && (!place || place.src != "pick" || place.lat != p.lat || place.lon != p.lon)) setPlace(p);
        return;
    }
    var t = now();
    // Windows location service, run hidden (a fix takes a few seconds)
    if (loc.running) {
        var text = null;
        try { if (fso.FileExists(locPath())) { var f = fso.OpenTextFile(locPath(), 1); text = f.AtEndOfStream ? "" : f.ReadAll(); f.Close(); } } catch (e) { }
        if (text == null && t - loc.running < 40000) return;
        try { fso.DeleteFile(locPath(), true); } catch (e2) { }
        loc.running = 0;
        var m = /^(-?[\d.]+);(-?[\d.]+)/.exec(text || "");
        if (m) {
            var lat = round2(parseFloat(m[1])), lon = round2(parseFloat(m[2]));
            // Keep the name while we haven't moved more than a few km
            if (!place || place.src != "win" || Math.abs(place.lat - lat) + Math.abs(place.lon - lon) > 0.04)
                setPlace({ lat: lat, lon: lon, name: "", src: "win" });
            return;
        }
        loc.ipNext = Math.min(loc.ipNext, t);   // no fix: fall back to the IP address
    } else if (t >= loc.next) {
        loc.next = t + LOCATE_EVERY;
        try {
            shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" +
                scriptPath("locate.ps1") + "\" \"" + locPath() + "\"", 0, false);
            loc.running = t;
            return;
        } catch (e3) { }
    }
    if (place && place.src == "win") return;
    var ip = http.ip.poll();
    if (ip) {
        var la = parseFloat(ip.latitude), lo = parseFloat(ip.longitude);
        if (!isNaN(la)) setPlace({ lat: round2(la), lon: round2(lo), name: ip.city || "", src: "ip" });
    } else if (!http.ip.busy() && t >= loc.ipNext) {
        loc.ipNext = t + IP_EVERY;
        http.ip.get("https://get.geojs.io/v1/ip/geo.json");
    }
}

function setPlace(p) {
    var moved = !place || place.lat != p.lat || place.lon != p.lon;
    place = p;
    if (p.src != "pick") requestName();
    if (moved) forecastAt = 0;
    showPlace();
}

// Auto places get their name in the gadget's language from OpenStreetMap
var nameRetry = 0;

function requestName() {
    nameRetry = 0;
    http.name.get("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=" +
        place.lat + "&lon=" + place.lon + "&accept-language=" + LANG);
}

function updateName() {
    if (nameRetry && now() >= nameRetry && place && !http.name.busy()) requestName();
    var r = http.name.poll();
    if (r === undefined || !place) return;
    var a = (r && r.address) || {};
    var n = a.city || a.town || a.village || a.municipality || a.county || (r && r.name);
    if (n) { place.name = n; showPlace(); }
    else if (place.src != "pick") nameRetry = now() + 60000;   // busy or offline: ask again later
}

// Called from the location flyout
function placeState() {
    return { mode: getSetting("mode"), name: place ? place.name : "", recent: recentPlaces(), glass: THEME.glass };
}

function pickPlace(lat, lon, name) {
    var p = { lat: round2(lat), lon: round2(lon), name: name, src: "pick" };
    setSetting("mode", "pick");
    setSetting("pick", p.lat + ";" + p.lon + ";" + name);
    setSetting("confirmed", "1");
    remember(p);
    setPlace(p);
    closeFlyout();
}

function useAuto() {
    setSetting("mode", "auto");
    setSetting("confirmed", "1");
    place = null;
    loc.next = 0;
    loc.ipNext = 0;
    closeFlyout();
    showPlace();
}

function openPlaces() {
    if (!IS_GADGET) return;
    var f = System.Gadget.Flyout;
    if (f.show) { f.show = false; return; }
    f.file = "place.html";
    f.show = true;
}

function closeFlyout() {
    if (IS_GADGET) System.Gadget.Flyout.show = false;
}

// ---- forecast ----------------------------------------------------------------

function cachePath() {
    return shell.ExpandEnvironmentStrings("%APPDATA%") + "\\ModernMeters\\weather_cache.txt";
}

function loadCache() {
    try {
        var f = fso.OpenTextFile(cachePath(), 1, false, -1), head = f.ReadLine().split(";"), text = f.ReadAll();
        f.Close();
        forecast = parseJson(text);
        forecastFor = head[0] + ";" + head[1];
        forecastAt = parseFloat(head[2]) || 0;
        if (forecast && !place) place = { lat: parseFloat(head[0]), lon: parseFloat(head[1]), name: head.slice(3).join(";"), src: "cache" };
    } catch (e) { }
}

function saveCache(text) {
    try {
        var dir = fso.GetParentFolderName(cachePath());
        if (!fso.FolderExists(dir)) fso.CreateFolder(dir);
        var f = fso.CreateTextFile(cachePath(), true, true);
        f.WriteLine(place.lat + ";" + place.lon + ";" + forecastAt + ";" + (place.name || ""));
        f.Write(text);
        f.Close();
    } catch (e) { }
}

function updateForecast() {
    if (http.fc.busy()) {
        var r = http.fc.r, data = http.fc.poll();
        if (data && data.hourly) {
            forecast = data;
            forecastAt = now();
            try { saveCache(r.responseText); } catch (e) { }
            draw();
        }
        return;
    }
    if (!place || place.src == "cache") return;
    var key = place.lat + ";" + place.lon;
    if (key == forecastFor && now() - forecastAt < FORECAST_EVERY) return;
    forecastFor = key;
    forecastAt = now();   // a failed request is retried after the same interval
    http.fc.get("https://api.open-meteo.com/v1/forecast?latitude=" + place.lat + "&longitude=" + place.lon +
        "&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_direction_10m,pressure_msl" +
        "&hourly=temperature_2m,precipitation,precipitation_probability,snowfall,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum" +
        "&timezone=auto&forecast_days=7&wind_speed_unit=ms");
}

function tick() {
    try {
        updateLocation();
        updateName();
        updateForecast();
        updateRadar();
    } catch (e) {
        reportError(ui.desc, "tick", e);
    }
}

// ---- units and colors -----------------------------------------------------------

function temp(c) { return fmtTemp(c, tUnit); }

function windVal(ms) {
    var k = { ms: 1, kmh: 3.6, mph: 2.23694, kn: 1.94384 }[wUnit] || 1;
    return Math.round(ms * k);
}

function pressVal(hpa) {
    return pUnit == "mmhg" ? Math.round(hpa * 0.750062) : pUnit == "inhg" ? (hpa * 0.02953).toFixed(2) : Math.round(hpa);
}

// Color scales after Windy's
function scale(stops, v) {
    if (v <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++)
        if (v <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    return stops[stops.length - 1][1];
}

var TEMP_COLORS = [[-25, "#9b5de5"], [-10, "#3a86ff"], [0, "#4cc2ff"], [10, "#7ee787"], [20, "#f5d547"], [28, "#ff9f43"], [35, "#ff5f56"]];
var WIND_COLORS = [[0, "#3a86ff"], [3, "#4cc2ff"], [6, "#7ee787"], [10, "#f5d547"], [15, "#ff9f43"], [20, "#ff5f56"], [28, "#b18cff"]];
var RAIN_COLORS = [[0, "#9ad0ff"], [1, "#4cc2ff"], [4, "#3a86ff"], [10, "#9b5de5"]];

// Arrow pointing where the wind blows to (direction is where it comes from)
function windArrow(deg) {
    return ["↓", "↙", "←", "↖", "↑", "↗", "→", "↘"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// WMO weather code -> icon kind (img/wx_<kind>.png) and description key
function wxKind(code, day) {
    var dn = day ? "_d" : "_n";
    if (code == 0) return "clear" + dn;
    if (code <= 2) return "partly" + dn;
    if (code == 3) return "cloudy";
    if (code == 45 || code == 48) return "fog";
    if (code >= 51 && code <= 55) return "drizzle";
    if (code == 56 || code == 57 || code == 66 || code == 67) return "sleet";
    if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return "rain";
    if ((code >= 71 && code <= 77) || code == 85 || code == 86) return "snow";
    if (code >= 95) return "thunder";
    return "cloudy";
}

function wxText(code) {
    var keys = [0, 1, 2, 3, 45, 51, 56, 61, 63, 65, 66, 71, 75, 77, 80, 82, 85, 95, 96], best = 0;
    for (var i = 0; i < keys.length; i++) if (keys[i] <= code) best = keys[i];
    if (code == 48) best = 45;
    if (code == 53 || code == 55) best = 51;
    if (code == 57) best = 56;
    if (code == 67) best = 66;
    if (code == 73) best = 71;
    if (code == 81) best = 80;
    if (code == 86) best = 85;
    if (code == 99) best = 96;
    return T("wx" + best);
}

// ---- layout ----------------------------------------------------------------------

function rebuild() {
    readSettings();
    var root = $("root");
    root.innerHTML = "";
    ui = {};
    var y = header(root, 10, "sky", T("hdrWeather"));

    // Current conditions: icon, temperature, feels-like, description, place
    ui.icon = icon(root, PAD - 2, y, 48, "wx_cloudy");
    ui.icon.style.display = "none";
    ui.temp = label(root, PAD + 50, y - 2, IW - 50, narrow ? 26 : 30, THEME.text, "right", true);
    ui.feels = label(root, PAD + 50, y + (narrow ? 32 : 36), IW - 50, 10, THEME.dim, "right");
    y += narrow ? 50 : 54;
    ui.desc = label(root, PAD, y, IW, 11, THEME.text);
    y += 17;
    ui.place = label(root, PAD, y, IW - SOURCE_W, 10, THEME.dim);
    ui.place.style.cursor = "hand";
    // Credit to the data source (its license asks for it); the update time is in its tooltip
    ui.time = label(root, W - PAD - SOURCE_W, y + 1, SOURCE_W, 9, THEME.faint, "right");
    setText(ui.time, "Open-Meteo");
    setHint(ui.time, "Weather data by Open-Meteo.com (CC BY 4.0)", "https://open-meteo.com/");
    y += 20;

    // Tabs as wide as their names plus an equal share of the rest; a smaller font when the
    // names of this language don't fit side by side
    var tabs = [["temp", "tabTemp"], ["rain", "tabRain"], ["wind", "tabWind"], ["press", "tabPress"]];
    if (showMap) tabs.push(["map", "tabMap"]);
    var fs = narrow ? 9 : 10, widths, sum, tx = PAD, i;
    for (; ; fs--) {
        widths = [];
        sum = 0;
        for (i = 0; i < tabs.length; i++) { widths.push(textWidth(T(tabs[i][1]), fs, true)); sum += widths[i]; }
        if (sum + 2 * tabs.length <= IW || fs <= 7) break;
    }
    var spare = Math.max(0, IW - sum) / tabs.length;
    ui.tabs = [];
    for (i = 0; i < tabs.length; i++) {
        var tw = i == tabs.length - 1 ? PAD + IW - tx : Math.round(widths[i] + spare);
        var t = label(root, tx, y, tw, fs, THEME.faint, "center", true);
        setText(t, T(tabs[i][1]));
        t.style.cursor = "hand";
        t.onclick = (function (key) { return function () { setSetting("tab", key); tab = key; drawTabs(); drawChart(); }; })(tabs[i][0]);
        ui.tabs.push({ key: tabs[i][0], el: t, line: rect(root, tx + 3, y + 15, tw - 6, 2, accent) });
        tx += tw;
    }
    rect(root, PAD, y + 17, IW, 1, THEME.sep);
    y += 22;

    // Chart: range label, bars, a value row every few hours, time axis
    ui.chart = box(root, PAD, y, IW, graphH + 38, "");
    y += graphH + 40;

    // Days ahead; narrow columns put the low under the high
    rect(root, PAD, y, IW, 1, THEME.sep);
    y += 5;
    var twoLines = IW / days < 44;
    ui.days = box(root, PAD, y, IW, twoLines ? 60 : 50, "");
    y += twoLines ? 58 : 48;
    if (THEME.glass) y += 4;

    updateBadge(root);
    paintFrame(W, y);
    drawTabs();
    draw();
}

function drawTabs() {
    for (var i = 0; i < ui.tabs.length; i++) {
        var on = ui.tabs[i].key == tab;
        setColor(ui.tabs[i].el, on ? THEME.text : THEME.faint);
        ui.tabs[i].line.style.display = on ? "" : "none";
    }
}

function showPlace() {
    if (!ui) return;
    var auto = getSetting("mode") != "pick";
    // First run: offer the detected place for a quick yes, in the place line itself
    if (getSetting("confirmed") != "1" && place && place.name && auto && place.src != "cache") {
        ui.place.onclick = null;
        ui.place.style.cursor = "default";
        ui.place.title = "";
        setColor(ui.place, accent);
        ui.place.innerHTML = esc(T("isThis").replace("%s", place.name)) +
            " &nbsp;<span id='wxYes' style='cursor:hand;text-decoration:underline'>✓ " + esc(T("yes")) + "</span>" +
            " &nbsp;<span id='wxNo' style='cursor:hand;text-decoration:underline'>" + esc(T("change")) + "</span>";
        $("wxYes").onclick = function () { setSetting("confirmed", "1"); showPlace(); };
        $("wxNo").onclick = openPlaces;
        ui.place.style.width = IW + "px";
        ui.time.style.display = "none";
        return;
    }
    ui.place.onclick = openPlaces;
    ui.place.style.cursor = "hand";
    ui.place.title = T("placeHint");
    ui.place.style.width = (IW - SOURCE_W) + "px";
    ui.time.style.display = "";
    setColor(ui.place, THEME.dim);
    // Without a name yet: no coordinates on screen, they'd show up in every screenshot
    setText(ui.place, place && place.name ? place.name + (auto ? "  ·  " + T("auto") : "") + " ›" :
        (place ? T("herePlace") + " ›" : T("locating")));
}

// Index of the current hour in the hourly arrays
function hourIndex(f) {
    var cur = String(f.current && f.current.time || "").substring(0, 13), times = f.hourly.time;
    for (var i = 0; i < times.length; i++) if (String(times[i]).substring(0, 13) == cur) return i;
    return 0;
}

function draw() {
    showPlace();
    var f = forecast;
    if (!f || !f.current) {
        setText(ui.desc, place ? T("noWeather") : T("locating"));
        return;
    }
    var c = f.current;
    ui.icon.src = "img/wx_" + wxKind(c.weather_code, c.is_day) + ".png";
    ui.icon.style.display = "";
    setText(ui.temp, temp(c.temperature_2m));
    setColor(ui.temp, scale(TEMP_COLORS, c.temperature_2m));
    setText(ui.feels, T("feels") + " " + temp(c.apparent_temperature));
    setText(ui.desc, wxText(c.weather_code));
    var d = new Date(forecastAt);
    ui.time.title = "Weather data by Open-Meteo.com (CC BY 4.0)  ·  " + T("updated") + " " +
        d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
    drawChart();
    drawDays();
}

function drawChart() {
    var f = forecast, box0 = ui.chart;
    stopMapAnim();
    box0.innerHTML = "";
    if (tab == "map") { drawMap(box0); return; }
    if (!f || !f.hourly) return;
    var h = f.hourly, start = hourIndex(f), n = Math.min(hours, h.time.length - start);
    if (n <= 0) return;
    var bw = Math.max(1, Math.floor(IW / n)), x0 = Math.floor((IW - bw * n) / 2), gap = bw > 3 ? 1 : 0;
    var top = 12, gh = graphH;   // bars live in [top, top + gh]
    var vals = [], i, v;

    var series = tab == "rain" ? h.precipitation : tab == "wind" ? h.wind_speed_10m : tab == "press" ? h.pressure_msl : h.temperature_2m;
    for (i = 0; i < n; i++) vals.push(series[start + i] == null ? 0 : series[start + i]);
    var lo = vals[0], hi = vals[0];
    for (i = 0; i < n; i++) { lo = Math.min(lo, vals[i]); hi = Math.max(hi, vals[i]); }
    if (tab == "wind") for (i = 0; i < n; i++) hi = Math.max(hi, h.wind_gusts_10m[start + i] || 0);

    // Scale: rain and wind from zero, temperature and pressure around their range
    var base, span;
    if (tab == "rain") { base = 0; span = Math.max(hi, 1); }
    else if (tab == "wind") { base = 0; span = Math.max(hi, 5); }
    else if (tab == "press") { base = lo - 2; span = Math.max(hi - lo + 4, 8); }
    else { base = lo - 2; span = Math.max(hi - lo + 3, 6); }
    var yOf = function (val) { return top + gh - Math.round(clamp((val - base) / span, 0, 1) * gh); };

    // Plot background with quarter lines, like the graphs of the other gadgets
    var plot = rect(box0, 0, top, IW, gh, THEME.plot);
    for (i = 1; i < 4; i++) rect(plot, 0, Math.round(gh * i / 4), IW, 1, THEME.grid);
    for (i = 0; i < n; i++) {
        v = vals[i];
        var x = x0 + i * bw, yy = yOf(v), color;
        if (tab == "rain") {
            // Chance of rain as a faint column behind the amount
            var prob = h.precipitation_probability ? h.precipitation_probability[start + i] || 0 : 0;
            if (prob > 0) rect(box0, x, top + gh - Math.round(prob / 100 * gh), bw - gap, Math.round(prob / 100 * gh), THEME.track);
            if (v <= 0) continue;
            color = (h.snowfall && h.snowfall[start + i] > 0) ? "#eaf0f7" : scale(RAIN_COLORS, v);
            yy = Math.min(yy, top + gh - 2);
        } else if (tab == "wind") {
            color = scale(WIND_COLORS, v);
            var gy = yOf(h.wind_gusts_10m[start + i] || v);
            rect(box0, x, gy, bw - gap, 2, mix(color, "#ffffff", 0.5));
        } else if (tab == "press") {
            rect(box0, x, yy, bw - gap, 3, accent);
            continue;
        } else {
            color = scale(TEMP_COLORS, v);
        }
        var bar = rect(box0, x, yy, bw - gap, top + gh - yy, color);
        if (THEME.glass) gradient(bar, color, mix(color, THEME.plot, 0.6));
    }

    // Range or total in the top corner
    var info = label(box0, 0, -1, IW, 9, THEME.dim, "right");
    if (tab == "rain") {
        var sum = 0, chance = 0;
        for (i = 0; i < n; i++) {
            sum += vals[i];
            if (h.precipitation_probability) chance = Math.max(chance, h.precipitation_probability[start + i] || 0);
        }
        setText(info, "Σ " + (Math.round(sum * 10) / 10) + " " + T("mm"));
        if (sum < 0.1 && chance < 20) setText(label(box0, 0, top + Math.round(gh / 2) - 8, IW, 11, THEME.dim, "center"), T("dry"));
    } else if (tab == "wind") {
        var gmax = 0;
        for (i = 0; i < n; i++) gmax = Math.max(gmax, h.wind_gusts_10m[start + i] || 0);
        setText(info, windVal(Math.max.apply(null, vals)) + " (" + T("gusts") + " " + windVal(gmax) + ") " + T(wUnit));
    } else if (tab == "press") {
        var trend = vals[Math.min(3, n - 1)] - vals[0];
        setText(info, pressVal(vals[0]) + " " + T(pUnit) + "  " + (trend > 0.5 ? "↗" : trend < -0.5 ? "↘" : "→"));
    } else {
        setText(info, temp(lo) + " … " + temp(hi));
    }

    // Every few hours: the value (wind: arrow and speed) above the time of day
    // Labels start half a step in, so the first one isn't squeezed against the edge
    var step = Math.max(3, Math.ceil(32 / bw)), rowY = top + gh + 3;
    for (i = Math.floor(step / 2); i < n; i += step) {
        var cx = x0 + i * bw + Math.floor(bw / 2), lw = 30;
        var lx = clamp(cx - lw / 2, 0, IW - lw);
        var vl = label(box0, lx, rowY, lw, 9, THEME.text, "center");
        if (tab == "wind") setText(vl, windArrow(h.wind_direction_10m[start + i]) + windVal(vals[i]));
        else if (tab == "rain") setText(vl, (h.precipitation_probability ? (h.precipitation_probability[start + i] || 0) : 0) + "%");
        else if (tab == "press") setText(vl, String(pressVal(vals[i])));
        else setText(vl, temp(vals[i]));
        var hh = String(h.time[start + i]).substring(11, 13);
        setText(label(box0, lx, rowY + 12, lw, 8, THEME.faint, "center"), hh);
    }
}

// ---- radar map ----------------------------------------------------------------

function updateRadar() {
    if (tab != "map" || !ui) return;
    if (http.radar.busy()) {
        var d = http.radar.poll();
        if (d && d.radar && d.radar.past) {
            radar.host = d.host;
            radar.frames = d.radar.past.slice(-RADAR_FRAMES);
            drawChart();
        }
        return;
    }
    if (now() - radar.at < RADAR_EVERY) return;
    radar.at = now();
    http.radar.get("https://api.rainviewer.com/public/weather-maps.json");
}

// Web Mercator pixel position at zoom z (256 px tiles)
function worldXY(lat, lon, z) {
    var n = 256 * Math.pow(2, z), s = Math.sin(lat * Math.PI / 180);
    return { x: (lon + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

// Tiles covering a w x h view centered on the place: [{ x, y, left, top }] (x wrapped around)
function viewTiles(c, w, h, z) {
    var out = [], left = Math.round(c.x - w / 2), top = Math.round(c.y - h / 2), n = Math.pow(2, z);
    for (var ty = Math.floor(top / 256); ty <= Math.floor((top + h - 1) / 256); ty++)
        for (var tx = Math.floor(left / 256); tx <= Math.floor((left + w - 1) / 256); tx++)
            if (ty >= 0 && ty < n) out.push({ x: ((tx % n) + n) % n, y: ty, left: tx * 256 - left, top: ty * 256 - top });
    return out;
}

function tileImg(parent, t, src) {
    var img = document.createElement("img");
    img.src = src;
    // Radar tiles come at 512 px and are shown at 256, so they stay sharp on high-DPI screens
    img.style.cssText = "position:absolute;left:" + t.left + "px;top:" + t.top + "px;width:256px;height:256px;";
    parent.appendChild(img);
}

function drawMap(box0) {
    // Same space as the charts: their value and time rows become map, plus a line for the credits
    var top = 12, mh = graphH + 12, z = MAP_ZOOM;
    var info = label(box0, 0, -1, IW, 9, THEME.dim, "right");
    var credit = label(box0, 0, top + mh + 1, IW, 8, THEME.faint, "right");
    setText(credit, "© Esri, OpenStreetMap · RainViewer");
    if (!place) { setText(info, T("locating")); return; }

    var view = box(box0, 0, top, IW, mh, "overflow:hidden;background-color:" + THEME.plot + ";cursor:hand;");
    view.title = T("mapHint");
    view.onclick = function () { openUrl("https://www.windy.com/?radar," + place.lat + "," + place.lon + ",8"); };
    // Esri's dark gray canvas (no key needed): land and water below the radar, place names above it
    var tiles = viewTiles(worldXY(place.lat, place.lon, z), IW, mh, z), i, j;
    var esri = function (layer, t) {
        return "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_" + layer +
            "/MapServer/tile/" + z + "/" + t.y + "/" + t.x;
    };
    for (i = 0; i < tiles.length; i++) tileImg(view, tiles[i], esri("Base", tiles[i]));

    // One layer of radar tiles per frame; the animation shows them in turn
    radar.layers = [];
    for (j = 0; j < radar.frames.length; j++) {
        var layer = box(view, 0, 0, IW, mh, "display:none;");
        for (i = 0; i < tiles.length; i++)
            tileImg(layer, tiles[i], radar.host + radar.frames[j].path + "/512/" + z + "/" + tiles[i].x + "/" + tiles[i].y + "/2/1_1.png");
        radar.layers.push(layer);
    }
    for (i = 0; i < tiles.length; i++) tileImg(view, tiles[i], esri("Reference", tiles[i]));
    // You are here
    rect(view, Math.round(IW / 2) - 3, Math.round(mh / 2) - 3, 6, 6, "#ffffff");
    rect(view, Math.round(IW / 2) - 2, Math.round(mh / 2) - 2, 4, 4, accent);

    ui.mapInfo = info;
    if (!radar.layers.length) { setText(info, T("radarWait")); return; }
    radar.idx = radar.layers.length - 1;
    showFrame();
    radar.anim = setInterval(stepFrame, 500);
}

// Loops through the frames and rests on the newest one for a moment
function stepFrame() {
    if (radar.hold > 0) { radar.hold--; return; }
    radar.layers[radar.idx].style.display = "none";
    radar.idx = (radar.idx + 1) % radar.layers.length;
    showFrame();
}

function showFrame() {
    radar.layers[radar.idx].style.display = "";
    if (radar.idx == radar.layers.length - 1) radar.hold = 4;
    var d = new Date(radar.frames[radar.idx].time * 1000);
    setText(ui.mapInfo, d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes());
    setColor(ui.mapInfo, radar.idx == radar.layers.length - 1 ? THEME.text : THEME.dim);
}

function stopMapAnim() {
    if (radar.anim) clearInterval(radar.anim);
    radar.anim = null;
    radar.layers = [];
}

function drawDays() {
    var f = forecast, box0 = ui.days;
    box0.innerHTML = "";
    if (!f || !f.daily) return;
    var dl = f.daily, n = Math.min(days, dl.time.length), cw = Math.floor(IW / n);
    for (var i = 0; i < n; i++) {
        var x = i * cw, p = String(dl.time[i]).split("-");
        var wd = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getDay();
        setText(label(box0, x, 0, cw, 9, THEME.dim, "center"), i == 0 && n <= 3 ? T("today") : T("days")[wd]);
        icon(box0, x + Math.floor((cw - 22) / 2), 12, 22, "wxs_" + wxKind(dl.weather_code[i], true));
        var hi = label(box0, x, 35, cw, 10, scale(TEMP_COLORS, dl.temperature_2m_max[i]), "center", true);
        if (cw < 44) {
            setText(hi, temp(dl.temperature_2m_max[i]));
            setText(label(box0, x, 47, cw, 10, THEME.dim, "center"), temp(dl.temperature_2m_min[i]));
        } else {
            hi.innerHTML = esc(temp(dl.temperature_2m_max[i])) +
                " <span style='color:" + THEME.dim + ";font-weight:normal'>" + esc(temp(dl.temperature_2m_min[i])) + "</span>";
        }
    }
}
