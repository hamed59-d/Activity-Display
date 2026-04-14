import https from "https";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
//import mysql from "mysql2/promise";
import {
  initDatabase,
  closeDatabase,
  logCollectorEvent,
  persistSnapshotToDb,
  getRecordedHistory,
  getRecordedAgentAnalytics,
  getRecordedPauseHistory,
  getRecordedAgentCallsAtHour,
} from "./db.js";
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
const XLSX = xlsx;

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const VICIDIAL_BASE_URL = (process.env.VICIDIAL_BASE_URL || "").replace(/\/+$/, "");
const VICIDIAL_USERNAME = process.env.VICIDIAL_USERNAME || "";
const VICIDIAL_PASSWORD = process.env.VICIDIAL_PASSWORD || "";

/*const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "vicidial";*/
const RECORD_SNAPSHOT_INTERVAL_MS = Number(process.env.RECORD_SNAPSHOT_INTERVAL_MS || 60000);


const EXCEL_RDV_PATH = path.resolve(process.cwd(), "excel", "Viccismart PRO GLOBAL.xlsx");

function normalizeRdvText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function parseRdvDate(value) {
  if (value == null || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const d = new Date(
        parsed.y,
        (parsed.m || 1) - 1,
        parsed.d || 1,
        parsed.H || 0,
        parsed.M || 0,
        parsed.S || 0
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  const raw = normalizeRdvText(value);
  if (!raw) return null;

  let s = raw
    .replace(/à/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})(?:[:h](\d{1,2}))?)?$/i);
  if (m) {
    const [, dd, mm, yyyy, hh = "00", mi = "00"] = m;
    const d = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      0
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+(\d{1,2})(?:[:h](\d{1,2}))?)?$/i);
  if (m) {
    const [, dd, mm, yy, hh = "00", mi = "00"] = m;
    const yyyy = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
    const d = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      0
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  s = s.replace(/(\d{1,2})h(\d{0,2})/gi, (_, h, m2) => `${h}:${m2 || "00"}`);
  s = s.replace(/(\d{1,2})\s*h/gi, "$1:00");

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function loadRdvRows() {
  if (!fs.existsSync(EXCEL_RDV_PATH)) return [];

  const workbook = XLSX.readFile(EXCEL_RDV_PATH, { cellDates: true });
  const rows = [];

  const pickValue = (row, candidates) => {
    const entries = Object.entries(row || {});
    for (const candidate of candidates) {
      const found = entries.find(([key]) =>
        normalizeRdvText(key).toLowerCase() === candidate.toLowerCase()
      );
      if (found && found[1] != null && String(found[1]).trim() !== "") {
        return found[1];
      }
    }

    for (const candidate of candidates) {
      const found = entries.find(([key]) =>
        normalizeRdvText(key).toLowerCase().includes(candidate.toLowerCase())
      );
      if (found && found[1] != null && String(found[1]).trim() !== "") {
        return found[1];
      }
    }

    return "";
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: true,
    });

    for (const row of json) {
      const dateRdv = pickValue(row, ["date de rdv", "rdv", "date rdv"]);
      const telepro = pickValue(row, ["telepro", "télépro", "tele pro"]);
      const produit = pickValue(row, ["produit", "product"]);
      const modeChauffage = pickValue(row, ["mode de chauffage", "chauffage"]);
      const batiment = pickValue(row, ["batiment", "bâtiment"]);

      rows.push({
        sheetName,
        telepro: normalizeRdvText(telepro),
        produit: normalizeRdvText(produit),
        modeChauffage: normalizeRdvText(modeChauffage),
        batiment: normalizeRdvText(batiment),
        dateRdvRaw: dateRdv,
        dateRdv: parseRdvDate(dateRdv),
      });
    }
  }

  return rows.filter(
    (row) =>
      row.telepro ||
      row.produit ||
      row.modeChauffage ||
      row.batiment ||
      row.dateRdvRaw
  );
}

