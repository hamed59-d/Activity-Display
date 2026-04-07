function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomLatency() {
  return `${randomInt(55, 110)}ms`;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const baseAgents = [
  { station: "SIP/8106", user: "Radwane", sessionId: "9600006", campaign: "NRJCAMP" },
  { station: "SIP/8114", user: "AMAL BELGHITH", sessionId: "9600012", campaign: "NRJCAMP" },
  { station: "SIP/8204", user: "Christiane", sessionId: "9600013", campaign: "NRJCAMP" },
  { station: "SIP/8110", user: "Lilia", sessionId: "9600017", campaign: "NRJCAMP" },
  { station: "SIP/8202", user: "AMMED", sessionId: "9600016", campaign: "NRJCAMP" },
  { station: "SIP/8112", user: "ALI", sessionId: "9600018", campaign: "NRJCAMP" },
  { station: "SIP/8109", user: "Marwa Jdajilia", sessionId: "9600000", campaign: "NRJCAMP" },
  { station: "SIP/8102", user: "leila", sessionId: "9600010", campaign: "NRJCAMP" },
  { station: "SIP/8203", user: "Jacque-guest", sessionId: "9600008", campaign: "NRJCAMP" },
  { station: "SIP/8105", user: "Nawres", sessionId: "9600009", campaign: "NRJCAMP" },
];

function buildAgents() {
  return baseAgents.map((agent, index) => {
    const ready = index === 0;
    const longPaused = index === 1;
    const softPaused = index === 9;

    let status = "PAUSED";
    let pause = "DB";
    let color = "paused";
    let mmss = `1:${String(randomInt(10, 59)).padStart(2, "0")}`;

    if (ready) {
      status = "READY";
      pause = "";
      color = "ready";
      mmss = `1:${String(randomInt(0, 10)).padStart(2, "0")}`;
    } else if (longPaused) {
      status = "PAUSED";
      pause = "DB";
      color = "paused-long";
      mmss = `${randomInt(10, 18)}:${String(randomInt(0, 59)).padStart(2, "0")}`;
    } else if (softPaused) {
      status = "PAUSED";
      pause = "DB";
      color = "paused-soft";
      mmss = `0:${String(randomInt(10, 59)).padStart(2, "0")}`;
    } else {
      pause = randomChoice(["DB", "DB", "DB", "PDEJ"]);
    }

    return {
      ...agent,
      status,
      pause,
      mmss,
      calls: randomInt(17, 45),
      inbound: 0,
      latency: randomLatency(),
      hold: "",
      inGroup: "",
      color,
    };
  });
}

function buildCarrierStats() {
  const answer24 = randomInt(24400, 24750);
  const busy24 = randomInt(27600, 28050);
  const cancel24 = randomInt(40, 60);
  const chan24 = randomInt(560, 620);
  const congestion24 = randomInt(28, 40);
  const noanswer24 = randomInt(45, 65);

  const total24 = answer24 + busy24 + cancel24 + chan24 + congestion24 + noanswer24;

  return [
    ["ANSWER", answer24, "46.3%", randomInt(6100, 6200), "45.1%", randomInt(4000, 4100), "44.7%", randomInt(980, 1030), "43.3%", randomInt(10, 18), "43.3%"],
    ["BUSY", busy24, "52.3%", randomInt(7400, 7500), "54.5%", randomInt(4950, 5050), "55.0%", randomInt(1290, 1340), "56.5%", randomInt(14, 21), "56.7%"],
    ["CANCEL", cancel24, "0.1%", randomInt(8, 15), "0.1%", randomInt(2, 5), "0.0%", randomInt(0, 2), "0.1%", 0, "0.0%"],
    ["CHANUNAVAIL", chan24, "1.1%", randomInt(28, 38), "0.2%", randomInt(15, 24), "0.2%", randomInt(2, 4), "0.1%", 0, "0.0%"],
    ["CONGESTION", congestion24, "0.1%", randomInt(1, 4), "0.0%", randomInt(1, 3), "0.0%", randomInt(0, 2), "0.0%", 0, "0.0%"],
    ["NOANSWER", noanswer24, "0.1%", randomInt(2, 5), "0.0%", randomInt(1, 3), "0.0%", 0, "0.0%", 0, "0.0%"],
    ["TOTALS", total24, "", randomInt(13600, 13750), "", randomInt(9000, 9100), "", randomInt(2330, 2370), "", randomInt(28, 32), ""],
  ];
}

function buildSummary(nowString) {
  return [
    ["Dial Level", String(randomInt(8300, 8350))],
    ["Calls Today", String(randomInt(13500, 13650))],
    ["Avg Agents", (1.3 + Math.random() * 0.4).toFixed(2)],
    ["Time", nowString],
    ["Hopper ( min/auto )", "3200 / 0"],
    ["Dropped / Total", `${randomInt(20, 35)}.000 / ${randomInt(13500, 13650)}`],
    ["DL Diff", (Math.random() * 0.2).toFixed(2)],
    ["Statuses", "AB, AA, NEW, PDROP, DROP"],
    ["Leads In Hopper", String(randomInt(1450, 1600))],
    ["Dropped Percent", `${(0.1 + Math.random() * 0.2).toFixed(2)}%`],
    ["Diff", `${(7.5 + Math.random()).toFixed(2)}%`],
    ["Order", "DOWN LAST CALL TIME"],
    ["Agent Avg Wait", String(randomInt(55, 70))],
    ["Avg CustTime", String(randomInt(35, 45))],
    ["Avg ACW", String(randomInt(12, 18))],
    ["Avg Pause", String(randomInt(28, 35))],
  ];
}

function formatDayLabel(date) {
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

function formatWeekLabel(date) {
  return `S${getWeekNumber(date)}`;
}

function getWeekNumber(date) {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  return Math.ceil((((current - yearStart) / 86400000) + 1) / 7);
}

function buildDailyHistory(days = 7) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - index));

    const totalCalls = randomInt(11800, 14800);
    const answered = Math.round(totalCalls * (0.43 + Math.random() * 0.08));
    const busy = Math.round(totalCalls * (0.42 + Math.random() * 0.08));
    const noAnswer = Math.round(totalCalls * (0.004 + Math.random() * 0.01));
    const dropped = Math.round(totalCalls * (0.001 + Math.random() * 0.004));
    const avgWait = randomInt(48, 84);
    const avgHandle = randomInt(160, 280);
    const pausedAgents = randomInt(3, 7);
    const activeAgents = randomInt(7, 10);

    return {
      label: formatDayLabel(date),
      date: date.toISOString().slice(0, 10),
      totalCalls,
      answered,
      busy,
      noAnswer,
      dropped,
      answerRate: Number(((answered / totalCalls) * 100).toFixed(1)),
      dropRate: Number(((dropped / totalCalls) * 100).toFixed(2)),
      avgWait,
      avgHandle,
      pausedAgents,
      activeAgents,
    };
  });
}

