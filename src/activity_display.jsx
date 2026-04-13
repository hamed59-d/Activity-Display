import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  BellRing,
  BookOpenText,
  ChevronRight,
  Clock3,
  Headphones,
  Hourglass,
  Phone,
  PhoneCall,
  Printer,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  Voicemail,
  Waves,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchActivityDisplayData } from "./mockApi";
import {
  Area,
  AreaChart,
} from "recharts";

const reportOptions = [
  "Voir plus",
  "Voir groupe d'utilisateurs",
  "Afficher infos serveur",
  "Masquer appels en attente",
  "Afficher stats In-Group",
  "Afficher téléphones",
  "Afficher moniteurs",
  "Afficher custphones",
  "Afficher infos client",
];

const chartPalette = ["#22d3ee", "#38bdf8", "#6366f1", "#a855f7", "#10b981", "#f59e0b"];

const statIcons = {
  "Appels actifs actuels": PhoneCall,
  "Appels en sonnerie": BellRing,
  "Appels en attente d'agents": Hourglass,
  "Appels dans le SVI": Voicemail,
  "Chats en attente d'agents": Waves,
  "Appels de file de rappel": RefreshCw,
  "Agents connectés": Users,
  "Agents en appel": Headphones,
  "Agents en attente": RadioTower,
  "Agents en pause": ShieldCheck,
  "Agents en appels morts": Phone,
  "Agents en dispo": BookOpenText,

  "Current Active Calls": PhoneCall,
  "Calls Ringing": BellRing,
  "Calls Waiting For Agents": Hourglass,
  "Calls In IVR": Voicemail,
  "Chats Waiting For Agents": Waves,
  "Callback Queue Calls": RefreshCw,
  "Agents Logged In": Users,
  "Agents In Calls": Headphones,
  "Agents Waiting": RadioTower,
  "Paused Agents": ShieldCheck,
  "Agents In Dead Calls": Phone,
  "Agents In Dispo": BookOpenText,
};

const topStatLabelsFr = {
  "Current Active Calls": "Appels actifs actuels",
  "Calls Ringing": "Appels en sonnerie",
  "Calls Waiting For Agents": "Appels en attente d'agents",
  "Calls In IVR": "Appels dans le SVI",
  "Chats Waiting For Agents": "Chats en attente d'agents",
  "Callback Queue Calls": "Appels de file de rappel",
  "Agents Logged In": "Agents connectés",
  "Agents In Calls": "Agents en appel",
  "Agents Waiting": "Agents en attente",
  "Paused Agents": "Agents en pause",
  "Agents In Dead Calls": "Agents en appels morts",
  "Agents In Dispo": "Agents en dispo",
};

const sidebarItems = [
  { key: "reports", label: "Rapports", icon: BarChart3 },
  { key: "campaigns", label: "Campagnes", icon: RadioTower },
  { key: "agents", label: "Agents", icon: Users },
  { key: "calls", label: "Appels", icon: PhoneCall },
];

function toneClasses(tone) {
  const map = {
    cyan: "from-cyan-500/20 to-cyan-400/5 border-cyan-400/30 shadow-cyan-500/10",
    blue: "from-blue-500/20 to-blue-400/5 border-blue-400/30 shadow-blue-500/10",
    rose: "from-rose-500/20 to-rose-400/5 border-rose-400/30 shadow-rose-500/10",
    violet: "from-violet-500/20 to-violet-400/5 border-violet-400/30 shadow-violet-500/10",
    sky: "from-sky-500/20 to-sky-400/5 border-sky-400/30 shadow-sky-500/10",
    indigo: "from-indigo-500/20 to-indigo-400/5 border-indigo-400/30 shadow-indigo-500/10",
    teal: "from-teal-500/20 to-teal-400/5 border-teal-400/30 shadow-teal-500/10",
    emerald: "from-emerald-500/20 to-emerald-400/5 border-emerald-400/30 shadow-emerald-500/10",
    lime: "from-lime-500/20 to-lime-400/5 border-lime-400/30 shadow-lime-500/10",
    amber: "from-amber-500/20 to-amber-400/5 border-amber-400/30 shadow-amber-500/10",
    zinc: "from-zinc-500/20 to-zinc-400/5 border-zinc-400/30 shadow-zinc-500/10",
    yellow: "from-yellow-500/20 to-yellow-400/5 border-yellow-400/30 shadow-yellow-500/10",
  };
  return map[tone] ?? map.cyan;
}

function rowColor(color) {
  const map = {
    ready: "bg-blue-600/70",
    paused: "bg-yellow-400/85 text-black",
    "paused-long": "bg-amber-700/85",
    "paused-soft": "bg-yellow-200/80 text-black",
  };
  return map[color] ?? "bg-slate-800/70";
}

