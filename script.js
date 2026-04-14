"use strict";

let currentUser = null;
let currentRole = null;
let authToken = null;
let currentEmail = null;
let currentAvatar = null;
let profileRequestInFlight = false;

// -------------------- Session persistence --------------------
(function restoreSession() {
  try {
    const s = localStorage.getItem("om_session");
    if (s) {
      const obj = JSON.parse(s);
      currentUser = obj.currentUser || null;
      currentRole = obj.currentRole || null;
      authToken = obj.authToken || null;
      currentEmail = obj.currentEmail || null;
      currentAvatar = obj.profileImage || null;
      updateUserUI();
      updateAdminBadge();
    }
  } catch (e) {}
})();

function persistSession() {
  try {
    localStorage.setItem(
      "om_session",
      JSON.stringify({
        currentUser,
        currentRole,
        authToken,
        currentEmail,
        profileImage: currentAvatar
      })
    );
  } catch (e) {}
}

function clearPersistedSession() {
  try {
    localStorage.removeItem("om_session");
  } catch (e) {}
}

// -------------------- Utilities --------------------
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getDefaultAvatarPath(key) {
  if (!key) return null;
  return `/defaults/${String(key).replace(/[^a-z0-9_-]/gi, "").toLowerCase()}.png`;
}

async function safeJson(res) {
  try {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { error: text.substring(0, 200) }; 
    }
  } catch (e) {
    return null;
  }
}

function showApiError(prefix, body) {
  const message =
    body?.error ||
    body?.message ||
    body?.details ||
    body?.hint ||
    "Unknown server error. Check the server console.";
  alert(`${prefix}\n\nServer Response: ${message}`);
}

// -------------------- Auth fetch helper --------------------
function handleUnauthorizedFromServer(message) {
  clearSession();
  showPage("loginPage");
  const authNotice = document.getElementById("loginError");
  if (authNotice) {
    authNotice.textContent = message || "Session expired. Please log in again.";
    authNotice.classList.remove("hidden");
  }
}

async function authFetch(url, options = {}) {
  // Force strict JSON headers so the backend doesn't reject the body
  options.headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    ...options.headers
  };

  if (authToken) {
    options.headers["Authorization"] = `Bearer ${authToken}`;
    options.headers["X-Auth-Token"] = authToken;
  }

  options.credentials = "include";

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    console.error("Network failure: Could not reach the server.", err);
    throw err;
  }

  if (res.status === 401) {
    const body = await safeJson(res);
    handleUnauthorizedFromServer(body?.message || "Authentication required");
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  return res;
}

// -------------------- Page navigation --------------------
function showPage(pageId) {
  const pages = [
    "homePage",
    "loginPage",
    "registerPage",
    "profilePage",
    "editProfilePage",
    "settingsPage",
    "adminPanel",
    "feedbackPage"
  ];

  pages.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });

  const target = document.getElementById(pageId);
  if (target) target.classList.remove("hidden");

  if (pageId === "settingsPage") openSettingsInit();
  if (pageId === "homePage") loadGames();

  const isAdmin = currentRole && currentRole.toLowerCase() === "admin";
  if (pageId === "adminPanel" && isAdmin) {
    loadGamesAdmin();
    loadFeedbackAdmin();
    updateAdminBadge();
  }
}

// -------------------- AUTH --------------------
async function login() {
  const email = (document.getElementById("loginEmail")?.value || "").trim();
  const password = (document.getElementById("loginPass")?.value || "").trim();
  const errEl = document.getElementById("loginError");

  if (errEl) {
    errEl.classList.add("hidden");
    errEl.textContent = "";
  }

  if (!email || !password) {
    if (errEl) {
      errEl.textContent = "Please enter both email and password.";
      errEl.classList.remove("hidden");
    }
    return;
  }

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password })
    });

    const body = await safeJson(res);

    if (!res.ok) {
      if (errEl) {
        errEl.textContent = body?.message || body?.error || "Login failed";
        errEl.classList.remove("hidden");
      }
      return;
    }

    currentUser = body.displayName || email;
    currentRole = body.role || "user";
    authToken = body.token || null;
    currentEmail = email;
    currentAvatar = body.avatarUrl || null;

    persistSession();
    updateUserUI();
    updateAdminBadge();
    showPage("homePage");
  } catch (err) {
    if (errEl) {
      errEl.textContent = "Network error";
      errEl.classList.remove("hidden");
    }
  }
}

