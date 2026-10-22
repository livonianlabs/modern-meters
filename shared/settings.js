// Builds the settings form from settingsSpec() (defined per gadget in defaults.js). Every
// <select> is bound to the gadget setting named by its key; labels switch language as soon
// as the "lang" select changes.

var OPT = {
    onOff: [["on", { en: "On", ru: "Вкл" }], ["off", { en: "Off", ru: "Выкл" }]],
    // Auto, then every language with a file in lang/ (see LANGUAGES in common.js)
    lang: [["auto", { en: "Auto (as Windows)", ru: "Авто (как в Windows)" }]].concat(LANGUAGES),
    accent: [
        ["blue", { en: "Blue", ru: "Голубой" }], ["teal", { en: "Teal", ru: "Бирюзовый" }],
        ["green", { en: "Green", ru: "Зелёный" }], ["purple", { en: "Purple", ru: "Фиолетовый" }],
        ["orange", { en: "Orange", ru: "Оранжевый" }], ["pink", { en: "Pink", ru: "Розовый" }],
        ["red", { en: "Red", ru: "Красный" }], ["yellow", { en: "Yellow", ru: "Жёлтый" }]],
    width: [
        ["170", { en: "Classic (170)", ru: "Как старые (170)" }], ["220", { en: "Medium (220)", ru: "Средний (220)" }],
        ["260", { en: "Wide (260)", ru: "Широкий (260)" }], ["320", { en: "Wider (320)", ru: "Шире (320)" }],
        ["400", { en: "Widest (400)", ru: "Очень широкий (400)" }]],
    graph: [
        ["0", { en: "Hidden", ru: "Скрыт" }], ["40", { en: "Low", ru: "Низкий" }], ["64", { en: "Medium", ru: "Средний" }],
        ["96", { en: "Tall", ru: "Высокий" }], ["140", { en: "Huge", ru: "Огромный" }]],
    unit: [["C", "°C"], ["F", "°F"]],
    interval: [
        ["500", { en: "0.5 s", ru: "0.5 с" }], ["1000", { en: "1 s", ru: "1 с" }],
        ["2000", { en: "2 s", ru: "2 с" }], ["3000", { en: "3 s", ru: "3 с" }]],
    volume: [["25", "25%"], ["50", "50%"], ["75", "75%"], ["100", "100%"]],
    repeat: [["once", { en: "Once", ru: "Один раз" }], ["loop", { en: "Until silenced", ru: "Пока не заглушить" }]]
};

OPT.alarmTemp = [];
for (var t = 60; t <= 100; t += 5) OPT.alarmTemp.push([String(t), t + "°C"]);

// Sounds from %WINDIR%\Media
OPT.sound = [];
for (var s = 1; s <= 10; s++) OPT.sound.push(["Alarm" + (s < 10 ? "0" : "") + s + ".wav", { en: "Alarm " + s, ru: "Сигнал " + s }]);
for (s = 1; s <= 10; s++) OPT.sound.push(["Ring" + (s < 10 ? "0" : "") + s + ".wav", { en: "Ring " + s, ru: "Звонок " + s }]);
OPT.sound.push(["Windows Critical Stop.wav", { en: "Critical stop", ru: "Критическая ошибка" }]);
OPT.sound.push(["Windows Exclamation.wav", { en: "Exclamation", ru: "Восклицание" }]);
OPT.sound.push(["Windows Battery Critical.wav", { en: "Battery critical", ru: "Батарея разряжена" }]);

