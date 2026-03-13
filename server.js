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

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// Start Google OAuth flow
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

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/?error=no_code");
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    // Get user email
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    req.session.tokens = tokens;
    req.session.userEmail = data.email;
    res.redirect("/?connected=true");
  } catch (err) {
    console.error(err);
    res.redirect("/?error=auth_failed");
  }
});

// Check auth status
app.get("/auth/status", (req, res) => {
  if (req.session.tokens && req.session.userEmail) {
    res.json({ connected: true, email: req.session.userEmail });
  } else {
    res.json({ connected: false });
  }
});

// Logout
app.get("/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Send email
app.post("/send", async (req, res) => {
  if (!req.session.tokens) {
    return res.status(401).json({ error: "Not authenticated. Please connect your Gmail first." });
  }
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields" });
  }
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
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