function DashboardKpiCard({ label, value, hint, icon: Icon }) {
  return (
    <div className="rounded-[20px] border border-cyan-500/20 bg-slate-950/60 p-3 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 leading-4">
            {label}
          </div>
          <div className="mt-2 font-mono text-2xl leading-none text-cyan-200">
            {value}
          </div>
          {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
        </div>

        {Icon ? (
          <div className="shrink-0 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2">
            <Icon className="h-5 w-5 text-cyan-300" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatDelta(value, suffix = "") {
  if (!Number.isFinite(value) || value === 0) return `0${suffix}`;
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function TinyTrendCard({ title, value, delta, suffix = "", dataKey, data }) {
  return (
    <div className="rounded-[22px] border border-cyan-500/20 bg-slate-950/60 p-4 backdrop-blur-xl">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-2xl text-cyan-200">
            {value}
            {suffix}
          </div>
          <div className="mt-1 text-xs text-slate-400">{delta}</div>
        </div>
      </div>

      <div className="mt-3 h-[80px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke="#22d3ee"
              strokeWidth={2}
              dot={false}
            />
            <Tooltip
              contentStyle={{
                background: "#020617",
                border: "1px solid rgba(34,211,238,0.25)",
                borderRadius: "16px",
                color: "#e2e8f0",
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

async function printElementById(elementId, title = "Graphique") {
  const element = document.getElementById(elementId);
  if (!element) return;

  const canvas = await html2canvas(element, {
    backgroundColor: "#020617",
    scale: 2,
    useCORS: true,
  });

  const imageData = canvas.toDataURL("image/png");

  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          body {
            margin: 0;
            padding: 24px;
            font-family: Arial, sans-serif;
            background: white;
            color: black;
          }
          .title {
            font-size: 20px;
            margin-bottom: 16px;
            font-weight: 600;
          }
          img {
            width: 100%;
            height: auto;
            display: block;
            border: 1px solid #ccc;
          }
          @page {
            size: auto;
            margin: 12mm;
          }
        </style>
      </head>
      <body>
        <div class="title">${title}</div>
        <img src="${imageData}" alt="${title}" />
        <script>
          window.onload = () => {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `);

  printWindow.document.close();
}

function ChartHeader({ icon: Icon, title, printTargetId, printTitle }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-5 w-5 text-cyan-300" /> : null}
        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
          {title}
        </h2>
      </div>

      <button
        type="button"
        onClick={() => printElementById(printTargetId, printTitle || title)}
        className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2 transition hover:bg-cyan-500/20"
        title="Imprimer ce graphique"
      >
        <Printer className="h-4 w-4 text-cyan-300" />
      </button>
    </div>
  );
}

export default function ActivityDisplay() {
  const [clock, setClock] = useState("");
  const [activeSidebar, setActiveSidebar] = useState("reports");
  const [activeReportLink, setActiveReportLink] = useState("summary");
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showSummarySystem, setShowSummarySystem] = useState(true);
  const [showOperatorStats, setShowOperatorStats] = useState(true);
  const [historyRange, setHistoryRange] = useState("daily");

  const isDashboardsView = activeReportLink === "dashboards";


    const [graphMode, setGraphMode] = useState("Min");
    const [graphStart, setGraphStart] = useState(() => {
      const d = new Date(Date.now() - 60 * 60 * 1000);
      return d.toISOString().slice(0, 16);
    });
    const [graphEnd, setGraphEnd] = useState(() => new Date().toISOString().slice(0, 16));
    const [historyData, setHistoryData] = useState([]);
    const [agentAnalytics, setAgentAnalytics] = useState({
      agents: [],
      statusDistribution: [],
      topPauseCodes: [],
    });

    const [dataSource, setDataSource] = useState("realtime");


  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const date = now.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const time = now.toLocaleTimeString("fr-FR");
      setClock(`${date} // ${time}`);
    };

    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, []);


  useEffect(() => {
    const needsHistory =
      activeReportLink === "live-board" || activeReportLink === "dashboards";

    if (!needsHistory) return;

    let cancelled = false;

    const loadHistory = async () => {
      try {
        const url = new URL("http://localhost:3001/api/activity-display/history");
        url.searchParams.set("mode", graphMode);
        url.searchParams.set("start", graphStart);
        url.searchParams.set("end", graphEnd);
        url.searchParams.set("source", dataSource);

        const response = await fetch(url.toString(), { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`History backend error: ${response.status}`);
        }

        const result = await response.json();

        if (!cancelled) {
          setHistoryData(result.points || []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
        }
      }
    };

    loadHistory();
    const id = setInterval(loadHistory, dataSource === "realtime" ? 5000 : 15000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeReportLink, graphMode, graphStart, graphEnd, dataSource, dashboardData?.updatedAt]);


  useEffect(() => {
    const needsAgentAnalytics =
      activeReportLink === "live-board" || activeReportLink === "dashboards";

    if (!needsAgentAnalytics) return;

    let cancelled = false;

    const loadAgentAnalytics = async () => {
      try {
        const url = new URL("http://localhost:3001/api/activity-display/agent-analytics");
        url.searchParams.set("start", graphStart);
        url.searchParams.set("end", graphEnd);

        const response = await fetch(url.toString(), { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Agent analytics backend error: ${response.status}`);
        }

        const result = await response.json();

        if (!cancelled) {
          setAgentAnalytics({
            agents: result.agents || [],
            statusDistribution: result.statusDistribution || [],
            topPauseCodes: result.topPauseCodes || [],
          });
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setAgentAnalytics({
            agents: [],
            statusDistribution: [],
            topPauseCodes: [],
          });
        }
      }
    };

    loadAgentAnalytics();
    const id = setInterval(loadAgentAnalytics, 15000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeReportLink, graphStart, graphEnd]);


  useEffect(() => {
    let mounted = true;

    const loadData = async (initialLoad = false) => {
      try {
        if (initialLoad) {
          setLoading(true);
        } else {
          setIsRefreshing(true);
        }

        const data = await fetchActivityDisplayData();
        if (!mounted) return;

        setDashboardData(data);
        setError("");
      } catch (err) {
        if (!mounted) return;
        setError("Échec de l'actualisation des données en direct.");
        console.error(err);
      } finally {
        if (!mounted) return;
        setLoading(false);
        setIsRefreshing(false);
      }
    };

    loadData(true);
    const refreshMs = activeReportLink === "live-board" ? 5000 : 1000;
    const interval = setInterval(() => loadData(false), refreshMs);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeReportLink]);

  const reportTitle = useMemo(() => {
    if (activeReportLink === "summary") return "Rapport principal en temps réel";
    if (activeReportLink === "live-board") return "Rapport principal en temps réel // Graphes Courants";
    if (activeReportLink === "agents-table") return "Rapport principal en temps réel // Temps d'appel des agents";
    if (activeReportLink === "dashboards") return "Tableaux de bord // Analytique des rapports";
    return `Rapport principal en temps réel // ${activeReportLink.replaceAll("-", " ")}`;
  }, [activeReportLink]);

  const chartsData = useMemo(() => {
      if (!dashboardData) return null;

      const toSeconds = (value) => {
        const text = String(value || "").trim();
        if (!text || text === "-") return 0;

        const parts = text.split(":").map((x) => parseInt(x, 10));
        if (parts.some(Number.isNaN)) return 0;

        if (parts.length === 2) {
          return parts[0] * 60 + parts[1];
        }

        if (parts.length === 3) {
          return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }

        return 0;
      };

      const topStatsMap = Object.fromEntries(
        (dashboardData.topStats || []).map((item) => [item.label, Number(item.value) || 0])
      );

      const agentRows = dashboardData.agentRows || [];

      const countStatus = (status) =>
        agentRows.filter(
          (row) => String(row.status || "").toUpperCase() === status
        ).length;

      const pauseCount = agentRows.filter(
        (row) =>
          String(row.status || "").toUpperCase() === "PAUSED" ||
          (row.pause && row.pause !== "-")
      ).length;

      const normalizedTopStatsMap = {
        ...topStatsMap,
        "Agents Logged In": topStatsMap["Agents Logged In"] || agentRows.length,
        "Agents In Calls": topStatsMap["Agents In Calls"] || countStatus("INCALL"),
        "Agents Waiting": topStatsMap["Agents Waiting"] || countStatus("READY"),
        "Paused Agents": topStatsMap["Paused Agents"] || pauseCount,
        "Agents In Dispo": topStatsMap["Agents In Dispo"] || countStatus("DISPO"),
        "Current Active Calls": topStatsMap["Current Active Calls"] || countStatus("INCALL"),
      };

      const topStatsChart = (dashboardData.topStats || []).map((item) => ({
        name: item.label.length > 18 ? `${item.label.slice(0, 18)}…` : item.label,
        value: (normalizedTopStatsMap[item.label] ?? Number(item.value)) || 0,
      }));

      const topStatsCards = (dashboardData.topStats || []).map((item) => {
        const safeValue =
          Number.isFinite(normalizedTopStatsMap[item.label])
            ? normalizedTopStatsMap[item.label]
            : Number.isFinite(Number(item.value))
              ? Number(item.value)
              : 0;

        return {
          key: item.label,
          label: topStatLabelsFr[item.label] || item.label,
          value: safeValue,
          icon: statIcons[item.label] || BarChart3,
          tone: item.tone || "cyan",
        };
      });

      const carrierPieData = (dashboardData.carrierStats || [])
        .filter((row) => row[0] !== "TOTALS")
        .map((row) => ({
          name: row[0],
          value: Number(row[1]) || 0,
        }));

      const agentCallsData = (dashboardData.agentRows || []).map((row) => ({
        name: row.user?.length > 10 ? `${row.user.slice(0, 10)}…` : row.user,
        calls: Number(row.calls) || 0,
        latency: parseInt(String(row.latency || "").replace("ms", ""), 10) || 0,
      }));

      const summaryMap = Object.fromEntries(dashboardData.summaryLines || []);
      const droppedPercent =
        parseFloat(String(summaryMap["Dropped Percent"] || "0").replace("%", "")) || 0;
      const avgAgents = parseFloat(String(summaryMap["Avg Agents"] || "0")) || 0;
      const avgWait = parseFloat(String(summaryMap["Agent Avg Wait"] || "0")) || 0;
      const avgCustTime = parseFloat(String(summaryMap["Avg CustTime"] || "0")) || 0;

      const serviceLevelData = [
        { name: "Dropped %", value: droppedPercent },
        { name: "Avg Agents", value: avgAgents },
        { name: "Avg Wait", value: avgWait },
        { name: "Avg CustTime", value: avgCustTime },
      ];

            const currentGraphsAgents = (dashboardData.agentRows || []).map((row) => {
        const pauseSeconds = toSeconds(row.pause);
        const loginSeconds = toSeconds(row.mmss);

        return {
          name: row.user?.length > 12 ? `${row.user.slice(0, 12)}…` : row.user,
          fullName: row.user || "",
          calls: Number(row.calls) || 0,
          minAppel: Number(row.calls) || 0,
          minPauses: pauseSeconds,
          minLogin: loginSeconds,
          pauseLabel: row.pause || "-",
          loginLabel: row.mmss || "-",
        };
      });

      const currentHistorySeries = (historyData || []).map((item) => ({
        label: item.label,
        totalCalls: item.totalCalls || 0,
        callsRinging: item.callsRinging || 0,
        agentsLogged: item.agentsLogged || 0,
        agentsInCalls: item.agentsInCalls || 0,
        agentsWaiting: item.agentsWaiting || 0,
        pausedAgents: item.pausedAgents || 0,
        agentsInDispo: item.agentsInDispo || 0,
        droppedPercent: item.droppedPercent || 0,
        avgWait: item.avgWait || 0,
        avgCustTime: item.avgCustTime || 0,
        answerRate: item.answerRate || 0,
        busyRate: item.busyRate || 0,
      }));

      const historyFirst = currentHistorySeries[0] || null;
      const historyLast = currentHistorySeries[currentHistorySeries.length - 1] || null;

      const deltaCards = historyFirst && historyLast
        ? [
            {
              key: "totalCalls",
              title: "Appels actifs moyens",
              value: historyLast.totalCalls,
              delta: formatDelta(historyLast.totalCalls - historyFirst.totalCalls),
              dataKey: "totalCalls",
            },
            {
              key: "callsRinging",
              title: "Appels en sonnerie",
              value: historyLast.callsRinging,
              delta: formatDelta(historyLast.callsRinging - historyFirst.callsRinging),
              dataKey: "callsRinging",
            },
            {
              key: "agentsLogged",
              title: "Agents connectés",
              value: historyLast.agentsLogged,
              delta: formatDelta(historyLast.agentsLogged - historyFirst.agentsLogged),
              dataKey: "agentsLogged",
            },
            {
              key: "droppedPercent",
              title: "Dropped %",
              value: historyLast.droppedPercent,
              delta: formatDelta(
                Number((historyLast.droppedPercent - historyFirst.droppedPercent).toFixed(2)),
                "%"
              ),
              suffix: "%",
              dataKey: "droppedPercent",
            },
          ]
        : [];

      const agentStateAreaData = currentHistorySeries.map((item) => ({
        label: item.label,
        agentsInCalls: item.agentsInCalls || 0,
        agentsWaiting: item.agentsWaiting || 0,
        pausedAgents: item.pausedAgents || 0,
        agentsInDispo: item.agentsInDispo || 0,
      }));

      const serviceMiniCards = historyFirst && historyLast
        ? [
            {
              key: "avgWait",
              title: "Attente moyenne",
              value: historyLast.avgWait,
              delta: formatDelta(Number((historyLast.avgWait - historyFirst.avgWait).toFixed(2)), "s"),
              suffix: "s",
              dataKey: "avgWait",
            },
            {
              key: "avgCustTime",
              title: "CustTime moyen",
              value: historyLast.avgCustTime,
              delta: formatDelta(
                Number((historyLast.avgCustTime - historyFirst.avgCustTime).toFixed(2)),
                "s"
              ),
              suffix: "s",
              dataKey: "avgCustTime",
            },
            {
              key: "answerRate",
              title: "Taux réponse",
              value: historyLast.answerRate,
              delta: formatDelta(
                Number((historyLast.answerRate - historyFirst.answerRate).toFixed(2)),
                "%"
              ),
              suffix: "%",
              dataKey: "answerRate",
            },
            {
              key: "busyRate",
              title: "Busy",
              value: historyLast.busyRate,
              delta: formatDelta(
                Number((historyLast.busyRate - historyFirst.busyRate).toFixed(2)),
                "%"
              ),
              suffix: "%",
              dataKey: "busyRate",
            },
          ]
        : [];

      const analyticsAgents = agentAnalytics?.agents || [];

      const utilizationByAgentData = [...analyticsAgents]
        .sort((a, b) => b.utilizationPct - a.utilizationPct)
        .slice(0, 8)
        .map((item) => ({
          name: item.agentUser?.length > 12 ? `${item.agentUser.slice(0, 12)}…` : item.agentUser,
          fullName: item.agentUser,
          utilizationPct: item.utilizationPct || 0,
          pausePct: item.pausePct || 0,
        }));

      const handledByAgentData = [...analyticsAgents]
        .sort((a, b) => b.callsHandled - a.callsHandled)
        .slice(0, 8)
        .map((item) => ({
          name: item.agentUser?.length > 12 ? `${item.agentUser.slice(0, 12)}…` : item.agentUser,
          fullName: item.agentUser,
          callsHandled: item.callsHandled || 0,
          avgLatencyMs: item.avgLatencyMs || 0,
        }));

      const statusDistributionData = agentAnalytics?.statusDistribution || [];

      const topPauseCodesData = (agentAnalytics?.topPauseCodes || []).map((item) => ({
        name: item.pauseCode?.length > 12 ? `${item.pauseCode.slice(0, 12)}…` : item.pauseCode,
        fullName: item.pauseCode,
        value: item.hits || 0,
      }));

      const headline = {
        totalCalls: normalizedTopStatsMap["Current Active Calls"] || 0,
        avgAnswerRate:
          parseFloat(
            String(
              (dashboardData.carrierStats || []).find((row) => row[0] === "ANSWER")?.[2] || "0"
            ).replace("%", "")
          ) || 0,
        avgWait: avgWait || 0,
        totalDropped: droppedPercent || 0,
        agentsLogged: normalizedTopStatsMap["Agents Logged In"] || 0,
        callsRinging: normalizedTopStatsMap["Calls Ringing"] || 0,
      };

      return {
        topStatsChart,
        topStatsCards,
        carrierPieData,
        agentCallsData,
        serviceLevelData,
        currentGraphsAgents,
        currentHistorySeries,
        deltaCards,
        agentStateAreaData,
        serviceMiniCards,
        utilizationByAgentData,
        handledByAgentData,
        statusDistributionData,
        topPauseCodesData,
        headline,
      };
      }, [dashboardData, historyData, agentAnalytics]);



  return (
    <div className="min-h-screen overflow-hidden bg-[#050912] text-slate-100">
      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:linear-gradient(rgba(0,240,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(0,240,255,0.08)_1px,transparent_1px)] [background-size:38px_38px]" />

      <motion.div
        className="pointer-events-none fixed left-0 right-0 top-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-70"
        animate={{ y: [0, 900, 0] }}
        transition={{ repeat: Infinity, duration: 7, ease: "linear" }}
      />

      <div className="relative z-10 flex h-screen flex-col">
        <header className="border-b border-cyan-500/20 bg-slate-950/90 px-5 py-3 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <motion.div
                initial={{ opacity: 0.7, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ repeat: Infinity, duration: 2.6, repeatType: "reverse" }}
                className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 shadow-[0_0_24px_rgba(34,211,238,0.15)]"
              >
                <div className="font-mono text-xs uppercase tracking-[0.35em] text-cyan-300">
                  ACTIVITY-DISPLAY
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-slate-400">
                  Console de supervision du centre d'appel
                </div>
              </motion.div>

              <div className="hidden h-8 w-px bg-cyan-500/20 md:block" />

              <div className="hidden font-mono text-[11px] uppercase tracking-[0.25em] text-slate-400 md:block">
                inspirée de Nexus pour les surfaces de rapport
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.75)]" />
                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-300">
                  {isRefreshing ? "Actualisation..." : "Flux en direct actif"}
                </span>
              </div>

              <div className="rounded-xl border border-cyan-500/20 bg-slate-900/70 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-200">
                {clock}
              </div>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="w-[240px] shrink-0 border-r border-cyan-500/20 bg-slate-950/80 p-4 backdrop-blur-xl">
            <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.35em] text-slate-500">
              Navigation
            </div>

            <div className="space-y-2">
              {sidebarItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSidebar === item.key;

                return (
                  <motion.button
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.99 }}
                    key={item.key}
                    onClick={() => setActiveSidebar(item.key)}
                    className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200 shadow-[inset_0_0_30px_rgba(34,211,238,0.08)]"
                        : "border-transparent bg-white/[0.02] text-slate-400 hover:border-cyan-500/20 hover:bg-cyan-500/5 hover:text-slate-100"
                    }`}
                  >
                    <span className={`rounded-xl p-2 ${isActive ? "bg-cyan-400/15" : "bg-slate-800/70"}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 font-medium">{item.label}</span>
                    <ChevronRight
                      className={`h-4 w-4 transition ${
                        isActive ? "text-cyan-300" : "text-slate-600 group-hover:text-cyan-300"
                      }`}
                    />
                  </motion.button>
                );
              })}
            </div>

            <div className="mt-8 rounded-3xl border border-cyan-500/15 bg-slate-900/70 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-slate-500">
                Rapports
              </div>

              <div className="mt-3 space-y-2 text-sm">
                <button
                  onClick={() => setActiveReportLink("summary")}
                  className={`block w-full rounded-xl px-3 py-2 text-left ${
                    activeReportLink === "summary"
                      ? "bg-cyan-400/10 text-cyan-200"
                      : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-100"
                  }`}
                >
                  Résumé du rapport principal
                </button>

                <button
                  onClick={() => setActiveReportLink("live-board")}
                  className={`block w-full rounded-xl px-3 py-2 text-left ${
                    activeReportLink === "live-board"
                      ? "bg-cyan-400/10 text-cyan-200"
                      : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-100"
                  }`}
                >
                  Graphes Courants
                </button>

                <button
                  onClick={() => setActiveReportLink("agents-table")}
                  className={`block w-full rounded-xl px-3 py-2 text-left ${
                    activeReportLink === "agents-table"
                      ? "bg-cyan-400/10 text-cyan-200"
                      : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-100"
                  }`}
                >
                  Temps d'appel des agents
                </button>

                <button
                  onClick={() => setActiveReportLink("dashboards")}
                  className={`block w-full rounded-xl px-3 py-2 text-left ${
                    activeReportLink === "dashboards"
                      ? "bg-cyan-400/10 text-cyan-200"
                      : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-100"
                  }`}
                >
                  Tableaux de bord
                </button>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-auto p-5">
            <div className="mx-auto max-w-[1600px] space-y-5">
              {loading && (
                <section className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-8 text-center backdrop-blur-xl">
                  <div className="font-mono text-sm uppercase tracking-[0.25em] text-cyan-300">
                    Chargement du rapport en direct...
                  </div>
                </section>
              )}

              {error && (
                <section className="rounded-[28px] border border-red-500/30 bg-red-500/10 p-4 text-red-200">
                  {error}
                </section>
              )}

              {!loading && dashboardData && activeReportLink === "live-board" && chartsData && (
                <>
                  <section className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 shadow-[0_0_35px_rgba(34,211,238,0.06)] backdrop-blur-xl">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h1 className="font-mono text-lg uppercase tracking-[0.22em] text-cyan-200">
                          {reportTitle}
                        </h1>
                        <p className="mt-1 text-sm text-slate-400">
                          Vue dédiée aux graphes courants avec contrôle de granularité et intervalle temporel.
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-[auto_auto_auto]">
                        <div>
                          <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                            Mode
                          </div>
                          <select
                            value={graphMode}
                            onChange={(e) => setGraphMode(e.target.value)}
                            className="rounded-xl border border-cyan-500/20 bg-slate-900/80 px-3 py-2 text-sm text-cyan-100 outline-none"
                          >
                            {["Sec", "Min", "HH", "DD", "W", "MM", "YYYY"].map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                            Start date
                          </div>
                          <input
                            type="datetime-local"
                            value={graphStart}
                            onChange={(e) => setGraphStart(e.target.value)}
                            className="rounded-xl border border-cyan-500/20 bg-slate-900/80 px-3 py-2 text-sm text-cyan-100 outline-none"
                          />
                        </div>

                        <div>
                          <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                            End date
                          </div>
                          <input
                            type="datetime-local"
                            value={graphEnd}
                            onChange={(e) => setGraphEnd(e.target.value)}
                            className="rounded-xl border border-cyan-500/20 bg-slate-900/80 px-3 py-2 text-sm text-cyan-100 outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-4">
                      <div>
                        <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          Mode
                        </label>
                        <select
                          value={graphMode}
                          onChange={(e) => setGraphMode(e.target.value)}
                          className="w-full rounded-2xl border border-cyan-500/20 bg-slate-950/70 px-4 py-3 text-slate-200 outline-none"
                        >
                          {["Sec", "Min", "HH", "DD", "W", "MM", "YYYY"].map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          Start date
                        </label>
                        <input
                          type="datetime-local"
                          value={graphStart}
                          onChange={(e) => setGraphStart(e.target.value)}
                          className="w-full rounded-2xl border border-cyan-500/20 bg-slate-950/70 px-4 py-3 text-slate-200 outline-none"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          End date
                        </label>
                        <input
                          type="datetime-local"
                          value={graphEnd}
                          onChange={(e) => setGraphEnd(e.target.value)}
                          className="w-full rounded-2xl border border-cyan-500/20 bg-slate-950/70 px-4 py-3 text-slate-200 outline-none"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          Data source
                        </label>
                        <select
                          value={dataSource}
                          onChange={(e) => setDataSource(e.target.value)}
                          className="w-full rounded-2xl border border-cyan-500/20 bg-slate-950/70 px-4 py-3 text-slate-200 outline-none"
                        >
                          <option value="realtime">RealTime</option>
                          <option value="record">Record</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Dernière actualisation des données : {dashboardData.updatedAt}
                    </div>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {chartsData.topStatsCards.map((card) => (
                      <DashboardKpiCard
                        key={card.key}
                        label={card.label}
                        value={card.value}
                        icon={card.icon}
                      />
                    ))}
                  </section>

                  <section className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <ChartHeader
                        icon={PhoneCall}
                        title="Nombre d'appels passés par agent"
                        printTargetId="print-agent-calls-chart"
                        printTitle="Nombre d'appels passés par agent"
                      />
                      <div id="print-agent-calls-chart">
                        <div className="h-[320px]">
                      <div className="mb-4 flex items-center gap-2">
                        <PhoneCall className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.currentGraphsAgents}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="name" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              formatter={(value) => [value, "Appels"]}
                              labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="calls" name="Appels" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    </div>
                      </div>

                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <ChartHeader
                        icon={Clock3}
                        title="Évolution temporelle // Intervalle sélectionné"
                        printTargetId="print-history-chart"
                        printTitle="Évolution temporelle"
                      />

                      <div id="print-history-chart">
                        <div className="h-[320px]">
                      <div className="mb-4 flex items-center gap-2">
                        <Clock3 className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartsData.currentHistorySeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="label" stroke="#94a3b8" />
                            <YAxis yAxisId="main" stroke="#94a3b8" />
                            <YAxis yAxisId="rate" orientation="right" stroke="#94a3b8" domain={[0, "auto"]} />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Line yAxisId="main" type="monotone" dataKey="agentsLogged" name="Agents connectés" stroke="#10b981" strokeWidth={2} dot={false} />
                            <Line yAxisId="main" type="monotone" dataKey="totalCalls" name="Appels actifs" stroke="#22d3ee" strokeWidth={2.5} dot={false} />
                            <Line yAxisId="main" type="monotone" dataKey="callsRinging" name="Appels en sonnerie" stroke="#38bdf8" strokeWidth={2} dot={false} />
                            <Line yAxisId="rate" type="monotone" dataKey="droppedPercent" name="Dropped %" stroke="#f59e0b" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    </div></div>
                  </section>

                  {dataSource === "record" && chartsData.currentHistorySeries.length > 1 && (
                    <section className="mt-5 grid gap-5">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {chartsData.deltaCards.map((card) => (
                          <TinyTrendCard
                            key={card.key}
                            title={card.title}
                            value={card.value}
                            delta={card.delta}
                            suffix={card.suffix || ""}
                            dataKey={card.dataKey}
                            data={chartsData.currentHistorySeries}
                          />
                        ))}
                      </div>

                      <div className="grid gap-5 xl:grid-cols-2">
                        <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                          <ChartHeader
                            icon={Users}
                            title="Répartition des états agents // période"
                            printTargetId="print-agent-state-area"
                            printTitle="Répartition des états agents"
                          />
                          <div id="print-history-chart">
                          <div className="h-[320px]">
                          <div className="mb-4 flex items-center gap-2">
                            <Users className="h-5 w-5 text-cyan-300" />
                            <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                              
                            </h2>
                          </div>

                          <div className="h-[320px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={chartsData.agentStateAreaData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                                <XAxis dataKey="label" stroke="#94a3b8" />
                                <YAxis stroke="#94a3b8" />
                                <Tooltip
                                  contentStyle={{
                                    background: "#020617",
                                    border: "1px solid rgba(34,211,238,0.25)",
                                    borderRadius: "16px",
                                    color: "#e2e8f0",
                                  }}
                                />
                                <Legend />
                                <Area type="monotone" dataKey="agentsInCalls" name="Agents en appels" stackId="1" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.45} />
                                <Area type="monotone" dataKey="agentsWaiting" name="Agents en attente" stackId="1" stroke="#84cc16" fill="#84cc16" fillOpacity={0.45} />
                                <Area type="monotone" dataKey="pausedAgents" name="Agents en pause" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.45} />
                                <Area type="monotone" dataKey="agentsInDispo" name="Agents en dispo" stackId="1" stroke="#eab308" fill="#eab308" fillOpacity={0.45} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div></div></div>

                        <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                          <div className="mb-4 flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-cyan-300" />
                            <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                              KPI service // mini tendances
                            </h2>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            {chartsData.serviceMiniCards.map((card) => (
                              <TinyTrendCard
                                key={card.key}
                                title={card.title}
                                value={card.value}
                                delta={card.delta}
                                suffix={card.suffix || ""}
                                dataKey={card.dataKey}
                                data={chartsData.currentHistorySeries}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  <section className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                    <div className="mb-4 flex items-center gap-2">
                      <Users className="h-5 w-5 text-cyan-300" />
                      <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                        Détail agents // valeurs courantes
                      </h2>
                    </div>

                    <div className="overflow-auto rounded-2xl border border-white/5">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-950/90 text-slate-300">
                          <tr>
                            <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Agent</th>
                            <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Appels</th>
                            <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Pause</th>
                            <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Temps login</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chartsData.currentGraphsAgents.map((row, index) => (
                            <tr
                              key={`${row.fullName}-${index}`}
                              className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-transparent"}
                            >
                              <td className="px-3 py-2 text-slate-200">{row.fullName}</td>
                              <td className="px-3 py-2 font-mono text-cyan-300">{row.calls}</td>
                              <td className="px-3 py-2 font-mono text-amber-300">{row.pauseLabel}</td>
                              <td className="px-3 py-2 font-mono text-indigo-300">{row.loginLabel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <Users className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Tendances agents // intervalle
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartsData.currentHistorySeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="label" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="agentsInCalls" name="Agents en appels" stroke="#22d3ee" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="agentsWaiting" name="Agents en attente" stroke="#84cc16" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="pausedAgents" name="Agents en pause" stroke="#f59e0b" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="agentsInDispo" name="Agents en dispo" stroke="#eab308" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Service level // intervalle
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartsData.currentHistorySeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="label" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="answerRate" name="Taux réponse %" stroke="#22d3ee" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="busyRate" name="Busy %" stroke="#6366f1" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="avgWait" name="Attente moyenne" stroke="#f59e0b" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="avgCustTime" name="CustTime moyen" stroke="#10b981" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                                    </section>

                  <section className="grid gap-5 xl:grid-cols-2">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <ChartHeader
                        icon={TrendingUp}
                        title="Utilisation et pause par agent // période"
                        printTargetId="print-utilisation-pause"
                        printTitle="Utilisation et pause par agent"
                      />

                      <div id="print-utilisation-pause" className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.utilizationByAgentData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="name" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="utilizationPct" name="Utilisation %" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                            <Bar dataKey="pausePct" name="Pause %" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <ChartHeader
                        icon={Users}
                        title="Répartition des statuts // période"
                        printTargetId="print-status-distribution"
                        printTitle="Répartition des statuts"
                      />

                      <div id="print-status-distribution" className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={chartsData.statusDistributionData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={55}
                              outerRadius={105}
                              paddingAngle={3}
                            >
                              {chartsData.statusDistributionData.map((entry, index) => (
                                <Cell key={`${entry.name}-${index}`} fill={chartPalette[index % chartPalette.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-5 xl:grid-cols-2">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <ChartHeader
                        icon={PhoneCall}
                        title="Appels traités par agent // période"
                        printTargetId="print-handled-calls"
                        printTitle="Appels traités par agent"
                      />

                      <div id="print-handled-calls" className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.handledByAgentData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="name" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="callsHandled" name="Appels traités" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <ChartHeader
                        icon={ShieldCheck}
                        title="Codes pause dominants // période"
                        printTargetId="print-pause-codes"
                        printTitle="Codes pause dominants"
                      />

                      <div id="print-pause-codes" className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.topPauseCodesData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="name" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="value" name="Occurrences" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </section>

                </>
              )}

              {!loading && dashboardData && activeReportLink === "summary" && (
                <>
                  <section className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 shadow-[0_0_35px_rgba(34,211,238,0.06)] backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h1 className="font-mono text-lg uppercase tracking-[0.22em] text-cyan-200">
                          {reportTitle}
                        </h1>
                        <p className="mt-1 text-sm text-slate-400">
                          Mise en page de supervision inspirée de VICIdial, intégrée dans la coque Activity-Display.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                        {reportOptions.map((option) => (
                          <button
                            key={option}
                            className="rounded-full border border-cyan-500/15 bg-cyan-500/5 px-3 py-1.5 transition hover:border-cyan-400/35 hover:bg-cyan-400/10 hover:text-cyan-200"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Dernière actualisation des données : {dashboardData.updatedAt}
                    </div>

                    <div className="mt-5 grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
                      <div className="rounded-3xl border border-cyan-500/15 bg-slate-900/70 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="font-mono text-xs uppercase tracking-[0.28em] text-cyan-300">
                            Résumé système
                          </div>

                          <button
                            onClick={() => setShowSummarySystem((prev) => !prev)}
                            className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-cyan-400/35 hover:bg-cyan-400/10 hover:text-cyan-200"
                          >
                            {showSummarySystem ? "Réduire" : "Afficher"}
                          </button>
                        </div>

                        {showSummarySystem && (
                          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-4">
                            {dashboardData.summaryLines.map(([label, value]) => (
                              <div
                                key={label}
                                className="rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-2"
                              >
                                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                                  {label}
                                </div>
                                <div className="mt-1 font-mono text-sm text-slate-100">{value}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-3xl border border-cyan-500/15 bg-slate-900/70 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="font-mono text-xs uppercase tracking-[0.28em] text-cyan-300">
                            Statistiques opérateur
                          </div>

                          <button
                            onClick={() => setShowOperatorStats((prev) => !prev)}
                            className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-300 transition hover:border-cyan-400/35 hover:bg-cyan-400/10 hover:text-cyan-200"
                          >
                            {showOperatorStats ? "Réduire" : "Afficher"}
                          </button>
                        </div>

                        {showOperatorStats && (
                          <>
                            <div className="mb-3 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                              Statut de raccrochage / 24 heures / 6 heures / 1 heure / 15 min / 1 min
                            </div>

                            <div className="overflow-auto rounded-2xl border border-white/5">
                              <table className="min-w-full text-left text-xs">
                                <thead className="bg-slate-950/90 text-slate-300">
                                  <tr>
                                    <th className="px-3 py-2 font-mono uppercase tracking-[0.16em]">
                                      Statut de raccrochage
                                    </th>
                                    <th className="px-3 py-2">24H</th>
                                    <th className="px-3 py-2">%</th>
                                    <th className="px-3 py-2">6H</th>
                                    <th className="px-3 py-2">%</th>
                                    <th className="px-3 py-2">1H</th>
                                    <th className="px-3 py-2">%</th>
                                    <th className="px-3 py-2">15M</th>
                                    <th className="px-3 py-2">%</th>
                                    <th className="px-3 py-2">1M</th>
                                    <th className="px-3 py-2">%</th>
                                  </tr>
                                </thead>

                                <tbody>
                                  {dashboardData.carrierStats.map((row, index) => (
                                    <tr
                                      key={row[0]}
                                      className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-transparent"}
                                    >
                                      {row.map((cell, i) => (
                                        <td
                                          key={`${row[0]}-${i}`}
                                          className={`px-3 py-2 ${
                                            i === 0
                                              ? "font-semibold text-slate-200"
                                              : "font-mono text-slate-400"
                                          }`}
                                        >
                                          {cell}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {chartsData.topStatsCards.map((card) => (
                      <DashboardKpiCard
                        key={card.key}
                        label={card.label}
                        value={card.value}
                        icon={card.icon}
                      />
                    ))}
                  </section>


                  <section className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                            Temps d'appel des agents par campagne
                          </h2>
                          <p className="mt-1 text-sm text-slate-400">
                            Tableau de roster en direct, basé sur les captures du rapport et relooké pour la coque Activity-Display.
                          </p>
                        </div>

                        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-slate-300">
                          {dashboardData.updatedAt}
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-3xl border border-cyan-500/15 bg-slate-900/70">
                        <div className="overflow-auto">
                          <table className="min-w-full text-left text-xs">
                            <thead className="bg-slate-950/90 text-slate-300">
                              <tr>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Station</th>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Utilisateur</th>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Session</th>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Campagne</th>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Statut</th>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Pause</th>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Temps</th>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Appels</th>
                                <th className="px-3 py-3 font-mono uppercase tracking-[0.16em]">Latency</th>
                              </tr>
                            </thead>

                            <tbody>
                              {dashboardData.agentRows.map((row, index) => (
                                <tr
                                  key={`${row.station}-${row.sessionId}-${index}`}
                                  className={`${index % 2 === 0 ? "bg-white/[0.02]" : "bg-transparent"} transition`}
                                >
                                  <td className="px-3 py-2 font-mono text-slate-300">{row.station}</td>
                                  <td className="px-3 py-2 text-slate-200">{row.user}</td>
                                  <td className="px-3 py-2 font-mono text-slate-400">{row.sessionId}</td>
                                  <td className="px-3 py-2 font-mono text-cyan-300">{row.campaign}</td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${rowColor(
                                        row.color
                                      )}`}
                                    >
                                      {row.status}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-mono text-slate-400">{row.pause || "-"}</td>
                                  <td className="px-3 py-2 font-mono text-slate-400">{row.mmss}</td>
                                  <td className="px-3 py-2 font-mono text-slate-200">{row.calls}</td>
                                  <td className="px-3 py-2 font-mono text-slate-400">{row.latency}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                        <div className="mb-4 flex items-center gap-2">
                          <BarChart3 className="h-5 w-5 text-cyan-300" />
                          <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                            Répartition opérateurs
                          </h2>
                        </div>

                        <div className="h-[250px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartsData.agentCallsData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                              <XAxis dataKey="name" stroke="#94a3b8" />
                              <YAxis stroke="#94a3b8" />
                              <Tooltip
                                contentStyle={{
                                  background: "#020617",
                                  border: "1px solid rgba(34,211,238,0.25)",
                                  borderRadius: "16px",
                                  color: "#e2e8f0",
                                }}
                              />
                              <Legend />
                              <Bar dataKey="calls" name="Appels" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                        <div className="mb-4 flex items-center gap-2">
                          <BellRing className="h-5 w-5 text-cyan-300" />
                          <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                            Répartition statuts d'appel
                          </h2>
                        </div>

                        <div className="h-[250px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={chartsData.carrierPieData}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={55}
                                outerRadius={95}
                                paddingAngle={3}
                              >
                                {chartsData.carrierPieData.map((entry, index) => (
                                  <Cell key={entry.name} fill={chartPalette[index % chartPalette.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{
                                  background: "#020617",
                                  border: "1px solid rgba(34,211,238,0.25)",
                                  borderRadius: "16px",
                                  color: "#e2e8f0",
                                }}
                              />
                              <Legend />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </section>
                </>
              )}

              {!loading && dashboardData && isDashboardsView && chartsData && (
                <>
                  <section className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 shadow-[0_0_35px_rgba(34,211,238,0.06)] backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h1 className="font-mono text-lg uppercase tracking-[0.22em] text-cyan-200">
                          {reportTitle}
                        </h1>
                        <p className="mt-1 text-sm text-slate-400">
                          Vue analytique en direct basée sur les données live actuellement récupérées depuis VICIdial.
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Dernière actualisation des données : {dashboardData.updatedAt}
                    </div>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {chartsData.topStatsCards.map((card) => (
                      <DashboardKpiCard
                        key={card.key}
                        label={card.label}
                        value={card.value}
                        icon={card.icon}
                      />
                    ))}
                  </section>

                  <section className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Volume des appels
                        </h2>
                      </div>

                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.topStatsChart}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="name" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="value" name="Valeur" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <Clock3 className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Service level
                        </h2>
                      </div>

                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.serviceLevelData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="name" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="value" name="Mesure" fill="#38bdf8" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <RadioTower className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Comparative agents
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.agentCallsData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                            <XAxis dataKey="name" stroke="#94a3b8" />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                            <Bar dataKey="calls" name="Appels" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                            <Bar dataKey="latency" name="Latency" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Répartition statuts d'appel
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={chartsData.carrierPieData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={55}
                              outerRadius={105}
                              paddingAngle={3}
                            >
                              {chartsData.carrierPieData.map((entry, index) => (
                                <Cell key={entry.name} fill={chartPalette[index % chartPalette.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                background: "#020617",
                                border: "1px solid rgba(34,211,238,0.25)",
                                borderRadius: "16px",
                                color: "#e2e8f0",
                              }}
                            />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}