// noTemp: the gadget shows no temperatures, so the unit row is left out.
// graphOpts: graph heights other than OPT.graph
function generalRows(noTemp, graphOpts) {
    var rows = [
        { key: "lang", label: { en: "Language", ru: "Язык" }, options: OPT.lang },
        { section: { en: "Display", ru: "Вид" } },
        // Auto, then the modern styles, the frosted glass and the retro ones, each group A to Z
        { key: "theme", label: { en: "Style", ru: "Стиль" }, options: [
            ["auto", OPT.lang[0][1]],
            ["classic", { en: "Classic (flat)", ru: "Классический" }], ["tinted", { en: "Colored glass", ru: "Цветное стекло" }],
            ["glass", { en: "Glass", ru: "Стекло" }], ["light", { en: "Light", ru: "Светлый" }],
            ["aero", { en: "Aero (Windows 7)", ru: "Aero (Windows 7)" }],
            ["liquid", { en: "Liquid Glass (Apple)", ru: "Liquid Glass (Apple)" }],
            ["terminal", { en: "Retro terminal", ru: "Ретро-терминал" }],
            ["mono", { en: "Terminal: black and white", ru: "Терминал: чёрно-белый" }],
            ["norton", { en: "Terminal: Norton Commander", ru: "Терминал: Norton Commander" }],
            ["ubuntu", { en: "Terminal: Ubuntu", ru: "Терминал: Ubuntu" }],
            ["win98", { en: "Windows classic", ru: "Классический Windows" }]] },
        { key: "accent", label: { en: "Accent color", ru: "Цвет акцента" }, options: OPT.accent },
        // Liquid Glass and Aero: how much tint over the blurred wallpaper; light or dark only in
        // Liquid Glass. Shown only with those styles picked.
        { key: "frost", label: { en: "Glass frosting", ru: "Матовость стекла" }, showWith: ["theme", ["aero", "liquid"]], options: [
            ["15", "15%"], ["25", "25%"], ["40", "40%"], ["55", "55%"], ["70", "70%"]] },
        { key: "glass", label: { en: "Glass tint", ru: "Оттенок стекла" }, showWith: ["theme", ["liquid"]], options: [
            ["auto", { en: "By wallpaper", ru: "По обоям" }], ["light", { en: "Light", ru: "Светлое" }],
            ["dark", { en: "Dark", ru: "Тёмное" }]] },
        { key: "sync", label: { en: "For all gadgets", ru: "Для всех гаджетов" }, options: [
            ["off", { en: "Only this one", ru: "Только для этого" }],
            ["style", { en: "Style and language", ru: "Стиль и язык" }],
            ["all", { en: "Style, color, language", ru: "Стиль, цвет и язык" }]] },
        { key: "width", label: { en: "Width", ru: "Ширина" }, options: OPT.width },
        { key: "graph", label: { en: "Graph", ru: "График" }, options: graphOpts || OPT.graph },
        { key: "unit", label: { en: "Temperature", ru: "Температура" }, options: OPT.unit },
        { key: "interval", label: { en: "Refresh", ru: "Обновление" }, options: OPT.interval }
    ];
    if (noTemp) rows.splice(9, 1);
    return rows;
}

// title: section heading other than the overheat one; noTemp: no temperature threshold row
function alarmRows(title, noTemp) {
    var rows = [
        { section: title || { en: "Overheat alarm", ru: "Сигнал перегрева" } },
        { key: "alarm", label: { en: "Alarm", ru: "Сигнал" }, options: OPT.onOff },
        { key: "alarmTemp", label: { en: "Above", ru: "Выше" }, options: OPT.alarmTemp },
        { key: "sound", label: { en: "Sound", ru: "Звук" }, options: OPT.sound, play: true },
        { key: "volume", label: { en: "Volume", ru: "Громкость" }, options: OPT.volume },
        { key: "repeat", label: { en: "Repeat", ru: "Повтор" }, options: OPT.repeat }
    ];
    if (noTemp) rows.splice(2, 1);
    return rows;
}

// Added after every gadget's own rows
function aboutRows() {
    return [
        { section: { en: "About", ru: "О гаджете" } },
        { label: { en: "Version", ru: "Версия" }, info: function () {
            var s = updateAvailable();
            return VERSION + (s ? "  →  " + s.latest.replace(/^v/i, "") : "");
        } },
        // A badge on the gadget; the release is installed only when it is clicked
        { key: "updates", label: { en: "New versions", ru: "Новые версии" }, options: [
            ["on", { en: "Let me know", ru: "Сообщать" }],
            ["off", { en: "Don't check", ru: "Не проверять" }]] },
        { label: { en: "Like them?", ru: "Нравятся?" }, buttons: [
            { label: { en: "☕ Buy me a coffee", ru: "☕ Угостить кофе" }, run: function () { openUrl(KOFI_URL); } }] }
    ];
}

