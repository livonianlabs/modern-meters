var DEFAULTS = {
    lang: "auto",
    updates: "on",
    theme: "classic",
    frost: "40",
    glass: "auto",
    accent: "orange",
    width: "170",
    graph: "48",
    unit: "C",
    wind: "ms",
    pressure: "auto",
    hours: "24",
    days: "3",
    map: "on",
    extra: "on",
    tab: "temp",
    // Location: "auto" (Windows location, else IP) or "pick" (a place chosen in the flyout,
    // stored as "lat;lon;name"); recent: up to 5 "name;lat;lon" joined by "|"
    mode: "auto",
    pick: "",
    recent: "",
    confirmed: "0"
};

// Settings page layout (built by settings.js)
function settingsSpec() {
    var rows = generalRows(false, [
        ["48", { en: "Low", ru: "Низкий" }], ["64", { en: "Medium", ru: "Средний" }],
        ["90", { en: "Tall", ru: "Высокий" }], ["120", { en: "Huge", ru: "Огромный" }]]);
    rows.pop();   // refresh interval: the forecast updates every 30 minutes by itself
    return rows.concat([
        { key: "wind", label: { en: "Wind", ru: "Ветер" }, options: [
            ["ms", { en: "m/s", ru: "м/с" }], ["kmh", { en: "km/h", ru: "км/ч" }],
            ["mph", "mph"], ["kn", { en: "knots", ru: "узлы" }]] },
        { key: "pressure", label: { en: "Pressure", ru: "Давление" }, options: [
            ["auto", { en: "By language", ru: "По языку" }], ["mmhg", { en: "mmHg", ru: "мм рт. ст." }],
            ["hpa", { en: "hPa", ru: "гПа" }], ["inhg", { en: "inHg", ru: "дюймы рт. ст." }]] },
        { key: "hours", label: { en: "Chart", ru: "График на" }, options: [
            ["24", { en: "24 hours", ru: "24 часа" }], ["48", { en: "48 hours", ru: "48 часов" }]] },
        { key: "days", label: { en: "Days ahead", ru: "Дней вперёд" }, options: [
            ["3", "3"], ["5", "5"]] },
        { key: "map", label: { en: "Radar map tab", ru: "Вкладка «Карта»" }, options: OPT.onOff },
        { key: "extra", label: { en: "Sun, UV and air", ru: "Солнце, UV и воздух" }, options: OPT.onOff }
    ]);
}

var SETTINGS_NOTE = {
    en: "Click the place name on the gadget to search for a city or go back to Auto, which follows you through Windows location (or your IP address when it's off). Click the tabs to switch the chart. The map shows the rain radar of the last 80 minutes (RainViewer, on an Esri/OpenStreetMap map) and is only downloaded while its tab is open; click it to open Windy. Weather data by Open-Meteo.com.",
    ru: "Клик по названию места на гаджете — поиск города или возврат к режиму «Авто», который следует за вами через определение местоположения Windows (или по IP, если оно выключено). Вкладки переключают график. Карта показывает радар осадков за последние 80 минут (RainViewer, на карте Esri/OpenStreetMap) и загружается, только пока её вкладка открыта; клик открывает Windy. Данные о погоде: Open-Meteo.com."
};
