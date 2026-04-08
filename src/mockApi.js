export async function fetchActivityDisplayData() {
  const response = await fetch("http://localhost:3001/api/activity-display", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  return await response.json();
}