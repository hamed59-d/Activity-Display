import https from "https";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import { saveSnapshot, getSnapshots } from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3001);
const VICIDIAL_BASE_URL = (process.env.VICIDIAL_BASE_URL || "").replace(/\/+$/, "");
const VICIDIAL_USERNAME = process.env.VICIDIAL_USERNAME || "";
const VICIDIAL_PASSWORD = process.env.VICIDIAL_PASSWORD || "";
const RECORD_SNAPSHOT_INTERVAL_MS = Number(process.env.RECORD_SNAPSHOT_INTERVAL_MS || 60000);

let latestDashboardData = null;
let collectorTimer = null;

function cleanText(value = "") {
  return String(value)
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

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + Number(v || 0), 0) / values.length;
}

function getBucketKey(date, mode) {
  const d = new Date(date);

  if (mode === "day") {
    return d.toISOString().slice(0, 13) + ":00";
  }

  if (mode === "week") {
    return d.toISOString().slice(0, 10);
  }

  if (mode === "month") {
    return d.toISOString().slice(0, 10);
  }

  if (mode === "year") {
    return d.toISOString().slice(0, 7);
  }

  return d.toISOString().slice(0, 13) + ":00";
}

function aggregateHistory(mode, startDate, endDate) {
  const filtered = getSnapshots(startDate.toISOString(), endDate.toISOString());
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

async function fetchVicidialHtml() {
  if (!VICIDIAL_BASE_URL) {
    throw new Error("VICIDIAL_BASE_URL is not configured");
  }

  const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  });

  const response = await axios.get(VICIDIAL_BASE_URL, {
    httpsAgent,
    auth: VICIDIAL_USERNAME || VICIDIAL_PASSWORD
      ? {
          username: VICIDIAL_USERNAME,
          password: VICIDIAL_PASSWORD,
        }
      : undefined,
    timeout: 30000,
  });

  return response.data;
}

/**
 * Replace this parser with your exact current parsing logic if needed.
 * This one is intentionally generic and safe.
 */
function buildResponseFromHtml(html) {
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());

  const payload = {
    fetchedAt: new Date().toISOString(),
    rawTextPreview: bodyText.slice(0, 1000),
    topStats: [
      { label: "Current Active Calls", value: 0 },
      { label: "Calls Ringing", value: 0 },
      { label: "Agents Logged In", value: 0 },
      { label: "Agents In Calls", value: 0 },
      { label: "Agents Waiting", value: 0 },
      { label: "Paused Agents", value: 0 },
      { label: "Agents In Dispo", value: 0 },
    ],
    summaryLines: [
      ["Dropped Percent", "0"],
      ["Agent Avg Wait", "0"],
      ["Avg CustTime", "0"],
    ],
    carrierStats: [
      ["ANSWER", 0, "0%"],
      ["BUSY", 0, "0%"],
    ],
    agentRows: [],
  };

  // Optional: generic label scraping if visible in text
  const patterns = [
    ["Current Active Calls", /Current Active Calls\s*:?\s*(\d+)/i],
    ["Calls Ringing", /Calls Ringing\s*:?\s*(\d+)/i],
    ["Agents Logged In", /Agents Logged In\s*:?\s*(\d+)/i],
    ["Agents In Calls", /Agents In Calls\s*:?\s*(\d+)/i],
    ["Agents Waiting", /Agents Waiting\s*:?\s*(\d+)/i],
    ["Paused Agents", /Paused Agents\s*:?\s*(\d+)/i],
    ["Agents In Dispo", /Agents In Dispo\s*:?\s*(\d+)/i],
  ];

  payload.topStats = payload.topStats.map((item) => {
    const found = patterns.find(([label]) => label === item.label);
    if (!found) return item;
    const match = bodyText.match(found[1]);
    return {
      ...item,
      value: match ? toInt(match[1], 0) : 0,
    };
  });

  const droppedMatch = bodyText.match(/Dropped Percent\s*:?\s*([0-9.]+)%?/i);
  const waitMatch = bodyText.match(/Agent Avg Wait\s*:?\s*([0-9.]+)/i);
  const custMatch = bodyText.match(/Avg CustTime\s*:?\s*([0-9.]+)/i);
  const answerMatch = bodyText.match(/ANSWER.*?([0-9.]+)%/i);
  const busyMatch = bodyText.match(/BUSY.*?([0-9.]+)%/i);

  payload.summaryLines = [
    ["Dropped Percent", droppedMatch ? droppedMatch[1] : "0"],
    ["Agent Avg Wait", waitMatch ? waitMatch[1] : "0"],
    ["Avg CustTime", custMatch ? custMatch[1] : "0"],
  ];

  payload.carrierStats = [
    ["ANSWER", 0, answerMatch ? `${answerMatch[1]}%` : "0%"],
    ["BUSY", 0, busyMatch ? `${busyMatch[1]}%` : "0%"],
  ];

  return payload;
}

