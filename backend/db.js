import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const dataDir = process.env.DATA_DIR || "/app/data";
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.SQLITE_PATH || path.join(dataDir, "activity-display.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    active_calls INTEGER NOT NULL,
    calls_ringing INTEGER NOT NULL,
    agents_logged INTEGER NOT NULL,
    agents_in_calls INTEGER NOT NULL,
    agents_waiting INTEGER NOT NULL,
    paused_agents INTEGER NOT NULL,
    agents_in_dispo INTEGER NOT NULL,
    dropped_percent REAL NOT NULL,
    avg_wait REAL NOT NULL,
    avg_cust_time REAL NOT NULL,
    answer_rate REAL NOT NULL,
    busy_rate REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts);
`);

const insertStmt = db.prepare(`
  INSERT INTO snapshots (
    ts,
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
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const rangeStmt = db.prepare(`
  SELECT
    ts,
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
  FROM snapshots
  WHERE ts >= ? AND ts <= ?
  ORDER BY ts ASC
`);

export function saveSnapshot(snapshot) {
  insertStmt.run(
    snapshot.ts,
    snapshot.activeCalls,
    snapshot.callsRinging,
    snapshot.agentsLogged,
    snapshot.agentsInCalls,
    snapshot.agentsWaiting,
    snapshot.pausedAgents,
    snapshot.agentsInDispo,
    snapshot.droppedPercent,
    snapshot.avgWait,
    snapshot.avgCustTime,
    snapshot.answerRate,
    snapshot.busyRate
  );
}

export function getSnapshots(startIso, endIso) {
  return rangeStmt.all(startIso, endIso).map((row) => ({
    ts: row.ts,
    activeCalls: row.active_calls,
    callsRinging: row.calls_ringing,
    agentsLogged: row.agents_logged,
    agentsInCalls: row.agents_in_calls,
    agentsWaiting: row.agents_waiting,
    pausedAgents: row.paused_agents,
    agentsInDispo: row.agents_in_dispo,
    droppedPercent: row.dropped_percent,
    avgWait: row.avg_wait,
    avgCustTime: row.avg_cust_time,
    answerRate: row.answer_rate,
    busyRate: row.busy_rate,
  }));
}