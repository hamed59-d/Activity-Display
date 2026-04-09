const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export async function fetchActivityDisplayData() {
  const response = await fetch(`${API_BASE}/api/activity-display`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  return await response.json();
}