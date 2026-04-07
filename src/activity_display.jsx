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

function DashboardKpiCard({ label, value, hint }) {
  return (
    <div className="rounded-[24px] border border-cyan-500/20 bg-slate-950/60 p-4 backdrop-blur-xl">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-3 font-mono text-3xl text-cyan-200">{value}</div>
      {hint ? <div className="mt-2 text-sm text-slate-400">{hint}</div> : null}
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
  const [historyRange, setHistoryRange] = useState("daily");

  const isDashboardsView = activeReportLink === "dashboards";

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
    const interval = setInterval(() => loadData(false), 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const reportTitle = useMemo(() => {
    if (activeReportLink === "summary") return "Rapport principal en temps réel";
    if (activeReportLink === "live-board") return "Rapport principal en temps réel // Tableau en direct";
    if (activeReportLink === "agents-table") return "Rapport principal en temps réel // Temps d'appel des agents";
    if (activeReportLink === "dashboards") return "Tableaux de bord // Analytique des rapports";
    return `Rapport principal en temps réel // ${activeReportLink.replaceAll("-", " ")}`;
  }, [activeReportLink]);

  const chartsData = useMemo(() => {
    if (!dashboardData) return null;

    const topStatsChart = dashboardData.topStats.map((item) => ({
      name: item.label
        .replace(" d'agents", "")
        .replace(" actuels", "")
        .replace("Appels de file de ", "File "),
      value: item.value,
    }));

    const carrierPieData = dashboardData.carrierStats
      .filter((row) => row[0] !== "TOTALS")
      .map((row) => ({ name: row[0], value: Number(row[1]) || 0 }));

    const agentCallsData = dashboardData.agentRows.map((row) => ({
      name: row.user.length > 10 ? `${row.user.slice(0, 10)}…` : row.user,
      calls: row.calls,
      latency: parseInt(String(row.latency).replace("ms", ""), 10),
    }));

    const summaryChart = dashboardData.summaryLines
      .filter(([, value]) => !Number.isNaN(Number(String(value).replace("%", "").replace(/[^0-9.]/g, ""))))
      .slice(0, 6)
      .map(([label, value]) => ({
        name: label,
        value: Number(String(value).replace("%", "").replace(/[^0-9.]/g, "")),
      }));

    const historySource =
      historyRange === "weekly" ? dashboardData.historical?.weekly ?? [] : dashboardData.historical?.daily ?? [];

    const callVolumeTrend = historySource.map((item) => ({
      label: item.label,
      totalCalls: item.totalCalls,
      answered: item.answered,
      busy: item.busy,
      dropped: item.dropped,
    }));

    const serviceTrend = historySource.map((item) => ({
      label: item.label,
      answerRate: item.answerRate,
      dropRate: item.dropRate,
      avgWait: item.avgWait,
      avgHandle: item.avgHandle,
    }));

    const campaignComparison = (dashboardData.historical?.campaigns ?? []).map((item) => ({
      name: item.name,
      calls: item.calls,
      answerRate: item.answerRate,
      avgWait: item.avgWait,
    }));

    const headline = historySource.length
      ? {
          totalCalls: historySource.reduce((sum, item) => sum + item.totalCalls, 0),
          avgAnswerRate: (
            historySource.reduce((sum, item) => sum + item.answerRate, 0) / historySource.length
          ).toFixed(1),
          avgWait: Math.round(
            historySource.reduce((sum, item) => sum + item.avgWait, 0) / historySource.length
          ),
          totalDropped: historySource.reduce((sum, item) => sum + item.dropped, 0),
        }
      : {
          totalCalls: 0,
          avgAnswerRate: "0.0",
          avgWait: 0,
          totalDropped: 0,
        };

    return {
      topStatsChart,
      carrierPieData,
      agentCallsData,
      summaryChart,
      callVolumeTrend,
      serviceTrend,
      campaignComparison,
      headline,
    };
  }, [dashboardData, historyRange]);

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
                Coque de tableau de bord inspirée de Nexus pour les surfaces de rapport
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
                  Tableau en direct
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

              {!loading && dashboardData && !isDashboardsView && (
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
                        <div className="mb-3 font-mono text-xs uppercase tracking-[0.28em] text-cyan-300">
                          Résumé système
                        </div>

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
                      </div>

                      <div className="rounded-3xl border border-cyan-500/15 bg-slate-900/70 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="font-mono text-xs uppercase tracking-[0.28em] text-cyan-300">
                            Statistiques opérateur
                          </div>
                          <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500">
                            Statut de raccrochage / 24 heures / 6 heures / 1 heure / 15 min / 1 min
                          </div>
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
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
                    {dashboardData.topStats.map((stat, index) => {
                      const Icon = statIcons[stat.label] || PhoneCall;

                      return (
                        <motion.div
                          key={stat.label}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.03 }}
                          className={`rounded-[24px] border bg-gradient-to-br p-4 shadow-2xl ${toneClasses(
                            stat.tone
                          )}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="max-w-[150px] text-[11px] uppercase tracking-[0.18em] text-slate-300">
                                {stat.label}
                              </div>
                              <div className="mt-3 font-mono text-4xl leading-none text-white">
                                {stat.value}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <Icon className="h-5 w-5 text-white" />
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
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
                          Vue analytique pour faire ressortir les tendances journalières et hebdomadaires invisibles dans les tables live.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setHistoryRange("daily")}
                          className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                            historyRange === "daily"
                              ? "border border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                              : "border border-cyan-500/15 bg-cyan-500/5 text-slate-400 hover:text-slate-100"
                          }`}
                        >
                          Daily
                        </button>

                        <button
                          onClick={() => setHistoryRange("weekly")}
                          className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                            historyRange === "weekly"
                              ? "border border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                              : "border border-cyan-500/15 bg-cyan-500/5 text-slate-400 hover:text-slate-100"
                          }`}
                        >
                          Weekly
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Dernière actualisation des données : {dashboardData.updatedAt}
                    </div>
                  </section>

                  <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <DashboardKpiCard
                      label={historyRange === "daily" ? "Total appels 7 jours" : "Total appels 6 semaines"}
                      value={chartsData.headline.totalCalls.toLocaleString("fr-FR")}
                    />
                    <DashboardKpiCard
                      label="Taux de réponse moyen"
                      value={`${chartsData.headline.avgAnswerRate}%`}
                    />
                    <DashboardKpiCard
                      label="Temps d'attente moyen"
                      value={`${chartsData.headline.avgWait}s`}
                    />
                    <DashboardKpiCard
                      label="Total appels abandonnés"
                      value={chartsData.headline.totalDropped.toLocaleString("fr-FR")}
                    />
                  </section>

                  <section className="grid gap-5 xl:grid-cols-2">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Volume des appels
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.callVolumeTrend}>
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
                            <Bar dataKey="totalCalls" name="Total appels" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                            <Bar dataKey="answered" name="Répondus" fill="#10b981" radius={[8, 8, 0, 0]} />
                            <Bar dataKey="busy" name="Busy" fill="#6366f1" radius={[8, 8, 0, 0]} />
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

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartsData.serviceTrend}>
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
                            <Line
                              type="monotone"
                              dataKey="answerRate"
                              name="Taux réponse %"
                              stroke="#22d3ee"
                              strokeWidth={3}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="dropRate"
                              name="Taux abandon %"
                              stroke="#f59e0b"
                              strokeWidth={3}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="avgWait"
                              name="Attente moyenne s"
                              stroke="#a855f7"
                              strokeWidth={3}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <RadioTower className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Comparatif campagnes
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartsData.campaignComparison}>
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
                            <Bar dataKey="calls" name="Appels" fill="#38bdf8" radius={[8, 8, 0, 0]} />
                            <Bar dataKey="avgWait" name="Attente moyenne" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-cyan-500/20 bg-slate-950/60 p-5 backdrop-blur-xl">
                      <div className="mb-4 flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-cyan-300" />
                        <h2 className="font-mono text-sm uppercase tracking-[0.24em] text-cyan-200">
                          Répartition campagnes
                        </h2>
                      </div>

                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={chartsData.campaignComparison}
                              dataKey="calls"
                              nameKey="name"
                              innerRadius={70}
                              outerRadius={110}
                              paddingAngle={3}
                            >
                              {chartsData.campaignComparison.map((entry, index) => (
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