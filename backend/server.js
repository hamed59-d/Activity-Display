import https from "https";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const VICIDIAL_BASE_URL = (process.env.VICIDIAL_BASE_URL || "").replace(/\/+$/, "");
const VICIDIAL_USERNAME = process.env.VICIDIAL_USERNAME || "";
const VICIDIAL_PASSWORD = process.env.VICIDIAL_PASSWORD || "";

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

function extractByLabel(text, label, fallback = "") {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*:?\\s*([^\\n]+)`, "i");
  const match = text.match(re);
  return match ? match[1].trim() : fallback;
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
      ["Avg Pause", avgPause]
    ],
    quickKpis: [
      ["Parked Calls", parkedCalls],
      ["Avg Parktime/All", avgParktimeAll],
      ["SLA 1", sla1],
      ["SLA 2", sla2]
    ]
  };
}

function parseKpiCards($) {
  const definitions = [
    { label: "Current Active Calls", icon: "icon_calls.png", tone: "cyan" },
    { label: "Calls Ringing", icon: "icon_ringing.png", tone: "blue" },
    { label: "Calls Waiting For Agents", icon: "icon_callswaiting.png", tone: "rose" },
    { label: "Calls In IVR", icon: "icon_callsinivr.png", tone: "violet" },
    { label: "Chats Waiting For Agents", icon: "icon_chatswaiting.png", tone: "sky" },
    { label: "Callback Queue Calls", icon: "icon_callbackqueue.png", tone: "indigo" },
    { label: "Agents Logged In", icon: "icon_users.png", tone: "teal" },
    { label: "Agents In Calls", icon: "icon_agentsincalls.png", tone: "emerald" },
    { label: "Agents Waiting", icon: "icon_agentswaiting.png", tone: "lime" },
    { label: "Paused Agents", icon: "icon_agentspaused.png", tone: "amber" },
    { label: "Agents In Dead Calls", icon: "icon_agentsindeadcalls.png", tone: "zinc" },
    { label: "Agents In Dispo", icon: "icon_agentsindispo.png", tone: "yellow" },
  ];

  return definitions.map((def) => {
    const img = $(`img[src*="${def.icon}"]`).first();

    if (!img.length) {
      return {
        label: def.label,
        value: 0,
        tone: def.tone,
      };
    }

    const card = img.closest("td");
    const text = cleanText(card.text());

    // Try last standalone integer inside the tile
    const matches = [...text.matchAll(/\b\d+\b/g)];
    const value = matches.length ? parseInt(matches[matches.length - 1][0], 10) : 0;

    return {
      label: def.label,
      value: Number.isFinite(value) ? value : 0,
      tone: def.tone,
    };
  });
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
          "TOTALS"
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
        r[10] || ""
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
        color
      };
    });
  }

  return [];
}

function parseSystemLoad(rawText) {
  const match = cleanText(rawText).match(/System Load Average:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i);
  if (!match) return "";
  return `${match[1]} | ${match[2]} | ${match[3]}`;
}

function buildResponseFromHtml(html) {
  const $ = cheerio.load(html);
  const rawText = cleanText($("body").text());

  const { summaryLines, quickKpis } = parseTopSummary(rawText);
  const carrierStats = parseCarrierStats($);
  const agentRows = parseAgentRows($);
  const topStats = parseKpiCards($);
  const systemLoad = parseSystemLoad(rawText);

  const finalQuickKpis = [...quickKpis];
  if (systemLoad) {
    finalQuickKpis.unshift(["System Load Average", systemLoad]);
  }

  return {
    updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    topStats,
    summaryLines,
    carrierStats,
    agentRows,
    waitingCall: null,
    quickKpis: finalQuickKpis,
    historical: {
      daily: [],
      weekly: [],
      campaigns: []
    }
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

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function recordSnapshot(data) {
  const topStatsMap = Object.fromEntries((data.topStats || []).map((item) => [item.label, Number(item.value) || 0]));
  const summaryMap = Object.fromEntries(data.summaryLines || []);

  const answerRow = (data.carrierStats || []).find((row) => row[0] === "ANSWER");
  const busyRow = (data.carrierStats || []).find((row) => row[0] === "BUSY");

  const snapshot = {
    ts: new Date().toISOString(),
    activeCalls: topStatsMap["Current Active Calls"] || 0,
    callsRinging: topStatsMap["Calls Ringing"] || 0,
    agentsLogged: topStatsMap["Agents Logged In"] || 0,
    agentsInCalls: topStatsMap["Agents In Calls"] || 0,
    agentsWaiting: topStatsMap["Agents Waiting"] || 0,
    pausedAgents: topStatsMap["Paused Agents"] || 0,
    agentsInDispo: topStatsMap["Agents In Dispo"] || 0,
    droppedPercent: parseFloat(String(summaryMap["Dropped Percent"] || "0").replace("%", "")) || 0,
    avgWait: parseFloat(String(summaryMap["Agent Avg Wait"] || "0")) || 0,
    avgCustTime: parseFloat(String(summaryMap["Avg CustTime"] || "0")) || 0,
    answerRate: answerRow ? parseFloat(String(answerRow[2] || "0").replace("%", "")) || 0 : 0,
    busyRate: busyRow ? parseFloat(String(busyRow[2] || "0").replace("%", "")) || 0 : 0,
    agentRows: (data.agentRows || []).map((row) => ({
      user: row.user || "",
      calls: Number(row.calls) || 0,
      pause: row.pause || "-",
      mmss: row.mmss || "-",
      latency: parseInt(String(row.latency || "").replace("ms", ""), 10) || 0,
    })),
  };

  snapshotHistory.push(snapshot);

  if (snapshotHistory.length > MAX_HISTORY_POINTS) {
    snapshotHistory.splice(0, snapshotHistory.length - MAX_HISTORY_POINTS);
  }
}

function aggregateHistory(mode, startDate, endDate) {
  const filtered = snapshotHistory.filter((item) => {
    const ts = new Date(item.ts);
    return ts >= startDate && ts <= endDate;
  });

  const buckets = new Map();

  for (const item of filtered) {
    const ts = new Date(item.ts);
    const key = getBucketKey(ts, mode);

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
      details: error.message
    });
  }
});


app.get("/api/activity-display/history", (_req, res) => {
  try {
    const mode = ["Sec", "Min", "HH", "DD", "W", "MM", "YYYY"].includes(_req.query.mode)
      ? _req.query.mode
      : "Min";

    const endDate = toDateSafe(_req.query.end) || new Date();
    const startDate =
      toDateSafe(_req.query.start) ||
      new Date(endDate.getTime() - 60 * 60 * 1000);

    const series = aggregateHistory(mode, startDate, endDate);

    res.set("Cache-Control", "no-store");
    res.json({
      mode,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      points: series,
      availableSnapshots: snapshotHistory.length,
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



app.listen(PORT, () => {
  console.log(`Activity Display backend running on http://localhost:${PORT}`);
});