var rows;
var SETTINGS_MAX_H = 390;

function tr(v) {
    return phrase(v);
}

function selected(key) {
    var sel = $(key);
    return sel.options[sel.selectedIndex].value;
}

function settingsInit() {
    LANG = langCode(getSetting("lang"));
    rows = settingsSpec().concat(aboutRows());
    var table = $("form");
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i], line = table.insertRow(-1);
        row.line = line;
        if (row.section) {
            row.el = line.insertCell(-1);
            row.el.colSpan = 2;
            row.el.className = "sec";
            continue;
        }
        row.el = line.insertCell(-1);
        row.el.className = "k";
        var cell = line.insertCell(-1);
        // { label, info: fn returning text } shows a live status line
        if (row.info) {
            row.val = cell;
            cell.className = "info";
            continue;
        }
        // { label, buttons: [{ label, run }] } shows a row of action buttons
        if (row.buttons) {
            for (var b = 0; b < row.buttons.length; b++) {
                row.buttons[b].el = document.createElement("button");
                row.buttons[b].el.className = "act";
                row.buttons[b].el.onclick = row.buttons[b].run;
                cell.appendChild(row.buttons[b].el);
            }
            continue;
        }
        var sel = document.createElement("select");
        sel.id = row.key;
        var cur = getSetting(row.key);
        for (var j = 0; j < row.options.length; j++) {
            sel.options.add(new Option("", row.options[j][0]));
            if (row.options[j][0] == cur) sel.selectedIndex = j;
        }
        cell.appendChild(sel);
        if (row.play) {
            sel.className = "withPlay";
            row.btn = document.createElement("button");
            row.btn.innerText = "\u25B6";
            row.btn.onclick = function () { playSound(selected("sound"), parseInt(selected("volume"), 10)); };
            cell.appendChild(row.btn);
        }
    }
    $("lang").onchange = function () {
        LANG = langCode(selected("lang"));
        relabel();
    };
    $("theme").onchange = showRows;
    relabel();
    showRows();
    setInterval(refreshInfo, 2000);
    if (IS_GADGET) System.Gadget.onSettingsClosing = settingsClosing;
}

// Rows with showWith: [key, values] appear only while that select is set to one of the values.
// Up to SETTINGS_MAX_H the dialog grows with the content, beyond it the page scrolls.
function showRows() {
    for (var i = 0; i < rows.length; i++) {
        var w = rows[i].showWith;
        if (!w) continue;
        var v = selected(w[0]), on = false;
        for (var j = 0; j < w[1].length; j++) if (w[1][j] == v) on = true;
        rows[i].line.style.display = on ? "" : "none";
    }
    var h = Math.min($("inner").offsetHeight, SETTINGS_MAX_H);
    $("scroll").style.height = h + "px";
    document.body.style.height = h + "px";
}

function relabel() {
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        row.el.innerText = tr(row.section || row.label);
        if (row.section || row.info) continue;
        if (row.buttons) {
            for (var b = 0; b < row.buttons.length; b++) row.buttons[b].el.innerText = tr(row.buttons[b].label);
            continue;
        }
        var sel = $(row.key);
        for (var j = 0; j < row.options.length; j++) sel.options[j].text = tr(row.options[j][1]);
        if (row.btn) row.btn.title = tr({ en: "Play", ru: "Прослушать" });
    }
    $("note").innerText = tr(SETTINGS_NOTE);
    refreshInfo();
}

function refreshInfo() {
    for (var i = 0; i < rows.length; i++) if (rows[i].info) rows[i].val.innerText = tr(rows[i].info());
}

function settingsClosing(e) {
    stopSound();
    if (e.closeAction != e.Action.commit) return;
    var wasSync = syncMode(getSetting("sync"));
    for (var i = 0; i < rows.length; i++)
        if (rows[i].key) setSetting(rows[i].key, selected(rows[i].key));
    shareStyle(wasSync);
    e.cancel = false;
}
