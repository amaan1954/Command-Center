const { jsonResponse } = require("./_gemini");
const { isSupabaseReady, readCloudDashboard, writeCloudDashboard } = require("./_supabase");

module.exports = async function handler(req, res) {
  if (!isSupabaseReady()) {
    jsonResponse(res, 503, {
      ready: false,
      error: "Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY."
    });
    return;
  }

  try {
    if (req.method === "GET") {
      const row = await readCloudDashboard();
      jsonResponse(res, 200, {
        ready: true,
        dashboard: row?.dashboard || null,
        updated_at: row?.updated_at || null
      });
      return;
    }

    if (req.method === "POST") {
      const dashboard = req.body?.dashboard;
      if (!dashboard || typeof dashboard !== "object") {
        jsonResponse(res, 400, { ready: true, error: "dashboard object is required" });
        return;
      }

      const row = await writeCloudDashboard(dashboard);
      jsonResponse(res, 200, {
        ready: true,
        saved: true,
        updated_at: row?.updated_at || null
      });
      return;
    }

    jsonResponse(res, 405, { error: "Use GET or POST" });
  } catch (error) {
    jsonResponse(res, 500, {
      ready: true,
      error: error.message || "Dashboard sync failed"
    });
  }
};
