const express      = require("express");
const cors         = require("cors");
const session      = require("express-session");
const { google }   = require("googleapis");
const path         = require("path");

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "lion-sun-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.REDIRECT_URI || "http://localhost:3000/auth/callback";
const ADMIN_KEY     = process.env.ADMIN_KEY || "javidshah-admin-2026";

// STATS
const stats = {
  startedAt: new Date().toISOString(),
  totalVisits: 0,
  uniqueIPs: new Set(),
  googleLogins: 0,
  uniqueUsers: new Set(),
  emailsSent: 0,
  emailsFailed: 0,
  campaigns: 0,
  recentActivity: []
};

function logEvent(type, detail) {
  const ev = { time: new Date().toISOString(), type, detail };
  stats.recentActivity.unshift(ev);
  if (stats.recentActivity.length > 50) stats.recentActivity.pop();
}

// Track visits
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "") {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    stats.totalVisits++;
    stats.uniqueIPs.add(ip);
  }
  next();
});

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

app.get("/auth/google", (req, res) => {
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/userinfo.email"],
    prompt: "consent"
  });
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/?error=no_code");
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    req.session.tokens = tokens;
    req.session.userEmail = data.email;
    stats.googleLogins++;
    const isNew = !stats.uniqueUsers.has(data.email);
    stats.uniqueUsers.add(data.email);
    logEvent("login", data.email + (isNew ? " (new)" : " (returning)"));
    res.redirect("/?connected=true");
  } catch (err) {
    console.error(err);
    res.redirect("/?error=auth_failed");
  }
});

app.get("/auth/status", (req, res) => {
  if (req.session.tokens && req.session.userEmail) {
    res.json({ connected: true, email: req.session.userEmail });
  } else {
    res.json({ connected: false });
  }
});

app.get("/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.post("/send", async (req, res) => {
  if (!req.session.tokens) {
    return res.status(401).json({ error: "Not authenticated. Please connect your Gmail first." });
  }
  const { to, subject, body, isCampaignStart } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (isCampaignStart) stats.campaigns++;
  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(req.session.tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const senderEmail = req.session.userEmail;
    const messageParts = [
      "From: " + senderEmail,
      "To: " + to,
      "Subject: " + subject,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body
    ];
    const message = messageParts.join("\n");
    const encoded = Buffer.from(message).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encoded }
    });
    stats.emailsSent++;
    logEvent("email_sent", senderEmail + " -> " + to);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    stats.emailsFailed++;
    logEvent("email_failed", req.session.userEmail + " -> " + to + ": " + err.message);
    res.status(500).json({ error: err.message });
  }
});

// SECRET ADMIN DASHBOARD
app.get("/admin", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).send("Access denied.");
  }
  const uptime = Math.round((Date.now() - new Date(stats.startedAt)) / 1000 / 60);
  const activityRows = stats.recentActivity.map(ev => {
    const t = new Date(ev.time).toLocaleString("en-GB", { timeZone: "Europe/Brussels" });
    const color = ev.type === "login" ? "#4ade80" : ev.type === "email_sent" ? "#60a5fa" : "#f87171";
    return "<tr><td>" + t + "</td><td style='color:" + color + "'>" + ev.type + "</td><td>" + ev.detail + "</td></tr>";
  }).join("");

  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin — Lion and Sun</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080e0a;color:#f0ead8;font-family:'Segoe UI',sans-serif;padding:2rem}
h1{font-size:1.4rem;color:#c9a84c;margin-bottom:0.3rem}
.sub{color:#6a8a60;font-size:0.8rem;margin-bottom:2rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:2rem}
.card{background:#101810;border:1px solid #243020;border-radius:12px;padding:1.2rem;text-align:center}
.num{font-size:2.2rem;font-weight:700;color:#c9a84c}
.lbl{font-size:0.65rem;color:#6a8a60;text-transform:uppercase;letter-spacing:0.1em;margin-top:0.3rem}
table{width:100%;border-collapse:collapse;background:#101810;border-radius:12px;overflow:hidden;font-size:0.78rem}
th{background:#182418;padding:0.6rem 0.8rem;text-align:left;color:#6a8a60;font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em}
td{padding:0.55rem 0.8rem;border-bottom:1px solid #1a2a1a;color:#c8bfa8;word-break:break-all}
tr:last-child td{border-bottom:none}
.refresh{display:inline-block;margin-bottom:1rem;color:#c9a84c;font-size:0.75rem;text-decoration:none;border:1px solid #c9a84c;border-radius:6px;padding:0.3rem 0.7rem}
.refresh:hover{background:#c9a84c;color:#080e0a}
h2{font-size:0.9rem;color:#c9a84c;margin-bottom:0.75rem}
</style>
</head>
<body>
<h1>Lion and Sun — Admin Dashboard</h1>
<div class="sub">Server up for ${uptime} minutes &nbsp;|&nbsp; Started: ${new Date(stats.startedAt).toLocaleString("en-GB", {timeZone:"Europe/Brussels"})} Brussels time</div>
<a class="refresh" href="/admin?key=${ADMIN_KEY}">Refresh</a>
<div class="grid">
  <div class="card"><div class="num">${stats.totalVisits}</div><div class="lbl">Total Visits</div></div>
  <div class="card"><div class="num">${stats.uniqueIPs.size}</div><div class="lbl">Unique IPs</div></div>
  <div class="card"><div class="num">${stats.googleLogins}</div><div class="lbl">Google Logins</div></div>
  <div class="card"><div class="num">${stats.uniqueUsers.size}</div><div class="lbl">Unique Users</div></div>
  <div class="card"><div class="num">${stats.campaigns}</div><div class="lbl">Campaigns Launched</div></div>
  <div class="card"><div class="num" style="color:#4ade80">${stats.emailsSent}</div><div class="lbl">Emails Sent</div></div>
  <div class="card"><div class="num" style="color:#f87171">${stats.emailsFailed}</div><div class="lbl">Emails Failed</div></div>
</div>
<h2>Recent Activity (last 50)</h2>
<table>
<thead><tr><th>Time (Brussels)</th><th>Event</th><th>Detail</th></tr></thead>
<tbody>${activityRows || '<tr><td colspan="3" style="color:#6a8a60;text-align:center">No activity yet</td></tr>'}</tbody>
</table>
</body>
</html>`);
});

app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