function buildWeeklyHistory(weeks = 6) {
  return Array.from({ length: weeks }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (7 * (weeks - 1 - index)));

    const totalCalls = randomInt(78000, 98000);
    const answered = Math.round(totalCalls * (0.44 + Math.random() * 0.07));
    const busy = Math.round(totalCalls * (0.41 + Math.random() * 0.08));
    const noAnswer = Math.round(totalCalls * (0.004 + Math.random() * 0.01));
    const dropped = Math.round(totalCalls * (0.001 + Math.random() * 0.004));
    const avgWait = randomInt(50, 78);
    const avgHandle = randomInt(170, 260);

    return {
      label: formatWeekLabel(date),
      weekStart: date.toISOString().slice(0, 10),
      totalCalls,
      answered,
      busy,
      noAnswer,
      dropped,
      answerRate: Number(((answered / totalCalls) * 100).toFixed(1)),
      dropRate: Number(((dropped / totalCalls) * 100).toFixed(2)),
      avgWait,
      avgHandle,
    };
  });
}

function buildCampaignBreakdown() {
  return [
    { name: "NRJCAMP", calls: randomInt(24000, 32000), answerRate: randomInt(42, 51), avgWait: randomInt(50, 74) },
    { name: "ENERGIE", calls: randomInt(16000, 24000), answerRate: randomInt(40, 48), avgWait: randomInt(55, 82) },
    { name: "SAV", calls: randomInt(9000, 16000), answerRate: randomInt(45, 57), avgWait: randomInt(35, 60) },
    { name: "QUALIF", calls: randomInt(7000, 12000), answerRate: randomInt(43, 54), avgWait: randomInt(44, 63) },
  ];
}

export async function fetchActivityDisplayData() {
  await new Promise((resolve) => setTimeout(resolve, 350));

  const now = new Date();
  const nowString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const activeCalls = randomInt(3, 12);
  const callsRinging = randomInt(3, 10);
  const waitingCalls = randomInt(0, 2);
  const agentsLogged = 10;
  const agentsInCalls = randomInt(0, 4);
  const agentsWaiting = randomInt(0, 2);
  const pausedAgents = Math.max(0, agentsLogged - agentsInCalls - agentsWaiting);

  return {
    updatedAt: nowString,
    topStats: [
      { label: "Current Active Calls", value: activeCalls, tone: "cyan" },
      { label: "Calls Ringing", value: callsRinging, tone: "blue" },
      { label: "Calls Waiting For Agents", value: waitingCalls, tone: "rose" },
      { label: "Calls In IVR", value: 0, tone: "violet" },
      { label: "Chats Waiting For Agents", value: 0, tone: "sky" },
      { label: "Callback Queue Calls", value: 0, tone: "indigo" },
      { label: "Agents Logged In", value: agentsLogged, tone: "teal" },
      { label: "Agents In Calls", value: agentsInCalls, tone: "emerald" },
      { label: "Agents Waiting", value: agentsWaiting, tone: "lime" },
      { label: "Paused Agents", value: pausedAgents, tone: "amber" },
      { label: "Agents In Dead Calls", value: 0, tone: "zinc" },
      { label: "Agents In Dispo", value: 0, tone: "yellow" },
    ],
    summaryLines: buildSummary(nowString),
    carrierStats: buildCarrierStats(),
    agentRows: buildAgents(),
    waitingCall:
      waitingCalls > 0
        ? {
            status: "LIVE",
            campaign: "energierecep",
            phoneNumber: "786746447",
            serverIp: "137.74.41.164",
            dialTime: `0:0${randomInt(5, 9)}`,
            callType: "IN",
            priority: 0,
          }
        : null,
    quickKpis: [
      ["System Load Average", `${(2 + Math.random() * 2).toFixed(2)} | ${(5 + Math.random() * 2).toFixed(2)} | ${(6 + Math.random() * 2).toFixed(2)}`],
      ["Parked Calls", "0"],
      ["SLA 1", `${(69 + Math.random() * 4).toFixed(2)}%`],
      ["SLA 2", `${(69 + Math.random() * 4).toFixed(2)}%`],
    ],
    historical: {
      daily: buildDailyHistory(7),
      weekly: buildWeeklyHistory(6),
      campaigns: buildCampaignBreakdown(),
    },
  };
}