async function register() {
  const email = (document.getElementById("registerEmail")?.value || "").trim();
  const displayName = (document.getElementById("registerDisplay")?.value || "").trim();
  const password = (document.getElementById("registerPass")?.value || "").trim();
  const errEl = document.getElementById("registerError");

  if (errEl) {
    errEl.classList.add("hidden");
    errEl.textContent = "";
  }

  if (!email || !displayName || !password) {
    if (errEl) {
      errEl.textContent = "Please fill all required fields.";
      errEl.classList.remove("hidden");
    }
    return;
  }

  try {
    let avatarPath = null;
    const avatarInput = document.getElementById("registerAvatar");
    const file = avatarInput?.files?.[0];

    if (file) {
      const fd = new FormData();
      fd.append("avatar", file);

      // We use normal fetch here since it's multipart/form-data
      const upRes = await fetch("/upload-avatar", { method: "POST", body: fd });
      if (upRes.ok) {
        const upBody = await safeJson(upRes);
        avatarPath = upBody?.path || null;
      }
    } else {
      const selectedDefault = document.getElementById("defaultAvatarSelect")?.value;
      if (selectedDefault && selectedDefault !== "none") {
        avatarPath = getDefaultAvatarPath(selectedDefault);
      }
    }

    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName, password, avatarUrl: avatarPath })
    });

    const body = await safeJson(res);

    if (!res.ok) {
      if (errEl) {
        errEl.textContent = body?.error || body?.message || "Register failed";
        errEl.classList.remove("hidden");
      }
      return;
    }

    currentRole = body?.user?.role || "user";
    currentUser = displayName || email;
    currentEmail = email;
    currentAvatar = body?.user?.avatarUrl || avatarPath || null;

    persistSession();
    updateUserUI();
    showPage("loginPage");
  } catch (err) {
    if (errEl) {
      errEl.textContent = "Network error";
      errEl.classList.remove("hidden");
    }
  }
}

async function logout() {
  if (authToken || currentUser) {
    try {
      await authFetch("/logout", { method: "POST" });
    } catch (e) {
    } finally {
      clearSession();
    }
  } else {
    clearSession();
  }
}

function clearSession() {
  currentUser = null;
  currentRole = null;
  authToken = null;
  currentEmail = null;
  currentAvatar = null;
  clearPersistedSession();
  updateUserUI();
  showPage("homePage");
}

// -------------------- UI updates --------------------
function updateUserUI() {
  const els = [
    "userInfo",
    "logoutBtn",
    "loginBtn",
    "registerBtn",
    "adminBtn",
    "profileBtn",
    "settingsBtn",
    "feedbackNavBtn"
  ];

  const ui = {};
  els.forEach((id) => {
    ui[id] = document.getElementById(id);
  });

  injectTopAvatarStyles();

  if (currentUser) {
    const isAdmin = currentRole && currentRole.toLowerCase() === "admin";
    const avatarHtml = buildTopAvatarHtml();

    ui.userInfo.innerHTML = `${avatarHtml} <span class="top-user-text">Logged in as <span style="color:${isAdmin ? "yellow" : "white"}">${escapeHtml(currentUser)}</span></span>`;
    ui.userInfo.classList.remove("hidden");
    ui.logoutBtn.classList.remove("hidden");
    ui.profileBtn.classList.remove("hidden");
    ui.settingsBtn.classList.remove("hidden");
    ui.feedbackNavBtn.classList.remove("hidden");
    ui.loginBtn.classList.add("hidden");
    ui.registerBtn.classList.add("hidden");

    if (isAdmin) ui.adminBtn.classList.remove("hidden");
    else ui.adminBtn.classList.add("hidden");
  } else {
    ui.userInfo.classList.add("hidden");
    ui.logoutBtn.classList.add("hidden");
    ui.adminBtn.classList.add("hidden");
    ui.profileBtn.classList.add("hidden");
    ui.feedbackNavBtn.classList.add("hidden");
    ui.settingsBtn.classList.remove("hidden");
    ui.loginBtn.classList.remove("hidden");
    ui.registerBtn.classList.remove("hidden");
  }
}

function buildTopAvatarHtml() {
  if (currentAvatar) {
    return `<img src="${escapeHtml(currentAvatar)}" alt="avatar" class="top-avatar">`;
  }

  const initials = (currentUser || "")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "";

  return `<div class="top-avatar-fallback">${escapeHtml(initials)}</div>`;
}

