import dotenv from "dotenv";
import mysql from "mysql2/promise";
import Database from "better-sqlite3";

dotenv.config();

const MYSQL_CONFIG = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "vicidial",
};

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || "./data/vicidial.sqlite";

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function normalizeDateTime(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }

  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 19).replace("T", " ");
  }

  return String(value);
}

async function main() {
  console.log("Connecting to MySQL...");
  const mysqlConn = await mysql.createConnection(MYSQL_CONFIG);

  console.log("Opening SQLite...");
  const sqlite = new Database(SQLITE_DB_PATH);
  sqlite.pragma("foreign_keys = OFF");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");

  console.log("Clearing current SQLite tables...");
  sqlite.exec(`
    DELETE FROM agent_snapshots;
    DELETE FROM carrier_snapshots;
    DELETE FROM collector_events;
    DELETE FROM metric_snapshots;
    DELETE FROM sqlite_sequence WHERE name IN (
      'metric_snapshots',
      'agent_snapshots',
      'carrier_snapshots',
      'collector_events'
    );
  `);

  console.log("Reading MySQL metric_snapshots...");
  const [metricRows] = await mysqlConn.query(`
    SELECT
      id, captured_at, capture_reason, active_calls, calls_ringing, calls_waiting,
      calls_in_ivr, chats_waiting, callback_queue_calls, agents_logged,
      agents_in_calls, agents_waiting, paused_agents, agents_in_dead_calls,
      agents_in_dispo, dropped_percent, avg_agents, avg_wait, avg_cust_time,
      answer_rate, busy_rate, system_load_1, system_load_5, system_load_15, created_at
    FROM metric_snapshots
    ORDER BY id ASC
  `);

  console.log("Reading MySQL agent_snapshots...");
  const [agentRows] = await mysqlConn.query(`
    SELECT
      id, snapshot_id, station, agent_user, show_id, session_id, status,
      pause_code, login_label, login_seconds, campaign, calls, inbound_calls,
      latency_label, latency_ms, hold_label, in_group_name, color_name, created_at
    FROM agent_snapshots
    ORDER BY id ASC
  `);

  console.log("Reading MySQL carrier_snapshots...");
  const [carrierRows] = await mysqlConn.query(`
    SELECT
      id, snapshot_id, hangup_status, v_24h, p_24h, v_6h, p_6h, v_1h, p_1h,
      v_15m, p_15m, v_5m, p_5m, v_1m, p_1m, created_at
    FROM carrier_snapshots
    ORDER BY id ASC
  `);

  console.log("Reading MySQL collector_events...");
  const [eventRows] = await mysqlConn.query(`
    SELECT
      id, event_time, event_type, message, created_at
    FROM collector_events
    ORDER BY id ASC
  `);

  console.log("Inserting metric_snapshots...");
  const insertMetric = sqlite.prepare(`
    INSERT INTO metric_snapshots (
      id, captured_at, capture_reason, active_calls, calls_ringing, calls_waiting,
      calls_in_ivr, chats_waiting, callback_queue_calls, agents_logged,
      agents_in_calls, agents_waiting, paused_agents, agents_in_dead_calls,
      agents_in_dispo, dropped_percent, avg_agents, avg_wait, avg_cust_time,
      answer_rate, busy_rate, system_load_1, system_load_5, system_load_15, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAgent = sqlite.prepare(`
    INSERT INTO agent_snapshots (
      id, snapshot_id, station, agent_user, show_id, session_id, status,
      pause_code, login_label, login_seconds, campaign, calls, inbound_calls,
      latency_label, latency_ms, hold_label, in_group_name, color_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCarrier = sqlite.prepare(`
    INSERT INTO carrier_snapshots (
      id, snapshot_id, hangup_status, v_24h, p_24h, v_6h, p_6h, v_1h, p_1h,
      v_15m, p_15m, v_5m, p_5m, v_1m, p_1m, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEvent = sqlite.prepare(`
    INSERT INTO collector_events (
      id, event_time, event_type, message, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const insertMetricsTx = sqlite.transaction((rows) => {
    for (const r of rows) {
      insertMetric.run(
        r.id,
        normalizeDateTime(r.captured_at),
        r.capture_reason,
        r.active_calls,
        r.calls_ringing,
        r.calls_waiting,
        r.calls_in_ivr,
        r.chats_waiting,
        r.callback_queue_calls,
        r.agents_logged,
        r.agents_in_calls,
        r.agents_waiting,
        r.paused_agents,
        r.agents_in_dead_calls,
        r.agents_in_dispo,
        r.dropped_percent,
        r.avg_agents,
        r.avg_wait,
        r.avg_cust_time,
        r.answer_rate,
        r.busy_rate,
        r.system_load_1,
        r.system_load_5,
        r.system_load_15,
        normalizeDateTime(r.created_at)
      );
    }
  });

  const insertAgentsTx = sqlite.transaction((rows) => {
    for (const r of rows) {
      insertAgent.run(
        r.id,
        r.snapshot_id,
        r.station,
        r.agent_user,
        r.show_id,
        r.session_id,
        r.status,
        r.pause_code,
        r.login_label,
        r.login_seconds,
        r.campaign,
        r.calls,
        r.inbound_calls,
        r.latency_label,
        r.latency_ms,
        r.hold_label,
        r.in_group_name,
        r.color_name,
        normalizeDateTime(r.created_at)
      );
    }
  });

  const insertCarriersTx = sqlite.transaction((rows) => {
    for (const r of rows) {
      insertCarrier.run(
        r.id,
        r.snapshot_id,
        r.hangup_status,
        r.v_24h,
        r.p_24h,
        r.v_6h,
        r.p_6h,
        r.v_1h,
        r.p_1h,
        r.v_15m,
        r.p_15m,
        r.v_5m,
        r.p_5m,
        r.v_1m,
        r.p_1m,
        normalizeDateTime(r.created_at)
      );
    }
  });

  const insertEventsTx = sqlite.transaction((rows) => {
    for (const r of rows) {
      insertEvent.run(
        r.id,
        normalizeDateTime(r.event_time),
        r.event_type,
        r.message,
        normalizeDateTime(r.created_at)
      );
    }
  });

  for (const chunk of chunkArray(metricRows, 500)) {
    insertMetricsTx(chunk);
  }

  for (const chunk of chunkArray(agentRows, 1000)) {
    insertAgentsTx(chunk);
  }

  for (const chunk of chunkArray(carrierRows, 1000)) {
    insertCarriersTx(chunk);
  }

  for (const chunk of chunkArray(eventRows, 500)) {
    insertEventsTx(chunk);
  }

  const maxMetricId = sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS v FROM metric_snapshots`).get().v;
  const maxAgentId = sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS v FROM agent_snapshots`).get().v;
  const maxCarrierId = sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS v FROM carrier_snapshots`).get().v;
  const maxEventId = sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS v FROM collector_events`).get().v;

  sqlite.prepare(`INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES ('metric_snapshots', ?)`).run(maxMetricId);
  sqlite.prepare(`INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES ('agent_snapshots', ?)`).run(maxAgentId);
  sqlite.prepare(`INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES ('carrier_snapshots', ?)`).run(maxCarrierId);
  sqlite.prepare(`INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES ('collector_events', ?)`).run(maxEventId);

  sqlite.pragma("foreign_keys = ON");

  console.log("Done.");
  console.log(`metric_snapshots: ${metricRows.length}`);
  console.log(`agent_snapshots: ${agentRows.length}`);
  console.log(`carrier_snapshots: ${carrierRows.length}`);
  console.log(`collector_events: ${eventRows.length}`);

  await mysqlConn.end();
  sqlite.close();
}

main().catch(async (error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});