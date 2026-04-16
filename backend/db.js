import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || "./data/vicidial.sqlite";

let db = null;

let insertMetricSnapshotStmt = null;
let insertAgentSnapshotStmt = null;
let insertCarrierSnapshotStmt = null;
let insertCollectorEventStmt = null;

function ensureDb() {
  if (!db) {
    throw new Error("SQLite database is not initialized. Call initDatabase() first.");
  }
  return db;
}

function resolveDbPath() {
  return path.isAbsolute(SQLITE_DB_PATH)
    ? SQLITE_DB_PATH
    : path.resolve(process.cwd(), SQLITE_DB_PATH);
}

function ensureDbDirectory(dbPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatSqliteDateTime(date = new Date()) {
  const d = new Date(date);
  return [
    d.getFullYear(),
    "-",
    pad2(d.getMonth() + 1),
    "-",
    pad2(d.getDate()),
    " ",
    pad2(d.getHours()),
    ":",
    pad2(d.getMinutes()),
    ":",
    pad2(d.getSeconds()),
  ].join("");
}

function toQueryDateTime(date) {
  return new Date(date).toISOString().slice(0, 19).replace("T", " ");
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

function toSeconds(mmss = "") {
  const value = String(mmss || "").trim();
  if (!value || value === "-") return 0;

  const parts = value.split(":").map((x) => parseInt(x, 10));
  if (parts.some(Number.isNaN)) return 0;

  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];

  return 0;
}

function latencyToMs(label = "") {
  return toInt(String(label).replace(/ms/i, ""), 0);
}

function extractTopStatsMap(data) {
  return Object.fromEntries(
    (data.topStats || []).map((item) => [item.label, Number(item.value) || 0])
  );
}

function extractSummaryMap(data) {
  return Object.fromEntries(data.summaryLines || []);
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

function aggregateHistory(mode, startDate, endDate, history = []) {
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

function prepareStatements() {
  const database = ensureDb();

  insertMetricSnapshotStmt = database.prepare(`
    INSERT INTO metric_snapshots (
      captured_at,
      capture_reason,
      active_calls,
      calls_ringing,
      calls_waiting,
      calls_in_ivr,
      chats_waiting,
      callback_queue_calls,
      agents_logged,
      agents_in_calls,
      agents_waiting,
      paused_agents,
      agents_in_dead_calls,
      agents_in_dispo,
      dropped_percent,
      avg_agents,
      avg_wait,
      avg_cust_time,
      answer_rate,
      busy_rate,
      system_load_1,
      system_load_5,
      system_load_15
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertAgentSnapshotStmt = database.prepare(`
    INSERT INTO agent_snapshots (
      snapshot_id,
      station,
      agent_user,
      show_id,
      session_id,
      status,
      pause_code,
      login_label,
      login_seconds,
      campaign,
      calls,
      inbound_calls,
      latency_label,
      latency_ms,
      hold_label,
      in_group_name,
      color_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCarrierSnapshotStmt = database.prepare(`
    INSERT INTO carrier_snapshots (
      snapshot_id,
      hangup_status,
      v_24h,
      p_24h,
      v_6h,
      p_6h,
      v_1h,
      p_1h,
      v_15m,
      p_15m,
      v_5m,
      p_5m,
      v_1m,
      p_1m
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCollectorEventStmt = database.prepare(`
    INSERT INTO collector_events (
      event_time,
      event_type,
      message
    ) VALUES (?, ?, ?)
  `);
}

export async function initDatabase() {
  if (db) return db;

  const dbPath = resolveDbPath();
  ensureDbDirectory(dbPath);

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      capture_reason TEXT NOT NULL DEFAULT 'interval'
        CHECK (capture_reason IN ('interval', 'shutdown', 'startup', 'manual', 'request')),
      active_calls INTEGER NOT NULL DEFAULT 0,
      calls_ringing INTEGER NOT NULL DEFAULT 0,
      calls_waiting INTEGER NOT NULL DEFAULT 0,
      calls_in_ivr INTEGER NOT NULL DEFAULT 0,
      chats_waiting INTEGER NOT NULL DEFAULT 0,
      callback_queue_calls INTEGER NOT NULL DEFAULT 0,
      agents_logged INTEGER NOT NULL DEFAULT 0,
      agents_in_calls INTEGER NOT NULL DEFAULT 0,
      agents_waiting INTEGER NOT NULL DEFAULT 0,
      paused_agents INTEGER NOT NULL DEFAULT 0,
      agents_in_dead_calls INTEGER NOT NULL DEFAULT 0,
      agents_in_dispo INTEGER NOT NULL DEFAULT 0,
      dropped_percent REAL NOT NULL DEFAULT 0,
      avg_agents REAL NOT NULL DEFAULT 0,
      avg_wait REAL NOT NULL DEFAULT 0,
      avg_cust_time REAL NOT NULL DEFAULT 0,
      answer_rate REAL NOT NULL DEFAULT 0,
      busy_rate REAL NOT NULL DEFAULT 0,
      system_load_1 REAL,
      system_load_5 REAL,
      system_load_15 REAL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS agent_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      station TEXT,
      agent_user TEXT,
      show_id TEXT,
      session_id TEXT,
      status TEXT,
      pause_code TEXT,
      login_label TEXT,
      login_seconds INTEGER NOT NULL DEFAULT 0,
      campaign TEXT,
      calls INTEGER NOT NULL DEFAULT 0,
      inbound_calls INTEGER NOT NULL DEFAULT 0,
      latency_label TEXT,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      hold_label TEXT,
      in_group_name TEXT,
      color_name TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
      FOREIGN KEY (snapshot_id) REFERENCES metric_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS carrier_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      hangup_status TEXT NOT NULL,
      v_24h INTEGER NOT NULL DEFAULT 0,
      p_24h TEXT,
      v_6h INTEGER NOT NULL DEFAULT 0,
      p_6h TEXT,
      v_1h INTEGER NOT NULL DEFAULT 0,
      p_1h TEXT,
      v_15m INTEGER NOT NULL DEFAULT 0,
      p_15m TEXT,
      v_5m INTEGER NOT NULL DEFAULT 0,
      p_5m TEXT,
      v_1m INTEGER NOT NULL DEFAULT 0,
      p_1m TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
      FOREIGN KEY (snapshot_id) REFERENCES metric_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collector_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_time TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('startup', 'shutdown', 'error', 'manual', 'interval')),
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_metric_snapshots_captured_at
      ON metric_snapshots (captured_at);

    CREATE INDEX IF NOT EXISTS idx_metric_snapshots_reason
      ON metric_snapshots (capture_reason);

    CREATE INDEX IF NOT EXISTS idx_agent_snapshots_snapshot_id
      ON agent_snapshots (snapshot_id);

    CREATE INDEX IF NOT EXISTS idx_agent_snapshots_agent_user
      ON agent_snapshots (agent_user);

    CREATE INDEX IF NOT EXISTS idx_agent_snapshots_status
      ON agent_snapshots (status);

    CREATE INDEX IF NOT EXISTS idx_carrier_snapshots_snapshot_id
      ON carrier_snapshots (snapshot_id);

    CREATE INDEX IF NOT EXISTS idx_carrier_snapshots_hangup_status
      ON carrier_snapshots (hangup_status);

    CREATE INDEX IF NOT EXISTS idx_collector_events_event_time
      ON collector_events (event_time);

    CREATE INDEX IF NOT EXISTS idx_collector_events_event_type
      ON collector_events (event_type);
  `);

  prepareStatements();

  return db;
}

export async function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
  insertMetricSnapshotStmt = null;
  insertAgentSnapshotStmt = null;
  insertCarrierSnapshotStmt = null;
  insertCollectorEventStmt = null;
}

export async function logCollectorEvent(eventType, message) {
  const database = ensureDb();
  const eventTime = formatSqliteDateTime(new Date());

  insertCollectorEventStmt.run(eventTime, eventType, message || null);
  return database;
}

export async function persistSnapshotToDb(data, captureReason = "interval") {
  ensureDb();

  const row = snapshotToDbRow(data, captureReason);
  const capturedAt = formatSqliteDateTime(new Date());

  const tx = db.transaction(() => {
    const metricResult = insertMetricSnapshotStmt.run(
      capturedAt,
      row.captureReason,
      row.activeCalls,
      row.callsRinging,
      row.callsWaiting,
      row.callsInIvr,
      row.chatsWaiting,
      row.callbackQueueCalls,
      row.agentsLogged,
      row.agentsInCalls,
      row.agentsWaiting,
      row.pausedAgents,
      row.agentsInDeadCalls,
      row.agentsInDispo,
      row.droppedPercent,
      row.avgAgents,
      row.avgWait,
      row.avgCustTime,
      row.answerRate,
      row.busyRate,
      row.systemLoad1,
      row.systemLoad5,
      row.systemLoad15
    );

    const snapshotId = Number(metricResult.lastInsertRowid);

    for (const agent of data.agentRows || []) {
      insertAgentSnapshotStmt.run(
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
        agent.color || null
      );
    }

    for (const rowCarrier of data.carrierStats || []) {
      insertCarrierSnapshotStmt.run(
        snapshotId,
        rowCarrier[0] || "",
        toInt(rowCarrier[1]),
        rowCarrier[2] || null,
        toInt(rowCarrier[3]),
        rowCarrier[4] || null,
        toInt(rowCarrier[5]),
        rowCarrier[6] || null,
        toInt(rowCarrier[7]),
        rowCarrier[8] || null,
        toInt(rowCarrier[9]),
        rowCarrier[10] || null,
        toInt(rowCarrier[11]),
        rowCarrier[12] || null
      );
    }

    return snapshotId;
  });

  return tx();
}

export async function getRecordedHistory(mode, startDate, endDate) {
  ensureDb();

  const rows = db.prepare(`
    SELECT
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
    ORDER BY captured_at ASC
  `).all(
    toQueryDateTime(startDate),
    toQueryDateTime(endDate)
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

export async function getRecordedAgentCallsAtHour(targetDate) {
  ensureDb();

  const base = new Date(targetDate);
  if (Number.isNaN(base.getTime())) {
    return {
      capturedAt: null,
      hourStart: null,
      hourEnd: null,
      agents: [],
    };
  }

  const hourStart = new Date(base);
  hourStart.setMinutes(0, 0, 0);

  const hourEnd = new Date(hourStart);
  hourEnd.setHours(hourEnd.getHours() + 1);

  const rows = db.prepare(`
    SELECT
      m.captured_at,
      a.agent_user,
      a.status,
      a.calls
    FROM agent_snapshots a
    JOIN metric_snapshots m ON m.id = a.snapshot_id
    WHERE m.captured_at >= ?
      AND m.captured_at < ?
    ORDER BY m.captured_at ASC, LOWER(COALESCE(a.agent_user, '')) ASC, a.id ASC
  `).all(
    toQueryDateTime(hourStart),
    toQueryDateTime(hourEnd)
  );

  const byAgent = new Map();

  for (const row of rows) {
    const agentUser = (row.agent_user || "").trim() || "(sans agent)";
    const status = String(row.status || "").trim().toUpperCase();
    const activeCalls = status === "INCALL" ? 1 : 0;

    if (!byAgent.has(agentUser)) {
      byAgent.set(agentUser, {
        agentUser,
        samples: 0,
        totalActiveCalls: 0,
        maxActiveCalls: 0,
      });
    }

    const entry = byAgent.get(agentUser);
    entry.samples += 1;
    entry.totalActiveCalls += activeCalls;
    entry.maxActiveCalls = Math.max(entry.maxActiveCalls, activeCalls);
  }

  const agents = [...byAgent.values()]
    .map((entry) => ({
      agentUser: entry.agentUser,
      avgActiveCalls:
        entry.samples > 0
          ? Number((entry.totalActiveCalls / entry.samples).toFixed(2))
          : 0,
      maxActiveCalls: entry.maxActiveCalls,
      samples: entry.samples,
    }))
    .sort((a, b) => a.agentUser.localeCompare(b.agentUser));

  return {
    capturedAt: toQueryDateTime(hourStart),
    hourStart: toQueryDateTime(hourStart),
    hourEnd: toQueryDateTime(hourEnd),
    agents,
  };
}

export async function getRecordedPauseHistory(mode, startDate, endDate, normalizePause) {
  ensureDb();

  const rows = db.prepare(`
    SELECT
      m.captured_at,
      a.pause_code,
      a.status,
      a.login_label
    FROM agent_snapshots a
    JOIN metric_snapshots m ON m.id = a.snapshot_id
    WHERE m.captured_at BETWEEN ? AND ?
    ORDER BY m.captured_at ASC, a.id ASC
  `).all(
    toQueryDateTime(startDate),
    toQueryDateTime(endDate)
  );

  const buckets = new Map();

  for (const row of rows) {
    const date = new Date(row.captured_at);
    if (Number.isNaN(date.getTime())) continue;

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

    const rawPause =
      row.pause_code ||
      (String(row.status || "").toUpperCase() === "PAUSED" ? row.login_label || "" : "") ||
      row.login_label ||
      "";

    const normalized = normalizePause(rawPause);
    if (!normalized) continue;

    bucket[normalized] += 1;
  }

  return [...buckets.values()];
}

export async function getRecordedAgentAnalytics(startDate, endDate) {
  ensureDb();

  const start = toQueryDateTime(startDate);
  const end = toQueryDateTime(endDate);

  const normalizedStatusExpr = `
    CASE
      WHEN UPPER(COALESCE(a.status, '')) IN ('READY', 'INCALL', 'PAUSED', 'DISPO', 'DEAD')
        THEN UPPER(a.status)
      WHEN UPPER(COALESCE(a.session_id, '')) IN ('READY', 'INCALL', 'PAUSED', 'DISPO', 'DEAD')
        THEN UPPER(a.session_id)
      ELSE ''
    END
  `;

  const normalizedPauseCodeExpr = `
    CASE
      WHEN ${normalizedStatusExpr} = 'PAUSED' THEN
        COALESCE(
          NULLIF(TRIM(a.pause_code), ''),
          CASE
            WHEN UPPER(COALESCE(a.status, '')) NOT IN ('READY', 'INCALL', 'PAUSED', 'DISPO', 'DEAD')
              THEN NULLIF(TRIM(a.status), '')
            ELSE NULL
          END,
          NULLIF(TRIM(a.login_label), ''),
          '(sans code)'
        )
      ELSE NULL
    END
  `;

  const agentRows = db.prepare(`
    SELECT
      a.agent_user,
      COALESCE(NULLIF(MAX(TRIM(a.campaign)), ''), '(sans campagne)') AS campaign,
      COUNT(*) AS samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'INCALL' THEN 1 ELSE 0 END) AS incall_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'PAUSED' THEN 1 ELSE 0 END) AS paused_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'READY' THEN 1 ELSE 0 END) AS ready_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'DISPO' THEN 1 ELSE 0 END) AS dispo_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'DEAD' THEN 1 ELSE 0 END) AS dead_samples,
      AVG(COALESCE(a.latency_ms, 0)) AS avg_latency_ms,
      MIN(COALESCE(a.calls, 0)) AS min_calls,
      MAX(COALESCE(a.calls, 0)) AS max_calls
    FROM agent_snapshots a
    JOIN metric_snapshots m
      ON m.id = a.snapshot_id
    WHERE m.captured_at BETWEEN ? AND ?
      AND TRIM(COALESCE(a.agent_user, '')) <> ''
    GROUP BY a.agent_user
    ORDER BY max_calls DESC, a.agent_user ASC
  `).all(start, end);

  const agents = agentRows.map((row) => {
    const samples = toInt(row.samples, 0);
    const incallSamples = toInt(row.incall_samples, 0);
    const pausedSamples = toInt(row.paused_samples, 0);
    const readySamples = toInt(row.ready_samples, 0);
    const dispoSamples = toInt(row.dispo_samples, 0);
    const deadSamples = toInt(row.dead_samples, 0);
    const minCalls = toInt(row.min_calls, 0);
    const maxCalls = toInt(row.max_calls, 0);

    const ratio = (value) =>
      samples > 0 ? Number(((value / samples) * 100).toFixed(2)) : 0;

    return {
      agentUser: row.agent_user || "(agent inconnu)",
      campaign: row.campaign || "(sans campagne)",
      samples,
      incallSamples,
      pausedSamples,
      readySamples,
      dispoSamples,
      deadSamples,
      utilizationPct: ratio(incallSamples),
      pausePct: ratio(pausedSamples),
      readyPct: ratio(readySamples),
      dispoPct: ratio(dispoSamples),
      deadPct: ratio(deadSamples),
      avgLatencyMs: Number(toFloat(row.avg_latency_ms, 0).toFixed(2)),
      callsHandled: Math.max(0, maxCalls - minCalls),
      maxCalls,
    };
  });

  const pauseCodeRows = db.prepare(`
    SELECT
      ${normalizedPauseCodeExpr} AS pause_code,
      COUNT(*) AS hits
    FROM agent_snapshots a
    JOIN metric_snapshots m
      ON m.id = a.snapshot_id
    WHERE m.captured_at BETWEEN ? AND ?
      AND ${normalizedStatusExpr} = 'PAUSED'
    GROUP BY pause_code
    ORDER BY hits DESC, pause_code ASC
    LIMIT 8
  `).all(start, end);

  const topPauseCodes = pauseCodeRows
    .map((row) => ({
      pauseCode: row.pause_code,
      hits: toInt(row.hits, 0),
    }))
    .filter((row) => row.pauseCode && row.hits > 0);

  const statusTotals = db.prepare(`
    SELECT
      COUNT(*) AS total_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'INCALL' THEN 1 ELSE 0 END) AS incall_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'PAUSED' THEN 1 ELSE 0 END) AS paused_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'READY' THEN 1 ELSE 0 END) AS ready_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'DISPO' THEN 1 ELSE 0 END) AS dispo_samples,
      SUM(CASE WHEN ${normalizedStatusExpr} = 'DEAD' THEN 1 ELSE 0 END) AS dead_samples
    FROM agent_snapshots a
    JOIN metric_snapshots m
      ON m.id = a.snapshot_id
    WHERE m.captured_at BETWEEN ? AND ?
  `).get(start, end);

  const statusDistribution = [
    { name: "En appel", value: toInt(statusTotals?.incall_samples, 0) },
    { name: "En pause", value: toInt(statusTotals?.paused_samples, 0) },
    { name: "Ready", value: toInt(statusTotals?.ready_samples, 0) },
    { name: "Dispo", value: toInt(statusTotals?.dispo_samples, 0) },
    { name: "Dead", value: toInt(statusTotals?.dead_samples, 0) },
  ].filter((item) => item.value > 0);

  return {
    agents,
    topPauseCodes,
    statusDistribution,
  };
}

export { ensureDb, toQueryDateTime };