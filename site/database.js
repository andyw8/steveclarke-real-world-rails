// Vendored from sql.js 1.13.0 (MIT); see vendor/sql.js/LICENSE.
const SQLJS_DIST = new URL("vendor/sql.js/", import.meta.url).href;
const DATABASE_URL = new URL("repos.sqlite", import.meta.url);

let databasePromise;

export function openDatabase() {
  databasePromise ??= loadDatabase();
  return databasePromise;
}

async function loadDatabase() {
  const SQL = await window.initSqlJs({
    locateFile: (file) => SQLJS_DIST + file
  });

  const response = await fetch(DATABASE_URL);
  if (!response.ok) {
    throw new Error(`Could not load ${DATABASE_URL.pathname} (HTTP ${response.status})`);
  }

  return new SQL.Database(new Uint8Array(await response.arrayBuffer()));
}

export function query(database, sql, parameters = []) {
  const statement = database.prepare(sql);

  try {
    statement.bind(parameters);

    const rows = [];
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }

    return rows;
  } finally {
    statement.free();
  }
}

export function formatNumber(value) {
  return value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US").format(value);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC"
});

export function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date);
}

export function formatSize(kilobytes) {
  if (kilobytes === null || kilobytes === undefined) return "—";

  const bytes = kilobytes * 1024;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 10 * 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function splitList(value) {
  return value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
}

export function yesNo(value) {
  if (value === null || value === undefined) return "—";
  return value ? "Yes" : "No";
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function badge(text, modifier) {
  return element("span", modifier ? `badge ${modifier}` : "badge", text);
}