function injectTopAvatarStyles() {
  if (document.getElementById("topAvatarStyles")) return;

  const style = document.createElement("style");
  style.id = "topAvatarStyles";
  style.textContent =
    ".top-avatar { width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;display:inline-block; } .top-avatar-fallback { width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#fff;background:#444;vertical-align:middle; } .top-user-text { vertical-align: middle; display: inline-block; font-weight:bold; }";
  document.head.appendChild(style);
}

// -------------------- PROFILE --------------------
async function openProfile() {
  if (profileRequestInFlight) return;
  profileRequestInFlight = true;

  if (!authToken && !currentUser) {
    renderProfileLocal();
    showPage("profilePage");
    profileRequestInFlight = false;
    return;
  }

  try {
    const res = await authFetch("/profile", { method: "GET" });
    if (!res.ok) throw new Error();

    const body = await safeJson(res);
    const user = body?.user;

    if (user) {
      currentUser = user.displayName;
      currentEmail = user.email;
      currentRole = user.role;
      if (user.avatarUrl !== undefined) currentAvatar = user.avatarUrl;
      persistSession();
    }

    renderProfile(user);
    updateUserUI();
    showPage("profilePage");
  } catch (err) {
    renderProfileLocal();
    showPage("profilePage");
  } finally {
    profileRequestInFlight = false;
  }
}

function renderProfile(user) {
  const container = document.getElementById("profileInfo");
  if (!container) return;

  const profileAvatar = user?.avatarUrl !== undefined ? user.avatarUrl : currentAvatar;
  const role = user?.role || currentRole;
  const isAdmin = role && role.toLowerCase() === "admin";

  container.innerHTML = `<div style="display:flex; gap:12px; align-items:center;">
    ${profileAvatar ? `<img src="${escapeHtml(profileAvatar)}" class="profile-thumb">` : `<div class="profile-thumb" style="background:#333;display:inline-block;"></div>`}
    <div>
      <div><strong style="font-size: 1.25rem;">${escapeHtml(user?.displayName || currentUser)}</strong></div>
      <div style="margin-top:6px; font-size: 0.9rem;">Role: <strong style="color:${isAdmin ? "yellow" : "white"};">${escapeHtml(role)}</strong></div>
    </div>
  </div>`;
}

function renderProfileLocal() {
  renderProfile({
    displayName: currentUser,
    email: currentEmail,
    role: currentRole,
    avatarUrl: currentAvatar
  });
}

function openEditProfile() {
  document.getElementById("editDisplay").value = currentUser || "";
  document.getElementById("editAvatar").value = "";
  if (document.getElementById("defaultAvatarEditSelect")) {
    document.getElementById("defaultAvatarEditSelect").value = "none";
  }
  if (document.getElementById("editNewPass")) {
    document.getElementById("editNewPass").value = "";
  }
  showPage("editProfilePage");
}