function aggregateSimpleCount(rows, key, limit = 10) {
  const map = new Map();

  for (const row of rows) {
    const label = normalizeRdvText(row[key]) || "(non renseigné)";
    map.set(label, (map.get(label) || 0) + 1);
  }

  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function aggregateRdvTimeline(rows, mode) {
  const buckets = new Map();

  for (const row of rows) {
    if (!row.dateRdv) continue;
    const key = getBucketKey(row.dateRdv, mode);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  return [...buckets.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

//let dbPool = null;
let collectorTimer = null;
let shutdownInProgress = false;

function cleanText(value = "") {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function normalizeInline(value = "") {
  return cleanText(value).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

function toInt(value, fallback = 0) {
  if (value == null) return fallback;
  const normalized = String(value).replace(/[^0-9-]/g, "");
  if (!normalized) return fallback;
  const num = parseInt(normalized, 10);
  return Number.isNaN(num) ? fallback : num;
}

function toFloat(value, fallback = 0) {
  if (value == null) return fallback;
  const normalized = String(value).replace(/[^0-9.\-]/g, "");
  if (!normalized) return fallback;
  const num = parseFloat(normalized);
  return Number.isNaN(num) ? fallback : num;
}

function extractByLabel(text, label, fallback = "") {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*:?\\s*([^\\n]+)`, "i");
  const match = text.match(re);
  return match ? match[1].trim() : fallback;
}

function toSeconds(mmss = "") {
  const value = String(mmss || "").trim();
  if (!value || value === "-") return 0;
  const parts = value.split(":").map((x) => parseInt(x, 10));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function latencyToMs(label = "") {
  return toInt(String(label).replace(/ms/i, ""), 0);
}

function parseSystemLoadParts(rawText) {
  const match = cleanText(rawText).match(/System Load Average:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i);
  if (!match) {
    return { text: "", load1: null, load5: null, load15: null };
  }
  return {
    text: `${match[1]} | ${match[2]} | ${match[3]}`,
    load1: toFloat(match[1], null),
    load5: toFloat(match[2], null),
    load15: toFloat(match[3], null),
  };
}

function parseTopSummary(rawText) {
  const lines = cleanText(rawText).split("\n").map((x) => x.trim()).filter(Boolean);
  const joined = lines.join(" ");

  const dialableLeads = extractByLabel(joined, "DIALABLE LEADS", "0");
  const callsToday = extractByLabel(joined, "CALLS TODAY", "0");
  const avgAgents = extractByLabel(joined, "AVG AGENTS", "0");
  const dialMethod = extractByLabel(joined, "DIAL METHOD", "");
  const hopper = extractByLabel(joined, "HOPPER(min/auto)", "");
  const droppedTotal = extractByLabel(joined, "DROPPED / TOTAL", "");
  const dlDiff = extractByLabel(joined, "DL DIFF", "");
  const statuses = extractByLabel(joined, "STATUSES", "");
  const leadsInHopper = extractByLabel(joined, "LEADS IN HOPPER", "0");
  const avgPercDrop =
    extractByLabel(joined, "DROPPED PERCENT", "") ||
    extractByLabel(joined, "AVG PERC. DROP", "") ||
    "0%";
  const diff = extractByLabel(joined, "DIFF", "");
  const order = extractByLabel(joined, "ORDER", "");
  const agentAvgWait = extractByLabel(joined, "AGENT AVG WAIT", "0");
  const avgCustTime = extractByLabel(joined, "AVG CUSTTIME", "0");
  const avgAcw = extractByLabel(joined, "AVG ACW", "0");
  const avgPause = extractByLabel(joined, "AVG PAUSE", "0");
  const parkedCalls = extractByLabel(joined, "PARKED CALLS", "0");
  const avgParktimeAll = extractByLabel(joined, "AVG PARKTIME/ALL", "0/0");
  const sla1 = extractByLabel(joined, "SLA 1", "0%");
  const sla2 = extractByLabel(joined, "SLA 2", "0%");

  return {
    summaryLines: [
      ["Dial Level", dialableLeads],
      ["Calls Today", callsToday],
      ["Avg Agents", avgAgents],
      ["Time", new Date().toISOString().slice(0, 19).replace("T", " ")],
      ["Hopper ( min/auto )", hopper],
      ["Dropped / Total", droppedTotal],
      ["DL Diff", dlDiff],
      ["Statuses", statuses],
      ["Leads In Hopper", leadsInHopper],
      ["Dropped Percent", avgPercDrop],
      ["Diff", diff],
      ["Order", order],
      ["Agent Avg Wait", agentAvgWait],
      ["Avg CustTime", avgCustTime],
      ["Avg ACW", avgAcw],
      ["Avg Pause", avgPause],
    ],
    quickKpis: [
      ["Parked Calls", parkedCalls],
      ["Avg Parktime/All", avgParktimeAll],
      ["SLA 1", sla1],
      ["SLA 2", sla2],
    ],
  };
}

function parseKpiCards($, rawText = "", agentRows = []) {
  const definitions = [
    { label: "Current Active Calls", tone: "cyan" },
    { label: "Calls Ringing", tone: "blue" },
    { label: "Calls Waiting For Agents", tone: "rose" },
    { label: "Calls In IVR", tone: "violet" },
    { label: "Chats Waiting For Agents", tone: "sky" },
    { label: "Callback Queue Calls", tone: "indigo" },
    { label: "Agents Logged In", tone: "teal" },
    { label: "Agents In Calls", tone: "emerald" },
    { label: "Agents Waiting", tone: "lime" },
    { label: "Paused Agents", tone: "amber" },
    { label: "Agents In Dead Calls", tone: "zinc" },
    { label: "Agents In Dispo", tone: "yellow" },
  ];

  const fallbackFromAgents = {
    "Agents Logged In": agentRows.length,
    "Agents In Calls": agentRows.filter((r) => String(r.status || "").toUpperCase() === "INCALL").length,
    "Agents Waiting": agentRows.filter((r) => String(r.status || "").toUpperCase() === "READY").length,
    "Paused Agents": agentRows.filter(
      (r) =>
        String(r.status || "").toUpperCase() === "PAUSED" ||
        (r.pause && r.pause !== "-")
    ).length,
    "Agents In Dispo": agentRows.filter((r) => String(r.status || "").toUpperCase() === "DISPO").length,
  };

  const kpiTable = $("table.realtime_calls_table").first();
  if (!kpiTable.length) {
    return definitions.map((def) => ({
      label: def.label,
      value: fallbackFromAgents[def.label] ?? 0,
      tone: def.tone,
    }));
  }

  const rows = kpiTable.find("tr").toArray();

  const extractNumericCells = (tr) =>
    $(tr)
      .find("td")
      .toArray()
      .map((td) => cleanText($(td).text()))
      .filter((txt) => /^-?\d+$/.test(txt))
      .map((txt) => parseInt(txt, 10));

  const numericRows = rows
    .map(extractNumericCells)
    .filter((arr) => arr.length >= 6);

  const firstStats = numericRows[0] || [];
  const secondStats = numericRows[1] || [];

  const parsedMap = {
    "Current Active Calls": firstStats[0],
    "Calls Ringing": firstStats[1],
    "Calls Waiting For Agents": firstStats[2],
    "Calls In IVR": firstStats[3],
    "Chats Waiting For Agents": firstStats[4],
    "Callback Queue Calls": firstStats[5],

    "Agents Logged In": secondStats[0],
    "Agents In Calls": secondStats[1],
    "Agents Waiting": secondStats[2],
    "Paused Agents": secondStats[3],
    "Agents In Dead Calls": secondStats[4],
    "Agents In Dispo": secondStats[5],
  };

  return definitions.map((def) => ({
    label: def.label,
    value: Number.isFinite(parsedMap[def.label])
      ? parsedMap[def.label]
      : (fallbackFromAgents[def.label] ?? 0),
    tone: def.tone,
  }));
}

function parseCarrierStats($) {
  const tables = $("table").toArray();

  for (const table of tables) {
    const rows = [];
    $(table).find("tr").each((_, tr) => {
      const cells = $(tr)
        .find("th, td")
        .toArray()
        .map((cell) => cleanText($(cell).text()));
      if (cells.length) rows.push(cells);
    });

    const flat = rows.flat().join(" ").toUpperCase();
    if (!flat.includes("HANGUP STATUS") || !flat.includes("24 HOURS")) continue;

    const dataRows = rows
      .filter((r) => r.length >= 11)
      .filter((r) => {
        const name = (r[0] || "").toUpperCase();
        return [
          "ANSWER",
          "BUSY",
          "CANCEL",
          "CHANUNAVAIL",
          "CONGESTION",
          "NOANSWER",
          "TOTALS",
        ].includes(name);
      });

    if (dataRows.length) {
      return dataRows.map((r) => [
        r[0] || "",
        toInt(r[1]),
        r[2] || "",
        toInt(r[3]),
        r[4] || "",
        toInt(r[5]),
        r[6] || "",
        toInt(r[7]),
        r[8] || "",
        toInt(r[9]),
        r[10] || "",
        toInt(r[11]),
        r[12] || "",
      ]);
    }
  }

  return [];
}

function parseAgentRows($) {
  const tables = $("table").toArray();

  for (const table of tables) {
    const rows = [];
    $(table).find("tr").each((_, tr) => {
      const cells = $(tr)
        .find("th, td")
        .toArray()
        .map((cell) => cleanText($(cell).text()));
      if (cells.length) rows.push(cells);
    });

    const flat = rows.flat().join(" ").toUpperCase();
    if (!flat.includes("AGENTS TIME ON CALLS CAMPAIGN")) continue;
    if (!flat.includes("STATION") || !flat.includes("SESSIONID") || !flat.includes("LATENCY")) continue;

    const dataRows = rows.filter((r) => r.length >= 11 && /^SIP\//i.test(r[0] || ""));

    return dataRows.map((r) => {
      const status = (r[4] || "").toUpperCase();
      let color = "default";

      if (status === "READY") color = "ready";
      else if (status === "PAUSED") color = "paused";
      else if (status === "INCALL") color = "incall";
      else if (status === "DISPO") color = "dispo";

      return {
        station: r[0] || "",
        user: r[1] || "",
        showId: r[2] || "",
        sessionId: r[3] || "",
        status: r[4] || "",
        pause: r[5] || "",
        mmss: r[6] || "",
        campaign: r[7] || "",
        calls: toInt(r[8]),
        inbound: toInt(r[9]),
        latency: r[10] || "",
        hold: r[11] || "",
        inGroup: r[12] || "",
        color,
      };
    });
  }

  return [];
}

function buildResponseFromHtml(html) {
  const $ = cheerio.load(html);
  const rawText = cleanText($("body").text());

  const { summaryLines, quickKpis } = parseTopSummary(rawText);
  const carrierStats = parseCarrierStats($);
  const agentRows = parseAgentRows($);
  const topStats = parseKpiCards($, rawText, agentRows);
  const systemLoad = parseSystemLoadParts(rawText);

  const finalQuickKpis = [...quickKpis];
  if (systemLoad.text) {
    finalQuickKpis.unshift(["System Load Average", systemLoad.text]);
  }

  return {
    updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    topStats,
    summaryLines,
    carrierStats,
    agentRows,
    waitingCall: null,
    quickKpis: finalQuickKpis,
    systemLoad,
    historical: {
      daily: [],
      weekly: [],
      campaigns: [],
    },
  };
}

const snapshotHistory = [];
const MAX_HISTORY_POINTS = 20000;

function toIsoMinute(date = new Date()) {
  return new Date(date).toISOString().slice(0, 16);
}

function toDateSafe(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getBucketKey(date, mode) {
  const d = new Date(date);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  switch (mode) {
    case "Sec":
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    case "Min":
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    case "HH":
      return `${yyyy}-${mm}-${dd} ${hh}:00`;
    case "DD":
      return `${yyyy}-${mm}-${dd}`;
    case "W":
      return getWeekKey(d);
    case "MM":
      return `${yyyy}-${mm}`;
    case "YYYY":
      return `${yyyy}`;
    default:
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function extractTopStatsMap(data) {
  return Object.fromEntries((data.topStats || []).map((item) => [item.label, Number(item.value) || 0]));
}

function extractSummaryMap(data) {
  return Object.fromEntries(data.summaryLines || []);
}

function recordSnapshot(data) {
  const topStatsMap = extractTopStatsMap(data);
  const summaryMap = extractSummaryMap(data);

  const snapshot = {
    capturedAt: new Date(),
    activeCalls: topStatsMap["Current Active Calls"] || 0,
    callsRinging: topStatsMap["Calls Ringing"] || 0,
    callsWaiting: topStatsMap["Calls Waiting For Agents"] || 0,
    callsInIvr: topStatsMap["Calls In IVR"] || 0,
    chatsWaiting: topStatsMap["Chats Waiting For Agents"] || 0,
    callbackQueueCalls: topStatsMap["Callback Queue Calls"] || 0,
    agentsLogged: topStatsMap["Agents Logged In"] || 0,
    agentsInCalls: topStatsMap["Agents In Calls"] || 0,
    agentsWaiting: topStatsMap["Agents Waiting"] || 0,
    pausedAgents: topStatsMap["Paused Agents"] || 0,
    agentsInDeadCalls: topStatsMap["Agents In Dead Calls"] || 0,
    agentsInDispo: topStatsMap["Agents In Dispo"] || 0,
    droppedPercent: toFloat(summaryMap["Dropped Percent"], 0),
    avgWait: toFloat(summaryMap["Agent Avg Wait"], 0),
    avgCustTime: toFloat(summaryMap["Avg CustTime"], 0),
    avgAgents: toFloat(summaryMap["Avg Agents"], 0),
    answerRate: (() => {
      const answerRow = (data.carrierStats || []).find((row) => row[0] === "ANSWER");
      return answerRow ? toFloat(answerRow[12] || answerRow[10] || 0, 0) : 0;
    })(),
    busyRate: (() => {
      const busyRow = (data.carrierStats || []).find((row) => row[0] === "BUSY");
      return busyRow ? toFloat(busyRow[12] || busyRow[10] || 0, 0) : 0;
    })(),
  };

  snapshotHistory.push(snapshot);
  if (snapshotHistory.length > MAX_HISTORY_POINTS) {
    snapshotHistory.splice(0, snapshotHistory.length - MAX_HISTORY_POINTS);
  }
}

function aggregateHistory(mode, startDate, endDate, history = snapshotHistory) {
  const buckets = new Map();

  for (const item of history) {
    const date = new Date(item.capturedAt);
    if (date < startDate || date > endDate) continue;

    const key = getBucketKey(date, mode);
    if (!buckets.has(key)) {
      buckets.set(key, {
        label: key,
        totalCalls: [],
        callsRinging: [],
        agentsLogged: [],
        agentsInCalls: [],
        agentsWaiting: [],
        pausedAgents: [],
        agentsInDispo: [],
        droppedPercent: [],
        avgWait: [],
        avgCustTime: [],
        answerRate: [],
        busyRate: [],
      });
    }

    const bucket = buckets.get(key);
    bucket.totalCalls.push(item.activeCalls);
    bucket.callsRinging.push(item.callsRinging);
    bucket.agentsLogged.push(item.agentsLogged);
    bucket.agentsInCalls.push(item.agentsInCalls);
    bucket.agentsWaiting.push(item.agentsWaiting);
    bucket.pausedAgents.push(item.pausedAgents);
    bucket.agentsInDispo.push(item.agentsInDispo);
    bucket.droppedPercent.push(item.droppedPercent);
    bucket.avgWait.push(item.avgWait);
    bucket.avgCustTime.push(item.avgCustTime);
    bucket.answerRate.push(item.answerRate);
    bucket.busyRate.push(item.busyRate);
  }

  return [...buckets.values()].map((bucket) => ({
    label: bucket.label,
    totalCalls: Math.round(average(bucket.totalCalls)),
    callsRinging: Math.round(average(bucket.callsRinging)),
    agentsLogged: Math.round(average(bucket.agentsLogged)),
    agentsInCalls: Math.round(average(bucket.agentsInCalls)),
    agentsWaiting: Math.round(average(bucket.agentsWaiting)),
    pausedAgents: Math.round(average(bucket.pausedAgents)),
    agentsInDispo: Math.round(average(bucket.agentsInDispo)),
    droppedPercent: Number(average(bucket.droppedPercent).toFixed(2)),
    avgWait: Number(average(bucket.avgWait).toFixed(2)),
    avgCustTime: Number(average(bucket.avgCustTime).toFixed(2)),
    answerRate: Number(average(bucket.answerRate).toFixed(2)),
    busyRate: Number(average(bucket.busyRate).toFixed(2)),
  }));
}

function getRealtimePauseHistory(mode, startDate, endDate, normalizePause) {
  const buckets = new Map();

  for (const snapshot of snapshotHistory) {
    const date = new Date(snapshot.capturedAt);
    if (date < startDate || date > endDate) continue;

    const key = getBucketKey(date, mode);

    if (!buckets.has(key)) {
      buckets.set(key, {
        label: key,
        brief: 0,
        dejeuner: 0,
        toilette: 0,
      });
    }

    const bucket = buckets.get(key);

    const normalized = normalizePause(snapshot.pauseCode || snapshot.pauseLabel || "");
    if (!normalized) continue;

    bucket[normalized] += 1;
  }

  return [...buckets.values()];
}

function absolutizeVicidialAssetPaths(html) {
  return html.replace(
    /(src|href)=["'](images\/[^"']+)["']/gi,
    (_, attr, path) => `${attr}="${VICIDIAL_BASE_URL}/${path}"`
  );
}

const USER_STATS_TABLES = [
  { key: "talk_time_status", bucket: "overview", title: "Agent Talk Time and Status:" },
  { key: "login_logout", bucket: "overview", title: "Agent Login and Logout Time:" },
  { key: "web_logins", bucket: "overview", title: "Agent Webserver and URL Logins:" },
  { key: "timeclock", bucket: "overview", title: "Timeclock Login and Logout Time:" },
  { key: "closer_ingroup", bucket: "overview", title: "Closer In-Group Selection Logs:" },

  { key: "outbound_calls", bucket: "calls", title: "Outbound Calls for this Time Period:" },
  { key: "outbound_emails", bucket: "calls", title: "Outbound Emails for this Time Period:" },
  { key: "inbound_closer_calls", bucket: "calls", title: "Inbound Closer Calls for this Time Period:" },
  { key: "manual_outbound_calls", bucket: "calls", title: "Manual Outbound Calls for this Time Period:" },

  { key: "agent_activity", bucket: "activity", title: "Agent Activity for this time period:" },
  { key: "manager_pause_approvals", bucket: "activity", title: "Manager Pause Code Approvals for this Time Period:" },

  { key: "recordings", bucket: "recordings", title: "Recordings for this Time Period:" },

  { key: "lead_searches", bucket: "leads", title: "Lead Searches for this Time Period:" },
  { key: "preview_lead_skips", bucket: "leads", title: "Preview Lead Skips for this Time Period:" },
  { key: "agent_lead_switches", bucket: "leads", title: "Agent Lead Switches for this Time Period:" },
];

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTableCell(value = "") {
  return cleanText(String(value || "")).replace(/\s+/g, " ").trim();
}

function parseUserStatsTable(htmlFragment) {
  const $ = cheerio.load(`<table>${htmlFragment}</table>`);
  const rows = [];

  $("tr").each((_, tr) => {
    const cells = [];
    $(tr)
      .find("td,th")
      .each((__, cell) => {
        cells.push(normalizeTableCell($(cell).text()));
      });

    if (cells.some((cell) => cell !== "")) {
      rows.push(cells);
    }
  });

  if (!rows.length) {
    return { columns: [], rows: [], rowCount: 0 };
  }

  const [columns, ...body] = rows;

  return {
    columns,
    rows: body,
    rowCount: body.length,
  };
}

function parseUserStatsHtml(html, context = {}) {
  const htmlWithAssets = absolutizeVicidialAssetPaths(html);

  const meta = {
    user: context.user || "",
    beginDate:
      htmlWithAssets.match(/name=begin_date value="([^"]+)"/i)?.[1] || context.beginDate || "",
    endDate:
      htmlWithAssets.match(/name=end_date value="([^"]+)"/i)?.[1] || context.endDate || "",
    callStatus:
      htmlWithAssets.match(/name=call_status[^>]*value="([^"]*)"/i)?.[1] || context.callStatus || "",
    searchArchived:
      /name=['"]search_archived_data['"][^>]*checked/i.test(htmlWithAssets) ||
      Boolean(context.searchArchived),
    fetchedAt: new Date().toISOString(),
  };

  const sections = {
    overview: [],
    calls: [],
    activity: [],
    recordings: [],
    leads: [],
  };

  for (const def of USER_STATS_TABLES) {
    const blockRegex = new RegExp(
      `${escapeRegExp(def.title)}[\\s\\S]*?<TABLE[^>]*>([\\s\\S]*?)<\\/TABLE>`,
      "i"
    );

    const match = htmlWithAssets.match(blockRegex);
    if (!match) continue;

    const downloadMatch = match[0].match(/href=['"]([^'"]*file_download=\d+)['"]/i);
    const parsed = parseUserStatsTable(match[1]);

    sections[def.bucket].push({
      key: def.key,
      title: def.title.replace(/:$/, ""),
      downloadUrl: downloadMatch
        ? new URL(downloadMatch[1], `${VICIDIAL_BASE_URL}/`).toString()
        : null,
      ...parsed,
    });
  }

  return { meta, sections };
}

function normalizeHeaderKey(label = "") {
  return String(label || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function sectionRowsToObjects(section) {
  const columns = (section?.columns || []).map((column, index) => {
    return normalizeHeaderKey(column) || `col_${index}`;
  });

  return (section?.rows || []).map((row) => {
    const record = {};
    columns.forEach((column, index) => {
      record[column] = String(row[index] ?? "").trim();
    });
    return record;
  });
}

function pickUserStatsSection(sections, bucket, key) {
  return (sections?.[bucket] || []).find((section) => section.key === key) || null;
}

function formatSecondsToHms(totalSeconds = 0) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function extractHourBucket(rawValue = "") {
  const match = String(rawValue).match(/\b(\d{2}):\d{2}(?::\d{2})?\b/);
  return match ? `${match[1]}:00` : null;
}

function extractTimeLabel(rawValue = "") {
  const match = String(rawValue).match(/\b(\d{2}:\d{2})(?::\d{2})?\b/);
  return match ? match[1] : String(rawValue || "").trim();
}

function buildCountSeries(records, key, { exclude = ["", "-"] } = {}) {
  const map = new Map();

  for (const record of records || []) {
    const label = String(record[key] ?? "").trim();
    if (!label || exclude.includes(label)) continue;
    map.set(label, (map.get(label) || 0) + 1);
  }

  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function buildHourlySeries(records, dateKey, valueKey = null) {
  const map = new Map();

  for (const record of records || []) {
    const bucket = extractHourBucket(record[dateKey]);
    if (!bucket) continue;

    const current = map.get(bucket) || { label: bucket, value: 0 };
    current.value += valueKey ? toInt(record[valueKey], 0) : 1;
    map.set(bucket, current);
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildDurationHistogram(records, fieldKey) {
  const bins = [
    { label: "0-10s", min: 0, max: 10, value: 0 },
    { label: "11-30s", min: 11, max: 30, value: 0 },
    { label: "31-60s", min: 31, max: 60, value: 0 },
    { label: "61-180s", min: 61, max: 180, value: 0 },
    { label: "180s+", min: 181, max: Number.POSITIVE_INFINITY, value: 0 },
  ];

  for (const record of records || []) {
    const seconds = toInt(record[fieldKey], 0);
    const bucket = bins.find((item) => seconds >= item.min && seconds <= item.max);
    if (bucket) bucket.value += 1;
  }

  return bins.map(({ label, value }) => ({ label, value }));
}

function sumField(records, key) {
  return (records || []).reduce((sum, record) => sum + toInt(record[key], 0), 0);
}

function buildOverviewGraphSections(sections) {
  const graphs = [];

  const talkSection = pickUserStatsSection(sections, "overview", "talk_time_status");
  if (talkSection) {
    const rows = sectionRowsToObjects(talkSection);
    const statusRows = rows.filter(
      (row) => String(row.status || "").trim() && String(row.status || "").toUpperCase() !== "TOTAL_CALLS"
    );
    const totalRow = rows.find(
      (row) => String(row.status || "").toUpperCase() === "TOTAL_CALLS"
    );

    graphs.push({
      key: "overview_talk_time_status_graph",
      title: "Agent Talk Time and Status - Graph",
      subtitle: "Répartition des statuts et durée cumulée par statut.",
      downloadUrl: talkSection.downloadUrl,
      cards: [
        { label: "Total calls", value: totalRow?.count || "0" },
        { label: "Temps cumulé", value: totalRow?.hours_mm_ss || "00:00:00" },
        { label: "Statuts distincts", value: String(statusRows.length) },
      ],
      charts: [
        {
          type: "pie",
          title: "Répartition par volume",
          data: statusRows.map((row) => ({
            label: row.status,
            value: toInt(row.count, 0),
          })),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Durée par statut",
          data: statusRows.map((row) => ({
            label: row.status,
            seconds: toSeconds(row.hours_mm_ss),
          })),
          series: [{ key: "seconds", label: "Durée" }],
          nameKey: "label",
          valueFormat: "duration",
        },
      ],
    });
  }

  const loginSection = pickUserStatsSection(sections, "overview", "login_logout");
  if (loginSection) {
    const rows = sectionRowsToObjects(loginSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date || "")
    );

    graphs.push({
      key: "overview_login_logout_graph",
      title: "Agent Login and Logout Time - Graph",
      subtitle: "Vue synthétique des événements de connexion et des campagnes touchées.",
      downloadUrl: loginSection.downloadUrl,
      cards: [
        { label: "Événements", value: String(rows.length) },
        {
          label: "Première connexion",
          value: rows[0]?.date || "-",
        },
        {
          label: "Campagnes distinctes",
          value: String(new Set(rows.map((row) => row.campaign).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Événements par type",
          data: buildCountSeries(rows, "event"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Occurrences par campagne",
          data: buildCountSeries(rows, "campaign"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const webLoginsSection = pickUserStatsSection(sections, "overview", "web_logins");
  if (webLoginsSection) {
    const rows = sectionRowsToObjects(webLoginsSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date || "")
    );

    graphs.push({
      key: "overview_web_logins_graph",
      title: "Agent Webserver and URL Logins - Graph",
      subtitle: "Origine web et serveurs utilisés sur la plage sélectionnée.",
      downloadUrl: webLoginsSection.downloadUrl,
      cards: [
        { label: "Web logins", value: String(rows.length) },
        {
          label: "Serveurs web distincts",
          value: String(new Set(rows.map((row) => row.web_server).filter(Boolean)).size),
        },
        {
          label: "Serveurs dialer distincts",
          value: String(new Set(rows.map((row) => row.dialer_server).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Connexions par web server",
          data: buildCountSeries(rows, "web_server"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Connexions par URL",
          data: buildCountSeries(rows, "login_url"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const timeclockSection = pickUserStatsSection(sections, "overview", "timeclock");
  if (timeclockSection) {
    const rows = sectionRowsToObjects(timeclockSection);
    const totalSeconds = rows.reduce((sum, row) => sum + toSeconds(row.hours_mm_ss), 0);

    graphs.push({
      key: "overview_timeclock_graph",
      title: "Timeclock Login and Logout Time - Graph",
      subtitle: "Lecture graphique du timeclock et du temps cumulé.",
      downloadUrl: timeclockSection.downloadUrl,
      cards: [
        { label: "Lignes", value: String(rows.length) },
        { label: "Temps cumulé", value: formatSecondsToHms(totalSeconds) },
      ],
      charts: [
        {
          type: "bar",
          title: "Occurrences par événement",
          data: buildCountSeries(rows, "event"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const closerSection = pickUserStatsSection(sections, "overview", "closer_ingroup");
  if (closerSection) {
    const rows = sectionRowsToObjects(closerSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    graphs.push({
      key: "overview_closer_ingroup_graph",
      title: "Closer In-Group Selection Logs - Graph",
      subtitle: "Répartition des sélections closer sur la période.",
      downloadUrl: closerSection.downloadUrl,
      cards: [
        { label: "Sélections", value: String(rows.length) },
        {
          label: "Campagnes distinctes",
          value: String(new Set(rows.map((row) => row.campaign).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Sélections par campagne",
          data: buildCountSeries(rows, "campaign"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Sélections par manager",
          data: buildCountSeries(rows, "manager"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  return graphs;
}

function buildCallsGraphSections(sections) {
  const graphs = [];

  const outboundSection = pickUserStatsSection(sections, "calls", "outbound_calls");
  if (outboundSection) {
    const rows = sectionRowsToObjects(outboundSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );
    const totalSeconds = sumField(rows, "length");

    graphs.push({
      key: "calls_outbound_graph",
      title: "Outbound Calls - Graph",
      subtitle: "Volume, statut et distribution de durée des appels sortants.",
      downloadUrl: outboundSection.downloadUrl,
      cards: [
        { label: "Appels sortants", value: String(rows.length) },
        { label: "Durée cumulée", value: formatSecondsToHms(totalSeconds) },
        {
          label: "Durée moyenne",
          value: rows.length ? `${Math.round(totalSeconds / rows.length)}s` : "0s",
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Volume par heure",
          data: buildHourlySeries(rows, "date_time"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "pie",
          title: "Répartition des statuts",
          data: buildCountSeries(rows, "status"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Distribution des durées",
          data: buildDurationHistogram(rows, "length"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const outboundEmailsSection = pickUserStatsSection(sections, "calls", "outbound_emails");
  if (outboundEmailsSection) {
    const rows = sectionRowsToObjects(outboundEmailsSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    graphs.push({
      key: "calls_outbound_emails_graph",
      title: "Outbound Emails - Graph",
      subtitle: "Lecture graphique des emails sortants enregistrés.",
      downloadUrl: outboundEmailsSection.downloadUrl,
      cards: [
        { label: "Emails sortants", value: String(rows.length) },
        {
          label: "Campagnes distinctes",
          value: String(new Set(rows.map((row) => row.campaign).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Emails par campagne",
          data: buildCountSeries(rows, "campaign"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Emails par destinataire",
          data: buildCountSeries(rows, "email_to"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const inboundCloserSection = pickUserStatsSection(sections, "calls", "inbound_closer_calls");
  if (inboundCloserSection) {
    const rows = sectionRowsToObjects(inboundCloserSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    graphs.push({
      key: "calls_inbound_closer_graph",
      title: "Inbound Closer Calls - Graph",
      subtitle: "Vue synthétique des appels closer entrants.",
      downloadUrl: inboundCloserSection.downloadUrl,
      cards: [
        { label: "Appels entrants", value: String(rows.length) },
        { label: "Wait cumulé", value: formatSecondsToHms(sumField(rows, "wait_s")) },
        { label: "Agent cumulé", value: formatSecondsToHms(sumField(rows, "agent_s")) },
      ],
      charts: [
        {
          type: "pie",
          title: "Statuts des appels entrants",
          data: buildCountSeries(rows, "status"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Volume par heure",
          data: buildHourlySeries(rows, "date_time"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const manualOutboundSection = pickUserStatsSection(sections, "calls", "manual_outbound_calls");
  if (manualOutboundSection) {
    const rows = sectionRowsToObjects(manualOutboundSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    graphs.push({
      key: "calls_manual_outbound_graph",
      title: "Manual Outbound Calls - Graph",
      subtitle: "Répartition des appels sortants manuels.",
      downloadUrl: manualOutboundSection.downloadUrl,
      cards: [
        { label: "Appels manuels", value: String(rows.length) },
        {
          label: "Call types distincts",
          value: String(new Set(rows.map((row) => row.call_type).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Appels par type",
          data: buildCountSeries(rows, "call_type"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Appels par serveur",
          data: buildCountSeries(rows, "server"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  return graphs;
}

function buildActivityGraphSections(sections) {
  const graphs = [];

  const activitySection = pickUserStatsSection(sections, "activity", "agent_activity");
  if (activitySection) {
    const rows = sectionRowsToObjects(activitySection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    const orderedRows = [...rows].sort((a, b) =>
      String(a.date_time || "").localeCompare(String(b.date_time || ""))
    );

    const timeline = orderedRows.map((row) => ({
      label: extractTimeLabel(row.date_time),
      talk: toInt(row.talk, 0),
      wait: toInt(row.wait, 0),
      pause: toInt(row.pause, 0),
      dispo: toInt(row.dispo, 0),
      customer: toInt(row.customer, 0),
    }));

    graphs.push({
      key: "activity_agent_activity_graph",
      title: "Agent Activity - Graph",
      subtitle: "Visualisation des temps talk, wait, pause, dispo et customer.",
      downloadUrl: activitySection.downloadUrl,
      cards: [
        { label: "Échantillons", value: String(rows.length) },
        { label: "Talk cumulé", value: formatSecondsToHms(sumField(rows, "talk")) },
        { label: "Wait cumulé", value: formatSecondsToHms(sumField(rows, "wait")) },
        { label: "Pause cumulée", value: formatSecondsToHms(sumField(rows, "pause")) },
      ],
      charts: [
        {
          type: "area",
          title: "Mix d'activité dans le temps",
          data: timeline,
          nameKey: "label",
          valueFormat: "integer",
          stacked: true,
          series: [
            { key: "talk", label: "Talk" },
            { key: "wait", label: "Wait" },
            { key: "pause", label: "Pause" },
            { key: "customer", label: "Customer" },
            { key: "dispo", label: "Dispo" },
          ],
        },
        {
          type: "pie",
          title: "Répartition des pause codes",
          data: buildCountSeries(rows, "pause_code"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "pie",
          title: "Répartition des statuts",
          data: buildCountSeries(rows, "status"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const managerPauseSection = pickUserStatsSection(
    sections,
    "activity",
    "manager_pause_approvals"
  );

  if (managerPauseSection) {
    const rows = sectionRowsToObjects(managerPauseSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    graphs.push({
      key: "activity_manager_pause_graph",
      title: "Manager Pause Code Approvals - Graph",
      subtitle: "Lecture graphique des validations de pause manager.",
      downloadUrl: managerPauseSection.downloadUrl,
      cards: [
        { label: "Validations", value: String(rows.length) },
        {
          label: "Agents concernés",
          value: String(new Set(rows.map((row) => row.agent).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Validations par pause code",
          data: buildCountSeries(rows, "pause_code"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Validations par agent",
          data: buildCountSeries(rows, "agent"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  return graphs;
}

function buildRecordingsGraphSections(sections) {
  const graphs = [];

  const recordingsSection = pickUserStatsSection(sections, "recordings", "recordings");
  if (recordingsSection) {
    const rows = sectionRowsToObjects(recordingsSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    const totalSeconds = sumField(rows, "seconds");

    graphs.push({
      key: "recordings_main_graph",
      title: "Recordings - Graph",
      subtitle: "Vue volumétrique et distribution des durées des enregistrements.",
      downloadUrl: recordingsSection.downloadUrl,
      cards: [
        { label: "Enregistrements", value: String(rows.length) },
        { label: "Durée cumulée", value: formatSecondsToHms(totalSeconds) },
        {
          label: "Durée moyenne",
          value: rows.length ? `${Math.round(totalSeconds / rows.length)}s` : "0s",
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Enregistrements par heure",
          data: buildHourlySeries(rows, "date_time"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Distribution des durées",
          data: buildDurationHistogram(rows, "seconds"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Enregistrements par lead",
          data: buildCountSeries(rows, "lead").slice(0, 10),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  return graphs;
}

function buildLeadsGraphSections(sections) {
  const graphs = [];

  const searchesSection = pickUserStatsSection(sections, "leads", "lead_searches");
  if (searchesSection) {
    const rows = sectionRowsToObjects(searchesSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    graphs.push({
      key: "leads_searches_graph",
      title: "Lead Searches - Graph",
      subtitle: "Visualisation des recherches de leads et types utilisés.",
      downloadUrl: searchesSection.downloadUrl,
      cards: [
        { label: "Recherches", value: String(rows.length) },
        {
          label: "Types distincts",
          value: String(new Set(rows.map((row) => row.type).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Recherches par type",
          data: buildCountSeries(rows, "type"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Recherches par heure",
          data: buildHourlySeries(rows, "date_time"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const previewSection = pickUserStatsSection(sections, "leads", "preview_lead_skips");
  if (previewSection) {
    const rows = sectionRowsToObjects(previewSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    graphs.push({
      key: "leads_preview_skips_graph",
      title: "Preview Lead Skips - Graph",
      subtitle: "Répartition des sauts de leads en preview.",
      downloadUrl: previewSection.downloadUrl,
      cards: [
        { label: "Skips", value: String(rows.length) },
        {
          label: "Campagnes distinctes",
          value: String(new Set(rows.map((row) => row.campaign).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Skips par campagne",
          data: buildCountSeries(rows, "campaign"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Skips par statut",
          data: buildCountSeries(rows, "status"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  const switchesSection = pickUserStatsSection(sections, "leads", "agent_lead_switches");
  if (switchesSection) {
    const rows = sectionRowsToObjects(switchesSection).filter((row) =>
      /^\d{4}-\d{2}-\d{2}/.test(row.date_time || "")
    );

    graphs.push({
      key: "leads_switches_graph",
      title: "Agent Lead Switches - Graph",
      subtitle: "Vue synthétique des bascules de leads.",
      downloadUrl: switchesSection.downloadUrl,
      cards: [
        { label: "Lead switches", value: String(rows.length) },
        {
          label: "Campagnes distinctes",
          value: String(new Set(rows.map((row) => row.campaign).filter(Boolean)).size),
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Switches par campagne",
          data: buildCountSeries(rows, "campaign"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
        {
          type: "bar",
          title: "Switches par heure",
          data: buildHourlySeries(rows, "date_time"),
          dataKey: "value",
          nameKey: "label",
          valueFormat: "integer",
        },
      ],
    });
  }

  return graphs;
}

function buildUserStatsGraphs(sections) {
  return {
    overview: buildOverviewGraphSections(sections),
    calls: buildCallsGraphSections(sections),
    activity: buildActivityGraphSections(sections),
    recordings: buildRecordingsGraphSections(sections),
    leads: buildLeadsGraphSections(sections),
  };
}

async function fetchVicidialUserStatsHtml({
  user,
  beginDate,
  endDate,
  callStatus = "",
  searchArchived = false,
}) {
  if (!VICIDIAL_BASE_URL || !VICIDIAL_USERNAME || !VICIDIAL_PASSWORD) {
    throw new Error("Missing VICIDIAL_BASE_URL, VICIDIAL_USERNAME, or VICIDIAL_PASSWORD in .env");
  }

  const url = `${VICIDIAL_BASE_URL}/user_stats.php`;

  const response = await axios.get(url, {
    timeout: 30000,
    responseType: "text",
    headers: {
      "User-Agent": "Mozilla/5.0 Activity-Display-Backend",
      Accept: "text/html, */*; q=0.01",
      Referer: `${VICIDIAL_BASE_URL}/user_stats.php?user=${encodeURIComponent(user)}`,
    },
    params: {
      DB: "0",
      pause_code_rpt: "",
      park_rpt: "",
      did_id: "",
      did: "",
      begin_date: beginDate,
      end_date: endDate,
      user,
      call_status: callStatus,
      search_archived_data: searchArchived ? "checked" : "",
      NVAuser: "",
      submit: "submit",
    },
    auth: {
      username: VICIDIAL_USERNAME,
      password: VICIDIAL_PASSWORD,
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}: ${String(response.data).slice(0, 800)}`);
  }

  if (typeof response.data !== "string" || !response.data.trim()) {
    throw new Error("Empty HTML response from user_stats.php");
  }

  return response.data;
}

async function fetchVicidialHtml() {
  if (!VICIDIAL_BASE_URL || !VICIDIAL_USERNAME || !VICIDIAL_PASSWORD) {
    throw new Error("Missing VICIDIAL_BASE_URL, VICIDIAL_USERNAME, or VICIDIAL_PASSWORD in .env");
  }

  const url = `${VICIDIAL_BASE_URL}/AST_timeonVDADall.php`;

  const headers = {
    "User-Agent": "Mozilla/5.0 Activity-Display-Backend",
    "Accept": "text/html, */*; q=0.01",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Referer": `${VICIDIAL_BASE_URL}/realtime_report.php?report_display_type=HTML`,
    "Origin": VICIDIAL_BASE_URL.replace(/\/vicidial$/, ""),
    "X-Requested-With": "XMLHttpRequest",
  };

  const params = new URLSearchParams();
  params.append("RTajax", "1");
  params.append("DB", "0");
  params.append("groups[]", "ALL-ACTIVE");
  params.append("user_group_filter[]", "ALL-GROUPS");
  params.append("ingroup_filter[]", "ALL-INGROUPS");
  params.append("adastats", "1");
  params.append("SIPmonitorLINK", "");
  params.append("IAXmonitorLINK", "");
  params.append("usergroup", "");
  params.append("UGdisplay", "0");
  params.append("UidORname", "1");
  params.append("orderby", "timeup");
  params.append("SERVdisplay", "0");
  params.append("CALLSdisplay", "1");
  params.append("PHONEdisplay", "0");
  params.append("MONITORdisplay", "0");
  params.append("CUSTPHONEdisplay", "0");
  params.append("CUSTINFOdisplay", "0");
  params.append("with_inbound", "Y");
  params.append("monitor_active", "");
  params.append("monitor_phone", "");
  params.append("ALLINGROUPstats", "");
  params.append("DROPINGROUPstats", "");
  params.append("NOLEADSalert", "");
  params.append("ShowCustPhoneCode", "1");
  params.append("CARRIERstats", "1");
  params.append("PRESETstats", "1");
  params.append("AGENTtimeSTATS", "1");
  params.append("AGENTlatency", "1");
  params.append("parkSTATS", "1");
  params.append("SLAinSTATS", "1");
  params.append("INGROUPcolorOVERRIDE", "");
  params.append("droppedOFtotal", "1");
  params.append("report_display_type", "HTML");
  params.append("user", VICIDIAL_USERNAME);
  params.append("pass", VICIDIAL_PASSWORD);

  try {
    const response = await axios.post(url, params.toString(), {
      timeout: 30000,
      responseType: "text",
      headers,
      auth: {
        username: VICIDIAL_USERNAME,
        password: VICIDIAL_PASSWORD,
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${String(response.data).slice(0, 800)}`);
    }

    if (typeof response.data !== "string" || !response.data.trim()) {
      throw new Error("Empty HTML response from AST_timeonVDADall.php");
    }

    return response.data;
  } catch (error) {
    throw new Error(`Upstream AST_timeonVDADall fetch failed: ${error.message}`);
  }
}

/*async function initDatabase() {
  dbPool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  });

  await dbPool.query("SELECT 1");
}

async function logCollectorEvent(eventType, message) {
  if (!dbPool) return;
  await dbPool.execute(
    `INSERT INTO collector_events (event_time, event_type, message)
     VALUES (NOW(), ?, ?)`,
    [eventType, message || null]
  );
}

function snapshotToDbRow(data, captureReason = "interval") {
  const topStatsMap = extractTopStatsMap(data);
  const summaryMap = extractSummaryMap(data);
  const systemLoad = data.systemLoad || { load1: null, load5: null, load15: null };

  const answerRow = (data.carrierStats || []).find((row) => row[0] === "ANSWER");
  const busyRow = (data.carrierStats || []).find((row) => row[0] === "BUSY");

  return {
    captureReason,
    activeCalls: topStatsMap["Current Active Calls"] || 0,
    callsRinging: topStatsMap["Calls Ringing"] || 0,
    callsWaiting: topStatsMap["Calls Waiting For Agents"] || 0,
    callsInIvr: topStatsMap["Calls In IVR"] || 0,
    chatsWaiting: topStatsMap["Chats Waiting For Agents"] || 0,
    callbackQueueCalls: topStatsMap["Callback Queue Calls"] || 0,
    agentsLogged: topStatsMap["Agents Logged In"] || 0,
    agentsInCalls: topStatsMap["Agents In Calls"] || 0,
    agentsWaiting: topStatsMap["Agents Waiting"] || 0,
    pausedAgents: topStatsMap["Paused Agents"] || 0,
    agentsInDeadCalls: topStatsMap["Agents In Dead Calls"] || 0,
    agentsInDispo: topStatsMap["Agents In Dispo"] || 0,
    droppedPercent: toFloat(summaryMap["Dropped Percent"], 0),
    avgAgents: toFloat(summaryMap["Avg Agents"], 0),
    avgWait: toFloat(summaryMap["Agent Avg Wait"], 0),
    avgCustTime: toFloat(summaryMap["Avg CustTime"], 0),
    answerRate: answerRow ? toFloat(answerRow[12] || answerRow[10] || 0, 0) : 0,
    busyRate: busyRow ? toFloat(busyRow[12] || busyRow[10] || 0, 0) : 0,
    systemLoad1: systemLoad.load1,
    systemLoad5: systemLoad.load5,
    systemLoad15: systemLoad.load15,
  };
}

async function persistSnapshotToDb(data, captureReason = "interval") {
  if (!dbPool) return;

  const row = snapshotToDbRow(data, captureReason);
  const connection = await dbPool.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO metric_snapshots (
        captured_at, capture_reason,
        active_calls, calls_ringing, calls_waiting, calls_in_ivr, chats_waiting, callback_queue_calls,
        agents_logged, agents_in_calls, agents_waiting, paused_agents, agents_in_dead_calls, agents_in_dispo,
        dropped_percent, avg_agents, avg_wait, avg_cust_time, answer_rate, busy_rate,
        system_load_1, system_load_5, system_load_15
      ) VALUES (
        NOW(), ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )`,
      [
        row.captureReason,
        row.activeCalls, row.callsRinging, row.callsWaiting, row.callsInIvr, row.chatsWaiting, row.callbackQueueCalls,
        row.agentsLogged, row.agentsInCalls, row.agentsWaiting, row.pausedAgents, row.agentsInDeadCalls, row.agentsInDispo,
        row.droppedPercent, row.avgAgents, row.avgWait, row.avgCustTime, row.answerRate, row.busyRate,
        row.systemLoad1, row.systemLoad5, row.systemLoad15,
      ]
    );

    const snapshotId = result.insertId;

    for (const agent of data.agentRows || []) {
      await connection.execute(
        `INSERT INTO agent_snapshots (
          snapshot_id, station, agent_user, show_id, session_id, status, pause_code,
          login_label, login_seconds, campaign, calls, inbound_calls, latency_label,
          latency_ms, hold_label, in_group_name, color_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotId,
          agent.station || null,
          agent.user || null,
          agent.showId || null,
          agent.sessionId || null,
          agent.status || null,
          agent.pause || null,
          agent.mmss || null,
          toSeconds(agent.mmss),
          agent.campaign || null,
          toInt(agent.calls),
          toInt(agent.inbound),
          agent.latency || null,
          latencyToMs(agent.latency),
          agent.hold || null,
          agent.inGroup || null,
          agent.color || null,
        ]
      );
    }

    for (const rowCarrier of data.carrierStats || []) {
      await connection.execute(
        `INSERT INTO carrier_snapshots (
          snapshot_id, hangup_status,
          v_24h, p_24h, v_6h, p_6h, v_1h, p_1h, v_15m, p_15m, v_5m, p_5m, v_1m, p_1m
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotId,
          rowCarrier[0] || "",
          toInt(rowCarrier[1]), rowCarrier[2] || null,
          toInt(rowCarrier[3]), rowCarrier[4] || null,
          toInt(rowCarrier[5]), rowCarrier[6] || null,
          toInt(rowCarrier[7]), rowCarrier[8] || null,
          toInt(rowCarrier[9]), rowCarrier[10] || null,
          toInt(rowCarrier[11]), rowCarrier[12] || null,
        ]
      );
    }

    await connection.commit();
    return snapshotId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getRecordedHistory(mode, startDate, endDate) {
  const [rows] = await dbPool.execute(
    `SELECT
      captured_at,
      active_calls,
      calls_ringing,
      agents_logged,
      agents_in_calls,
      agents_waiting,
      paused_agents,
      agents_in_dispo,
      dropped_percent,
      avg_wait,
      avg_cust_time,
      answer_rate,
      busy_rate
    FROM metric_snapshots
    WHERE captured_at BETWEEN ? AND ?
    ORDER BY captured_at ASC`,
    [
      startDate.toISOString().slice(0, 19).replace("T", " "),
      endDate.toISOString().slice(0, 19).replace("T", " "),
    ]
  );

  const history = rows.map((row) => ({
    capturedAt: row.captured_at,
    activeCalls: toInt(row.active_calls),
    callsRinging: toInt(row.calls_ringing),
    agentsLogged: toInt(row.agents_logged),
    agentsInCalls: toInt(row.agents_in_calls),
    agentsWaiting: toInt(row.agents_waiting),
    pausedAgents: toInt(row.paused_agents),
    agentsInDispo: toInt(row.agents_in_dispo),
    droppedPercent: toFloat(row.dropped_percent),
    avgWait: toFloat(row.avg_wait),
    avgCustTime: toFloat(row.avg_cust_time),
    answerRate: toFloat(row.answer_rate),
    busyRate: toFloat(row.busy_rate),
  }));

  return aggregateHistory(mode, startDate, endDate, history);
}*/

async function collectAndPersistSnapshot(captureReason = "interval") {
  const html = await fetchVicidialHtml();
  const data = buildResponseFromHtml(html);

  recordSnapshot(data);
  await persistSnapshotToDb(data, captureReason);

  return data;
}

async function startCollector() {
  await logCollectorEvent("startup", "Activity Display collector started");
  collectorTimer = setInterval(async () => {
    try {
      await collectAndPersistSnapshot("interval");
    } catch (error) {
      console.error("Collector interval failed:", error.message);
      try {
        await logCollectorEvent("error", error.message);
      } catch {}
    }
  }, RECORD_SNAPSHOT_INTERVAL_MS);
}

async function shutdown(signal) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  console.log(`Received ${signal}, shutting down...`);
  if (collectorTimer) clearInterval(collectorTimer);

  try {
    await collectAndPersistSnapshot("shutdown");
    await logCollectorEvent("shutdown", `Graceful shutdown with ${signal}`);
  } catch (error) {
    console.error("Shutdown checkpoint failed:", error.message);
    try {
      await logCollectorEvent("error", `Shutdown checkpoint failed: ${error.message}`);
    } catch {}
  }

  /*try {
    if (dbPool) await dbPool.end();
  } catch {}*/

  try {
    await closeDatabase();
  } catch {}

  process.exit(0);
}

app.get("/api/activity-display", async (_req, res) => {
  try {
    const html = await fetchVicidialHtml();
    const data = buildResponseFromHtml(html);

    recordSnapshot(data);

    res.set("Cache-Control", "no-store");
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch or parse VICIdial report",
      details: error.message,
    });
  }
});

app.get("/api/activity-display/history", async (_req, res) => {
  try {
    const mode = ["Sec", "Min", "HH", "DD", "W", "MM", "YYYY"].includes(_req.query.mode)
      ? _req.query.mode
      : "Min";

    const source = _req.query.source === "record" ? "record" : "realtime";
    const endDate = toDateSafe(_req.query.end) || new Date();
    const startDate =
      toDateSafe(_req.query.start) ||
      new Date(endDate.getTime() - 60 * 60 * 1000);

    const series =
      source === "record"
        ? await getRecordedHistory(mode, startDate, endDate)
        : aggregateHistory(mode, startDate, endDate);

    res.set("Cache-Control", "no-store");
    res.json({
      mode,
      source,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      points: series,
      availableSnapshots: source === "record" ? null : snapshotHistory.length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to build history",
      details: error.message,
    });
  }
});

app.get("/api/activity-display/agent-analytics", async (_req, res) => {
  try {
    const endDate = toDateSafe(_req.query.end) || new Date();
    const startDate =
      toDateSafe(_req.query.start) ||
      new Date(endDate.getTime() - 60 * 60 * 1000);

    const payload = await getRecordedAgentAnalytics(startDate, endDate);

    res.set("Cache-Control", "no-store");
    res.json({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      ...payload,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to build agent analytics",
      details: error.message,
    });
  }
});


app.get("/api/activity-display/agent-calls-at-time", async (req, res) => {
  try {
    const mode = req.query.mode === "manual" ? "manual" : "realtime";

    if (mode === "realtime") {
      const html = await fetchVicidialHtml();
      const payload = buildResponseFromHtml(html);

      const agents = (payload.agentRows || [])
        .map((row) => {
          const status = String(row.status || "").trim().toUpperCase();
          return {
            agentUser: row.user || "(sans agent)",
            activeCalls: status === "INCALL" ? 1 : 0,
            status,
          };
        })
        .sort((a, b) => a.agentUser.localeCompare(b.agentUser));

      return res.json({
        mode: "realtime",
        capturedAt: payload.updatedAt || new Date().toISOString(),
        agents,
      });
    }

    const targetDate = toDateSafe(req.query.at) || new Date();
    const result = await getRecordedAgentCallsAtHour(targetDate);

    return res.json({
      mode: "manual",
      capturedAt: result.capturedAt,
      hourStart: result.hourStart,
      hourEnd: result.hourEnd,
      agents: result.agents || [],
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to build agent calls at time",
      details: error.message,
    });
  }
});


app.get("/api/activity-display/raw", async (_req, res) => {
  try {
    const html = await fetchVicidialHtml();
    const htmlWithAssets = absolutizeVicidialAssetPaths(html);

    res.set("Cache-Control", "no-store");
    res.type("text/html").send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="refresh" content="1" />
          <title>Activity Display Raw</title>
          <style>
            body { margin: 0; }
          </style>
        </head>
        <body>
          ${htmlWithAssets}
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get("/api/activity-display/rdv-analytics", async (req, res) => {
  try {
    const mode = ["Sec", "Min", "HH", "DD", "W", "MM", "YYYY"].includes(req.query.mode)
      ? req.query.mode
      : "DD";

    const endDate = toDateSafe(req.query.end) || new Date("2100-01-01T00:00:00");
    const startDate = toDateSafe(req.query.start) || new Date("2000-01-01T00:00:00");

    const allRows = loadRdvRows();

    const filteredRows = allRows.filter((row) => {
      if (!row.dateRdv) return false;
      return row.dateRdv >= startDate && row.dateRdv <= endDate;
    });

    const rows = filteredRows.length ? filteredRows : allRows;
    const withParsedDate = rows.filter((row) => row.dateRdv);

    res.set("Cache-Control", "no-store");
    res.json({
      cards: [
        { key: "total", label: "Total RDV", value: rows.length },
        { key: "dates_ok", label: "RDV datés", value: withParsedDate.length },
        {
          key: "telepros",
          label: "Télépros actives",
          value: new Set(rows.map((r) => r.telepro).filter(Boolean)).size,
        },
        {
          key: "produits",
          label: "Produits concernés",
          value: new Set(rows.map((r) => r.produit).filter(Boolean)).size,
        },
      ],
      timeline: aggregateRdvTimeline(withParsedDate, mode),
      byTelepro: aggregateSimpleCount(rows, "telepro", 10),
      byProduct: aggregateSimpleCount(rows, "produit", 10),
      byHeating: aggregateSimpleCount(rows, "modeChauffage", 10),
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to build RDV analytics",
      details: error.message,
    });
  }
});

app.get("/api/activity-display/user-stats", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const user = String(req.query.user || "8105").trim();
    const beginDate = String(req.query.beginDate || today).trim();
    const endDate = String(req.query.endDate || beginDate).trim();
    const callStatus = String(req.query.callStatus || "").trim();

    const searchArchived = ["1", "true", "checked", "yes"].includes(
      String(req.query.searchArchived || "").trim().toLowerCase()
    );

    const html = await fetchVicidialUserStatsHtml({
      user,
      beginDate,
      endDate,
      callStatus,
      searchArchived,
    });

    const parsed = parseUserStatsHtml(html, {
      user,
      beginDate,
      endDate,
      callStatus,
      searchArchived,
    });

    const payload = {
      ...parsed,
      graphs: buildUserStatsGraphs(parsed.sections),
    };

    res.set("Cache-Control", "no-store");
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: "Failed to build user stats",
      details: error.message,
    });
  }
});

app.get("/api/activity-display/pause-history", async (req, res) => {
  try {
    const mode = ["Sec", "Min", "HH", "DD", "W", "MM", "YYYY"].includes(req.query.mode)
      ? req.query.mode
      : "Min";

    const source = req.query.source === "record" ? "record" : "realtime";
    const endDate = toDateSafe(req.query.end) || new Date();
    const startDate = toDateSafe(req.query.start) || new Date(endDate.getTime() - 60 * 60 * 1000);

    const normalizePause = (value = "") => {
      const v = String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

      if (!v || v === "-" || v === "0") return null;

      if (
        v.includes("brief") ||
        v.includes("briefing") ||
        v === "brf" ||
        v.includes("reunion")
      ) {
        return "brief";
      }

      if (
        v.includes("dej") ||
        v.includes("dej.") ||
        v.includes("dejeuner") ||
        v.includes("lunch") ||
        v.includes("repas") ||
        v.includes("meal")
      ) {
        return "dejeuner";
      }

      if (
        v.includes("toilet") ||
        v.includes("wc") ||
        v.includes("bathroom") ||
        v.includes("restroom") ||
        v.includes("bio")
      ) {
        return "toilette";
      }

      return null;
    };

    let rows = [];

    if (source === "record") {
      rows = await getRecordedPauseHistory(mode, startDate, endDate, normalizePause);
    } else {
      rows = getRealtimePauseHistory(mode, startDate, endDate, normalizePause);
    }

    const points = Array.isArray(rows)
      ? rows
      : Array.isArray(rows?.points)
        ? rows.points
        : Object.values(rows || {});

    res.set("Cache-Control", "no-store");
    res.json({
      mode,
      source,
      start: startDate.toISOString(),
      end: startDate.toISOString(),
      points,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to build pause history",
      details: error.message,
    });
  }
});

async function bootstrap() {
  await initDatabase();
  await startCollector();

  app.listen(PORT, () => {
    console.log(`Activity Display backend running on http://localhost:${PORT}`);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

/*bootstrap().catch(async (error) => {
  console.error("Bootstrap failed:", error.message);
  try {
    if (dbPool) {
      await logCollectorEvent("error", `Bootstrap failed: ${error.message}`);
      await dbPool.end();
    }
  } catch {}
  process.exit(1);
});*/

bootstrap().catch(async (error) => {
  console.error("Bootstrap failed:", error.message);
  try {
    await logCollectorEvent("error", `Bootstrap failed: ${error.message}`);
  } catch {}
  try {
    await closeDatabase();
  } catch {}
  process.exit(1);
});