function responseToSnapshot(data) {
  const topStatsMap = Object.fromEntries(
    (data.topStats || []).map((item) => [item.label, Number(item.value) || 0])
  );
  const summaryMap = Object.fromEntries(data.summaryLines || []);
  const answerRow = (data.carrierStats || []).find((row) => row[0] === "ANSWER");
  const busyRow = (data.carrierStats || []).find((row) => row[0] === "BUSY");

  return {
    ts: new Date().toISOString(),
    activeCalls: topStatsMap["Current Active Calls"] || 0,
    callsRinging: topStatsMap["Calls Ringing"] || 0,
    agentsLogged: topStatsMap["Agents Logged In"] || 0,
    agentsInCalls: topStatsMap["Agents In Calls"] || 0,
    agentsWaiting: topStatsMap["Agents Waiting"] || 0,
    pausedAgents: topStatsMap["Paused Agents"] || 0,
    agentsInDispo: topStatsMap["Agents In Dispo"] || 0,
    droppedPercent: toFloat(summaryMap["Dropped Percent"], 0),
    avgWait: toFloat(summaryMap["Agent Avg Wait"], 0),
    avgCustTime: toFloat(summaryMap["Avg CustTime"], 0),
    answerRate: answerRow ? toFloat(String(answerRow[2]).replace("%", ""), 0) : 0,
    busyRate: busyRow ? toFloat(String(busyRow[2]).replace("%", ""), 0) : 0,
  };
}

async function collectSnapshotOnce() {
  const html = await fetchVicidialHtml();
  const data = buildResponseFromHtml(html);
  latestDashboardData = data;

  const snapshot = responseToSnapshot(data);
  saveSnapshot(snapshot);

  console.log(`[collector] snapshot stored at ${snapshot.ts}`);
}

function startCollector() {
  collectSnapshotOnce().catch((err) => {
    console.error("[collector] initial run failed:", err.message);
  });

  collectorTimer = setInterval(async () => {
    try {
      await collectSnapshotOnce();
    } catch (err) {
      console.error("[collector] run failed:", err.message);
    }
  }, RECORD_SNAPSHOT_INTERVAL_MS);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    latestDashboardData: !!latestDashboardData,
    intervalMs: RECORD_SNAPSHOT_INTERVAL_MS,
  });
});

app.get("/api/activity-display", async (_req, res) => {
  try {
    if (!latestDashboardData) {
      const html = await fetchVicidialHtml();
      latestDashboardData = buildResponseFromHtml(html);
    }

    res.set("Cache-Control", "no-store");
    res.json(latestDashboardData);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch or parse activity data",
      details: error.message,
    });
  }
});

app.get("/api/activity-display/history", (req, res) => {
  try {
    const mode = String(req.query.mode || "day").toLowerCase();
    const start = req.query.start ? new Date(String(req.query.start)) : null;
    const end = req.query.end ? new Date(String(req.query.end)) : null;

    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      return res.status(400).json({
        error: "Valid start and end query params are required",
      });
    }

    const series = aggregateHistory(mode, start, end);

    res.json({
      mode,
      start: start.toISOString(),
      end: end.toISOString(),
      availableSnapshots: series.length,
      series,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to build history",
      details: error.message,
    });
  }
});

startCollector();

app.listen(PORT, () => {
  console.log(`Activity backend listening on port ${PORT}`);
});