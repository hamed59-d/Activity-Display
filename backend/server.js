import https from "https";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import mysql from "mysql2/promise";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const VICIDIAL_BASE_URL = (process.env.VICIDIAL_BASE_URL || "").replace(/\/+$/, "");
const VICIDIAL_USERNAME = process.env.VICIDIAL_USERNAME || "";
const VICIDIAL_PASSWORD = process.env.VICIDIAL_PASSWORD || "";

const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "vicidial";
const RECORD_SNAPSHOT_INTERVAL_MS = Number(process.env.RECORD_SNAPSHOT_INTERVAL_MS || 60000);

let dbPool = null;
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

function absolutizeVicidialAssetPaths(html) {
  return html.replace(
    /(src|href)=["'](images\/[^"']+)["']/gi,
    (_, attr, path) => `${attr}="${VICIDIAL_BASE_URL}/${path}"`
  );
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

async function initDatabase() {
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
}

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

  try {
    if (dbPool) await dbPool.end();
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

async function bootstrap() {
  await initDatabase();
  await startCollector();

  app.listen(PORT, () => {
    console.log(`Activity Display backend running on http://localhost:${PORT}`);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

bootstrap().catch(async (error) => {
  console.error("Bootstrap failed:", error.message);
  try {
    if (dbPool) {
      await logCollectorEvent("error", `Bootstrap failed: ${error.message}`);
      await dbPool.end();
    }
  } catch {}
  process.exit(1);
});