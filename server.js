const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.json());

// --- SECRET KEY FOR BULLETPROOF LOGINS ---
const SECRET = "officialmaen_super_secret_key_12345";

function generateToken(email) {
  const signature = crypto.createHmac('sha256', SECRET).update(email).digest('hex');
  return `${email}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [email, signature] = parts;
    const expected = crypto.createHmac('sha256', SECRET).update(email).digest('hex');
    if (signature === expected) return email;
  } catch (e) {}
  return null;
}

// --- Local JSON Database Setup ---
const dbPaths = {
  users: path.join(__dirname, "users.json"),
  games: path.join(__dirname, "games.json"),
  comments: path.join(__dirname, "comments.json"),
  feedback: path.join(__dirname, "feedback.json")
};

function readDB(table) {
  if (!fs.existsSync(dbPaths[table])) {
    return table === "users" ? [] : { [table]: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(dbPaths[table], "utf8"));
  } catch (e) {
    return table === "users" ? [] : { [table]: [] };
  }
}

function writeDB(table, data) {
  fs.writeFileSync(dbPaths[table], JSON.stringify(data, null, 2));
}

// --- Uploads Setup ---
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// --- Middlewares ---
function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"] || req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const email = verifyToken(token);
  if (!email) {
    return res.status(401).json({ message: "Session invalid. Please log in again." });
  }

  const users = readDB("users");
  const user = users.find((u) => u.email === email);

  if (!user) {
    return res.status(401).json({ message: "Account missing from database (Server Reset). Please register again." });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const role = (req.user.role || "").toLowerCase();
    if (role !== "admin") {
      return res.status(403).json({ message: "Admin privileges required" });
    }
    next();
  });
}

// ==========================================
// API ROUTES
// ==========================================

// --- Auth & Users ---
app.post("/register", (req, res) => {
  const { email, displayName, password, avatarUrl } = req.body;

  if (!email || !displayName || !password) {
    return res.status(400).json({ message: "All fields required" });
  }

  const users = readDB("users");
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ message: "Email already exists." });
  }

  let role = email.toLowerCase() === "maencopra@gmail.com" ? "admin" : "user";

  const newUser = {
    id: Date.now(),
    email,
    displayName,
    password,
    role,
    avatarUrl: avatarUrl || null
  };

  users.push(newUser);
  writeDB("users", users);

  const { password: _, ...safeUser } = newUser;
  res.json({ message: "User registered", user: safeUser });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const users = readDB("users");
  const userIndex = users.findIndex(u => u.email === email && u.password === password);

  if (userIndex === -1) {
    return res.status(401).json({ message: "Wrong Password or Email!" });
  }

  // Force admin if it is your email
  if (email.toLowerCase() === "maencopra@gmail.com" && users[userIndex].role !== "admin") {
    users[userIndex].role = "admin";
    writeDB("users", users);
  }

  const token = generateToken(email);

  res.json({
    message: "Login successful",
    displayName: users[userIndex].displayName,
    role: users[userIndex].role,
    token,
    avatarUrl: users[userIndex].avatarUrl || null
  });
});

app.post("/logout", requireAuth, (req, res) => {
  res.json({ message: "Logged out successfully" });
});

app.get("/profile", requireAuth, (req, res) => {
  const { password, ...safeUser } = req.user;
  res.json({ user: safeUser });
});

app.post("/profile", requireAuth, (req, res) => {
  const { displayName, avatarUrl, newPassword } = req.body;
  const users = readDB("users");
  const userIndex = users.findIndex(u => u.email === req.user.email);

  if (userIndex !== -1) {
    if (displayName) users[userIndex].displayName = displayName;
    if (newPassword) users[userIndex].password = newPassword;
    if (avatarUrl !== undefined) users[userIndex].avatarUrl = avatarUrl;
    writeDB("users", users);
  }

  const { password, ...safeUser } = users[userIndex] || req.user;
  res.json({ message: "Profile updated", user: safeUser });
});

app.post("/upload-avatar", upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.json({ path: `/uploads/${req.file.filename}` });
});

// --- Games ---
app.get("/games", (req, res) => {
  const db = readDB("games");
  
  // Send games ordered by ID (newest first)
  const games = (db.games || []).sort((a,b) => b.id - a.id).map(g => ({
    ...g,
    likesCount: (g.likes || []).length,
    dislikesCount: (g.dislikes || []).length
  }));
  res.json({ games });
});

app.post("/games/url", requireAdmin, (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ message: "URL required" });

  const db = readDB("games");
  const newGame = {
    id: Date.now(),
    title: title || "Untitled",
    type: "url",
    url,
    addedBy: req.user.email,
    createdAt: new Date().toISOString(),
    likes: [],
    dislikes: []
  };

  db.games.push(newGame);
  writeDB("games", db);
  res.json({ message: "Game added", game: newGame });
});

app.post("/games/upload", requireAdmin, upload.single("gamefile"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const db = readDB("games");
  const newGame = {
    id: Date.now(),
    title: req.body.title || "Untitled Game",
    type: "file",
    path: `/uploads/${req.file.filename}`,
    addedBy: req.user.email,
    createdAt: new Date().toISOString(),
    likes: [],
    dislikes: []
  };

  db.games.push(newGame);
  writeDB("games", db);
  res.json({ message: "Game uploaded", game: newGame });
});

app.delete("/games/:id", requireAdmin, (req, res) => {
  const db = readDB("games");
  db.games = (db.games || []).filter(g => String(g.id) !== String(req.params.id));
  writeDB("games", db);
  res.json({ message: "Game deleted" });
});

app.post("/games/:id/vote", requireAuth, (req, res) => {
  const { vote } = req.body;
  const db = readDB("games");
  const game = db.games.find(g => String(g.id) === String(req.params.id));

  if (game) {
    if (!game.likes) game.likes = [];
    if (!game.dislikes) game.dislikes = [];

    game.likes = game.likes.filter(e => e !== req.user.email);
    game.dislikes = game.dislikes.filter(e => e !== req.user.email);

    if (vote === "like") game.likes.push(req.user.email);
    if (vote === "dislike") game.dislikes.push(req.user.email);

    writeDB("games", db);
  }
  res.json({ message: "Vote registered successfully" });
});

// --- Comments ---
app.get("/comments/:gameId", (req, res) => {
  const db = readDB("comments");
  const comments = (db.comments || []).filter(c => String(c.gameId) === String(req.params.gameId));
  res.json({ comments });
});

app.post("/comments", requireAuth, (req, res) => {
  const { text, gameId } = req.body;
  if (!text || !gameId) return res.status(400).json({ message: "Text and gameId required" });

  const db = readDB("comments");
  const newComment = {
    id: Date.now(),
    gameId,
    text,
    addedBy: req.user.email,
    displayName: req.user.displayName,
    avatarUrl: req.user.avatarUrl || null,
    createdAt: new Date().toISOString()
  };

  db.comments.push(newComment);
  writeDB("comments", db);
  res.json({ message: "Comment posted", comment: newComment });
});

app.delete("/comments/:id", requireAuth, (req, res) => {
  const db = readDB("comments");
  const commentIndex = db.comments.findIndex(c => String(c.id) === String(req.params.id));

  if (commentIndex !== -1) {
    const c = db.comments[commentIndex];
    const role = (req.user.role || "").toLowerCase();
    
    if (role === "admin" || c.addedBy === req.user.email) {
      db.comments.splice(commentIndex, 1);
      writeDB("comments", db);
    } else {
      return res.status(403).json({ message: "Unauthorized" });
    }
  }
  res.json({ message: "Deleted" });
});

// --- Feedback ---
app.get("/feedback", requireAdmin, (req, res) => {
  const db = readDB("feedback");
  const feedback = (db.feedback || []).sort((a,b) => b.id - a.id);
  res.json({ feedback });
});

app.post("/feedback", requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ message: "Feedback text required" });

  const db = readDB("feedback");
  const newFeedback = {
    id: Date.now(),
    text,
    addedBy: req.user.email,
    displayName: req.user.displayName,
    read: false,
    createdAt: new Date().toISOString()
  };

  if (!db.feedback) db.feedback = [];
  db.feedback.push(newFeedback);
  writeDB("feedback", db);

  res.json({ message: "Feedback submitted successfully!", feedback: newFeedback });
});

app.put("/feedback/:id/read", requireAdmin, (req, res) => {
  const db = readDB("feedback");
  const f = (db.feedback || []).find(x => String(x.id) === String(req.params.id));
  if (f) {
    f.read = true;
    writeDB("feedback", db);
  }
  res.json({ message: "Marked as read" });
});

app.delete("/feedback/:id", requireAdmin, (req, res) => {
  const db = readDB("feedback");
  db.feedback = (db.feedback || []).filter(x => String(x.id) !== String(req.params.id));
  writeDB("feedback", db);
  res.json({ message: "Deleted" });
});

// --- Admin User Management ---
app.get("/users", requireAdmin, (req, res) => {
  const users = readDB("users");
  res.json({
    users: users.map(u => ({ email: u.email, displayName: u.displayName, role: u.role }))
  });
});

app.delete("/users", requireAdmin, (req, res) => {
  const emailToDelete = req.query.email;
  if (!emailToDelete) return res.status(400).json({ message: "Email required" });

  let users = readDB("users");
  users = users.filter(u => u.email !== emailToDelete);
  writeDB("users", users);

  res.json({ message: "User deleted" });
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/defaults", express.static(path.join(__dirname, "defaults")));
app.use(express.static(__dirname));

app.use((req, res) => res.status(404).json({ message: "Not found" }));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