async function saveProfile() {
  const displayName = document.getElementById("editDisplay").value.trim();
  const avatarInput = document.getElementById("editAvatar");
  const newPass = document.getElementById("editNewPass")?.value.trim() || "";
  let avatarPath = currentAvatar || null;

  if (avatarInput?.files?.[0]) {
    const fd = new FormData();
    fd.append("avatar", avatarInput.files[0]);
    // Normal fetch for multipart
    const upRes = await fetch("/upload-avatar", { method: "POST", body: fd });
    if (upRes.ok) {
      const upBody = await safeJson(upRes);
      avatarPath = upBody?.path || avatarPath;
    }
  } else if (
    document.getElementById("defaultAvatarEditSelect") &&
    document.getElementById("defaultAvatarEditSelect").value !== "none"
  ) {
    avatarPath = getDefaultAvatarPath(document.getElementById("defaultAvatarEditSelect").value);
  }

  if (!authToken && !currentUser) {
    currentUser = displayName || currentUser;
    currentAvatar = avatarPath;
    persistSession();
    updateUserUI();
    showPage("profilePage");
    return;
  }

  const payload = { displayName, avatarUrl: avatarPath };
  if (newPass) payload.newPassword = newPass;

  const res = await authFetch("/profile", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const body = await safeJson(res);

  if (res.ok && body?.user) {
    currentUser = body.user.displayName;
    currentAvatar = body.user.avatarUrl !== undefined ? body.user.avatarUrl : avatarPath;
    persistSession();
    updateUserUI();
    showPage("profilePage");
  } else if (!res.ok) {
    showApiError("Failed to save profile.", body);
  }
}

// -------------------- Feedback & Notifications --------------------
async function submitFeedback() {
  if (!currentUser || !authToken) {
    alert("You must be logged in to send feedback.");
    showPage("loginPage");
    return;
  }

  const textarea = document.getElementById("feedbackText");
  const text = textarea.value.trim();

  if (!text) {
    alert("Feedback cannot be empty!");
    return;
  }

  try {
    const res = await authFetch("/feedback", {
      method: "POST",
      body: JSON.stringify({ text })
    });

    const body = await safeJson(res);
// -------------------- Settings & Admin Users --------------------

// 1. Auto-load the saved theme when the page opens
(function initTheme() {
  const saved = localStorage.getItem("om_theme") || "dark";
  applyTheme(saved);
})();

// 2. Load profile info into the settings page
function openSettingsInit() {
  const nameEl = document.getElementById("settingsProfileName");
  const emailEl = document.getElementById("settingsProfileEmail");
  const thumbEl = document.getElementById("settingsProfileThumb");

  // Show user details if logged in
  if (currentUser) {
    nameEl.textContent = currentUser;
    emailEl.textContent = currentEmail || "";
    if (currentAvatar) {
      thumbEl.src = currentAvatar;
      thumbEl.classList.remove("hidden");
    } else {
      thumbEl.classList.add("hidden");
    }
  } else {
    nameEl.textContent = "Not logged in";
    emailEl.textContent = "";
    thumbEl.classList.add("hidden");
  }

  // Set the radio button to match the current theme
  const savedTheme = localStorage.getItem("om_theme") || "dark";
  if (savedTheme === "light") {
    document.getElementById("themeLight").checked = true;
  } else {
    document.getElementById("themeDark").checked = true;
  }
}

function applySelectedTheme() {
  const isLight = document.getElementById("themeLight").checked;
  const theme = isLight ? "light" : "dark";
  localStorage.setItem("om_theme", theme);
  applyTheme(theme);
}

function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light-theme");
  } else {
    document.body.classList.remove("light-theme");
  }
}

function resetTheme() {
  localStorage.removeItem("om_theme");
  document.getElementById("themeDark").checked = true;
  applyTheme("dark");
}
    if (res.ok) {
      alert("Feedback sent! Thank you.");
      textarea.value = "";
      showPage("homePage");
    } else {
      showApiError("Failed to send feedback.", body);
    }
  } catch (e) {
    alert("Error sending feedback. Please check your network connection.");
  }
}

