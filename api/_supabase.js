const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
const STATE_ID = process.env.COMMAND_CENTER_STATE_ID || "main";

function isSupabaseReady() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function readCloudDashboard() {
  if (!isSupabaseReady()) return null;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/command_center_state?id=eq.${encodeURIComponent(STATE_ID)}&select=dashboard,updated_at`,
    { headers: headers() }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase read failed: ${response.status} ${detail}`);
  }

  const rows = await response.json();
  return rows?.[0] || null;
}

async function writeCloudDashboard(dashboard) {
  if (!isSupabaseReady()) return null;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/command_center_state`, {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({
      id: STATE_ID,
      dashboard,
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase write failed: ${response.status} ${detail}`);
  }

  const rows = await response.json();
  return rows?.[0] || null;
}

module.exports = {
  STATE_ID,
  SUPABASE_URL,
  isSupabaseReady,
  readCloudDashboard,
  writeCloudDashboard
};