async function updateAdminBadge() {
  if (!currentRole || currentRole.toLowerCase() !== "admin") return;

  try {
    const res = await authFetch("/feedback");
    if (res.ok) {
      const body = await safeJson(res);
      const unreadCount = (body?.feedback || []).filter((f) => !f.read).length;
      const badge = document.getElementById("adminBadge");
      if (!badge) return;

      if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
  } catch (e) {}
}

async function loadFeedbackAdmin() {
  const container = document.getElementById("feedbackListAdmin");
  if (!container) return;

  try {
    const res = await authFetch("/feedback");
    const body = await safeJson(res);

    if (!res.ok) {
      container.innerHTML = '<p class="muted">Failed to load feedback.</p>';
      return;
    }

    if (!body?.feedback || body.feedback.length === 0) {
      container.innerHTML = '<p class="muted">No feedback yet.</p>';
      return;
    }

    container.innerHTML = body.feedback
      .map((f) => {
        const unreadClass = f.read ? "" : "feedback-unread";
        const markReadBtn = f.read
          ? ""
          : `<button onclick="markFeedbackRead(${f.id})" style="margin:0 8px 0 0; font-size:11px; padding:2px 6px;">Mark Read</button>`;

        // EMAIL HIDDEN HERE
        return `
      <div class="${unreadClass}" style="padding:10px; background:#222; margin-bottom:8px; border-radius:6px; position:relative;">
        <div style="position:absolute; top:10px; right:10px;">
          ${markReadBtn}
          <button onclick="deleteFeedback(${f.id})" class="comment-delete-btn">Delete</button>
        </div>
        <strong>${escapeHtml(f.displayName || "Unknown")}</strong>
        <div style="margin-top:6px;">${escapeHtml(f.text)}</div>
      </div>
    `;
      })
      .join("");
  } catch (e) {
    container.innerHTML = '<p class="muted">Failed to load feedback.</p>';
  }
}

async function markFeedbackRead(id) {
  try {
    const res = await authFetch(`/feedback/${id}/read`, { method: "PUT" });
    if (res.ok) {
      loadFeedbackAdmin();
      updateAdminBadge();
    }
  } catch (e) {}
}

async function deleteFeedback(id) {
  if (!confirm("Delete this feedback?")) return;

  try {
    const res = await authFetch(`/feedback/${id}`, { method: "DELETE" });
    if (res.ok) {
      loadFeedbackAdmin();
      updateAdminBadge();
    }
  } catch (e) {}
}

// -------------------- Settings & Admin Users --------------------
function openSettingsInit() {}
function applySelectedTheme() {}
function applyTheme() {}
function resetTheme() {}

async function openAdminPanel() {
  if (!currentRole || currentRole.toLowerCase() !== "admin") {
    alert("Admin privileges required.");
    showPage("homePage");
    return;
  }

  showPage("adminPanel");

  try {
    const res = await authFetch("/users", { method: "GET" });
    const body = await safeJson(res);

    if (res.ok) {
      renderUsers(body?.users || []);
    }

    await loadGamesAdmin();
    await loadFeedbackAdmin();
    updateAdminBadge();
  } catch (err) {}
}

function renderUsers(users) {
  const container = document.getElementById("usersList");
  if (!container) return;

  container.innerHTML = users
    .map((u) => {
      const isAdmin = u.role && u.role.toLowerCase() === "admin";
      return `<div class="user-item"><strong class="${isAdmin ? "user-admin" : ""}">${escapeHtml(u.displayName)}</strong> - ${escapeHtml(u.email)}</div>`;
    })
    .join("");
}

async function deleteUser() {
  const email = document.getElementById("deleteEmail").value.trim();
  if (!email || !confirm(`Delete ${email}?`)) return;

  const res = await authFetch(`/users?email=${encodeURIComponent(email)}`, {
    method: "DELETE"
  });

  if (res.ok) openAdminPanel();
}

// -------------------- Comments --------------------
async function toggleComments(gameId) {
  const section = document.getElementById(`comments-section-${gameId}`);
  if (!section) return;

  if (section.classList.contains("hidden")) {
    section.classList.remove("hidden");
    await loadComments(gameId);
  } else {
    section.classList.add("hidden");
  }
}

async function loadComments(gameId) {
  const listDiv = document.getElementById(`comments-list-${gameId}`);
  if (!listDiv) return;

  listDiv.innerHTML = '<div class="muted">Loading comments...</div>';

  try {
    const res = await fetch(`/comments/${gameId}`);
    if (!res.ok) throw new Error();

    const data = await safeJson(res);

    if (!data?.comments || data.comments.length === 0) {
      listDiv.innerHTML = '<div class="muted" style="margin-bottom:10px;">No comments yet. Be the first!</div>';
    } else {
      listDiv.innerHTML = data.comments
        .map((c) => {
          const avatar = c.avatarUrl
            ? `<img src="${escapeHtml(c.avatarUrl)}" class="comment-avatar">`
            : `<div class="comment-avatar" style="display:flex;align-items:center;justify-content:center;font-weight:bold;">${escapeHtml((c.displayName || "?")[0])}</div>`;

          const canDelete =
            (currentRole && currentRole.toLowerCase() === "admin") ||
            currentEmail === c.addedBy;

          const deleteBtn = canDelete
            ? `<button onclick="deleteComment(${c.id}, ${gameId})" class="comment-delete-btn">Delete</button>`
            : "";

          return `<div class="comment-item">${avatar}<div style="flex-grow:1;"><div><strong>${escapeHtml(c.displayName || "Unknown")}</strong> <span class="comment-date">${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ""}</span></div><div class="comment-text">${escapeHtml(c.text)}</div></div><div>${deleteBtn}</div></div>`;
        })
        .join("");
    }
  } catch (e) {
    listDiv.innerHTML = '<div class="error">Failed to load comments</div>';
  }
}

async function postComment(gameId) {
  if (!currentUser) {
    alert("You must be logged in to comment!");
    return;
  }

  const input = document.getElementById(`comment-input-${gameId}`);
  const text = input.value.trim();
  if (!text) return;

  try {
    const res = await authFetch("/comments", {
      method: "POST",
      body: JSON.stringify({ gameId, text })
    });

    const body = await safeJson(res);

    if (res.ok) {
      input.value = "";
      await loadComments(gameId);
    } else {
      showApiError("Failed to post comment.", body);
    }
  } catch (e) {
    alert("Failed to post comment");
  }
}

async function deleteComment(commentId, gameId) {
  if (!confirm("Delete this comment?")) return;

  try {
    const res = await authFetch(`/comments/${commentId}`, { method: "DELETE" });
    if (res.ok) await loadComments(gameId);
  } catch (e) {}
}

// -------------------- Games & Voting --------------------
function normalizeGameUrl(urlStr) {
  if (!urlStr) return null;
  urlStr = urlStr.trim();
  if (!/^https?:\/\//i.test(urlStr)) urlStr = "https://" + urlStr;

  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace("www.", "").toLowerCase();

    if (host === "scratch.mit.edu" && u.pathname.includes("projects") && !u.pathname.endsWith("/embed")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("projects");
      if (idx !== -1 && parts[idx + 1]) {
        return `https://scratch.mit.edu/projects/${parts[idx + 1]}/embed`;
      }
    }

    return u.href;
  } catch (e) {
    return null;
  }
}

async function voteGame(gameId, targetVote, currentVote, gameTitle) {
  if (!currentUser) return alert("Please log in to vote!");

  const finalVote = currentVote === targetVote ? "none" : targetVote;

  if (finalVote === "dislike") {
    const reason = prompt(`Optional: Why didn't you like "${gameTitle}"? Your feedback helps us improve!`);
    if (reason && reason.trim()) {
      await authFetch("/feedback", {
        method: "POST",
        body: JSON.stringify({ text: `[Dislike: ${gameTitle}]: ${reason}` })
      });
      updateAdminBadge();
    }
  }

  await authFetch(`/games/${gameId}/vote`, {
    method: "POST",
    body: JSON.stringify({ vote: finalVote })
  });

  loadGames();
}

async function addGameFile() {
  const fileInput = document.getElementById("gameFile");
  const title = document.getElementById("gameTitle").value.trim();

  if (!fileInput.files[0]) {
    alert("Please select a file.");
    return;
  }

  const fd = new FormData();
  fd.append("gamefile", fileInput.files[0]);
  fd.append("title", title);

  try {
    // Normal fetch for multipart form data
    const res = await fetch("/games/upload", {
      method: "POST",
      headers: authToken ? {
        "Authorization": `Bearer ${authToken}`,
        "X-Auth-Token": authToken
      } : {},
      body: fd
    });
    
    const body = await safeJson(res);

    if (res.ok) {
      document.getElementById("gameFile").value = "";
      document.getElementById("gameTitle").value = "";
      loadGamesAdmin();
      loadGames();
      alert("Game file uploaded successfully!");
    } else {
      showApiError("Database error uploading game.", body);
    }
  } catch (e) {
    console.error(e);
    alert("Failed to upload game file.");
  }
}

async function addGameUrl() {
  const url = normalizeGameUrl(document.getElementById("gameUrl").value);
  const title = document.getElementById("gameTitleUrl").value.trim();

  if (!url) {
    alert("Please enter a valid URL.");
    return;
  }

  try {
    const res = await authFetch("/games/url", {
      method: "POST",
      body: JSON.stringify({ url, title })
    });

    const body = await safeJson(res);

    if (res.ok) {
      document.getElementById("gameUrl").value = "";
      document.getElementById("gameTitleUrl").value = "";
      loadGamesAdmin();
      loadGames();
      alert("Game URL added successfully!");
    } else {
      showApiError("Server rejected the URL addition.", body);
    }
  } catch (e) {
    console.error(e);
    alert("Failed to add game URL. Please check the console.");
  }
}

async function loadGames() {
  const container = document.getElementById("gamesList");
  if (!container) return;

  try {
    const res = await authFetch("/games");
    if (!res.ok) throw new Error();

    const body = await safeJson(res);

    if (!body?.games || body.games.length === 0) {
      container.innerHTML = '<div class="muted">No games yet.</div>';
      return;
    }

    container.innerHTML = body.games
      .map((g) => {
        const media =
          g.type === "file"
            ? `<a href="${escapeHtml(g.path)}" target="_blank" style="display:inline-block; padding:6px 12px; background:#4CAF50; color:white; border-radius:4px; text-decoration:none;">Play (open file)</a>`
            : `<div style="border-radius:6px; overflow:hidden;"><iframe src="${escapeHtml(g.url)}" width="100%" height="400" frameborder="0" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms"></iframe></div>`;

        const likeClass = g.userVote === "like" ? "vote-active-like" : "";
        const dislikeClass = g.userVote === "dislike" ? "vote-active-dislike" : "";

        const voteHtml = `
        <div style="margin-top:10px; display:flex; gap:8px;">
          <button onclick="voteGame(${g.id}, 'like', '${g.userVote || ""}', this.dataset.title)" data-title="${escapeHtml(g.title)}" class="vote-btn ${likeClass}">👍 ${g.likesCount || 0}</button>
          <button onclick="voteGame(${g.id}, 'dislike', '${g.userVote || ""}', this.dataset.title)" data-title="${escapeHtml(g.title)}" class="vote-btn ${dislikeClass}">👎 ${g.dislikesCount || 0}</button>
          <button onclick="toggleComments(${g.id})" class="vote-btn">💬 Comments</button>
        </div>
      `;

        const commentInputHtml = currentUser
          ? `<div style="display:flex; gap:8px; margin-top:10px;">
          <input id="comment-input-${g.id}" placeholder="Write a comment..." style="flex-grow:1; margin:0;" />
          <button onclick="postComment(${g.id})" style="margin:0; background:#6b5cff;">Post</button>
        </div>`
          : `<div class="muted" style="margin-top:10px; font-size:12px;">Log in to post a comment.</div>`;

        return `<div style="padding:12px; margin-bottom:16px; background:#1e1e1e; border-radius:6px;">
        <strong style="font-size:18px; margin-bottom:10px; display:block;">${escapeHtml(g.title)}</strong>
        ${media}
        ${voteHtml}
        <div id="comments-section-${g.id}" class="hidden" style="margin-top:12px; background:#111; padding:12px; border-radius:6px; border:1px solid #333;">
          <h4 style="margin:0 0 10px 0; font-size:14px;">Comments</h4>
          <div id="comments-list-${g.id}"></div>
          ${commentInputHtml}
        </div>
      </div>`;
      })
      .join("");
  } catch (err) {
    container.innerHTML = '<div class="error">Error loading games.</div>';
  }
}

async function loadGamesAdmin() {
  const container = document.getElementById("gamesListAdmin");
  if (!container) return;

  const res = await fetch("/games");
  const body = await safeJson(res);

  if (!res.ok) {
    container.innerHTML = '<div class="muted">Failed to load games.</div>';
    return;
  }

  container.innerHTML = (body?.games || [])
    .map(
      (g) => `<div style="padding:8px 0;border-bottom:1px solid #333; display:flex; justify-content:space-between;">
      <div><strong>${escapeHtml(g.title)}</strong> <span class="muted">(${escapeHtml(g.type)})</span></div>
      <button onclick="deleteGame(${g.id})" style="background:#e74c3c; margin:0; padding:4px 8px;">Delete</button>
    </div>`
    )
    .join("");
}

async function deleteGame(id) {
  if (!confirm("Delete game?")) return;

  const res = await authFetch(`/games/${id}`, { method: "DELETE" });
  if (res.ok) {
    loadGames();
    loadGamesAdmin();
  }
}

// -------------------- Expose functions --------------------
window.showPage = showPage;
window.login = login;
window.register = register;
window.logout = logout;
window.openProfile = openProfile;
window.openEditProfile = openEditProfile;
window.saveProfile = saveProfile;
window.openAdminPanel = openAdminPanel;
window.deleteUser = deleteUser;
window.addGameFile = addGameFile;
window.addGameUrl = addGameUrl;
window.deleteGame = deleteGame;
window.toggleComments = toggleComments;
window.postComment = postComment;
window.deleteComment = deleteComment;
window.submitFeedback = submitFeedback;
window.deleteFeedback = deleteFeedback;
window.markFeedbackRead = markFeedbackRead;
window.voteGame = voteGame;

showPage("homePage");
window.applySelectedTheme = applySelectedTheme;
window.resetTheme = resetTheme;
