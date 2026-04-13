// ============================================================
//  ChillSpace v3 — Client
//  New: Message reply, Profile edit, Status, Private rooms,
//       Invite links, Voice notes
// ============================================================

// ── DOM ──────────────────────────────────────────────────────
const landing          = document.getElementById("landing");
const usernameInput    = document.getElementById("username-input");
const joinBtn          = document.getElementById("join-btn");

const app              = document.getElementById("app");
const messagesEl       = document.getElementById("messages");
const msgInput         = document.getElementById("msg-input");
const sendBtn          = document.getElementById("send-btn");
const roomListEl       = document.getElementById("room-list");
const userListEl       = document.getElementById("user-list");
const currentRoomName  = document.getElementById("current-room-name");
const roomMemberCount  = document.getElementById("room-member-count");
const roomLockIcon     = document.getElementById("room-lock-icon");
const typingIndicator  = document.getElementById("typing-indicator");
const inviteBtn        = document.getElementById("invite-btn");
const panelToggle      = document.getElementById("panel-toggle");
const rightPanel       = document.getElementById("right-panel");

// Reply bar
const replyBar         = document.getElementById("reply-bar");
const replyBarName     = document.getElementById("reply-bar-name");
const replyBarText     = document.getElementById("reply-bar-text");
const replyCancel      = document.getElementById("reply-cancel");

// Profile
const panelAvatar      = document.getElementById("panel-avatar");
const panelUsername    = document.getElementById("panel-username");
const bioInput         = document.getElementById("bio-input");
const bioCharCount     = document.getElementById("bio-char-count");
const saveBioBtn       = document.getElementById("save-bio-btn");
const colorGrid        = document.getElementById("color-grid");
const statusBtns       = document.querySelectorAll(".status-btn");

// Mic
const micBtn           = document.getElementById("mic-btn");
const recordingOverlay = document.getElementById("recording-overlay");
const recordingTimer   = document.getElementById("recording-timer");

// Create room modal
const createRoomBtn    = document.getElementById("create-room-btn");
const createModal      = document.getElementById("create-room-modal");
const newRoomInput     = document.getElementById("new-room-input");
const togglePublic     = document.getElementById("toggle-public");
const togglePrivate    = document.getElementById("toggle-private");
const passwordWrap     = document.getElementById("password-wrap");
const roomPasswordInput= document.getElementById("room-password-input");
const modalCancel      = document.getElementById("modal-cancel");
const modalConfirm     = document.getElementById("modal-confirm");

// Password modal
const passwordModal    = document.getElementById("password-modal");
const pwModalRoomName  = document.getElementById("pw-modal-room-name");
const joinPasswordInput= document.getElementById("join-password-input");
const passwordError    = document.getElementById("password-error");
const pwModalCancel    = document.getElementById("pw-modal-cancel");
const pwModalConfirm   = document.getElementById("pw-modal-confirm");

const toastEl          = document.getElementById("toast");

// ── State ─────────────────────────────────────────────────────
let socket             = null;
let myUsername         = "";
let myAvatarColor      = "#f5a623";
let myBio              = "";
let myStatus           = "online";
let currentRoom        = "general";
let currentInviteCode  = null;
let replyingTo         = null;   // { username, text }
let isPrivateRoom      = false;
let pendingPrivateRoom = null;
let isTyping           = false;
let typingTimer        = null;
const typingUsers      = new Set();

// Recording
let mediaRecorder      = null;
let audioChunks        = [];
let recordingStart     = null;
let recordingInterval  = null;

// ── Utils ─────────────────────────────────────────────────────
const initial  = n  => n.charAt(0).toUpperCase();
const esc      = s  => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;");
const fmtTime  = s  => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;
const scrollBot = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.add("hidden"), 2400);
}

// ── Join ──────────────────────────────────────────────────────
function join() {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.style.borderColor = "var(--red)";
    setTimeout(() => usernameInput.style.borderColor = "", 800);
    return;
  }
  myUsername = name;

  // Check for invite code in URL hash
  const hash = window.location.hash.replace("#", "");

  socket = io();
  setupSocket();
  socket.emit("join", { username: name, avatarColor: myAvatarColor, bio: myBio });

  // If invite code in URL, join that room after welcome
  if (hash && hash !== "general" && hash !== "gaming") {
    socket.once("welcome", () => {
      setTimeout(() => socket.emit("join_via_invite", { inviteCode: hash }), 300);
    });
  }
}

function showApp() {
  landing.classList.add("hidden");
  app.classList.remove("hidden");
  updateProfileUI();
  msgInput.focus();
}

// ── Profile UI ────────────────────────────────────────────────
function updateProfileUI() {
  panelUsername.textContent  = myUsername;
  panelAvatar.textContent    = initial(myUsername);
  panelAvatar.style.color    = myAvatarColor;
  panelAvatar.style.borderColor = myAvatarColor;
  bioInput.value             = myBio;
  bioCharCount.textContent   = `${myBio.length}/100`;

  // Sync active color swatch
  document.querySelectorAll(".color-swatch").forEach(s => {
    s.classList.toggle("active", s.dataset.color === myAvatarColor);
  });

  // Sync active status btn
  statusBtns.forEach(b => b.classList.toggle("active", b.dataset.status === myStatus));
}

// ── Render Rooms ──────────────────────────────────────────────
function renderRooms(rooms) {
  roomListEl.innerHTML = "";
  rooms.forEach(({ name, count, isPrivate, isOwn, inviteCode }) => {
    const li = document.createElement("li");
    li.className = "room-item" + (name === currentRoom ? " active" : "");
    li.dataset.room    = name;
    li.dataset.private = isPrivate ? "true" : "false";

    const inviteHtml = (isOwn && inviteCode)
      ? `<button class="r-invite" data-code="${inviteCode}" title="Copy invite link">🔗 share</button>`
      : "";

    li.innerHTML = `
      <span class="r-hash">#</span>
      <span>${esc(name)}</span>
      ${isPrivate ? '<span class="r-lock">🔒</span>' : ""}
      <span class="r-count">${count}</span>
      ${inviteHtml}
    `;

    // Room click → switch
    li.addEventListener("click", (e) => {
      if (e.target.classList.contains("r-invite")) return;
      handleRoomClick(name, isPrivate);
    });

    // Invite button → copy link
    const inviteButton = li.querySelector(".r-invite");
    if (inviteButton) {
      inviteButton.addEventListener("click", (e) => {
        e.stopPropagation();
        const url = `${location.origin}/#${inviteButton.dataset.code}`;
        navigator.clipboard.writeText(url).then(() => showToast("📋 Invite link copied!"));
      });
    }

    roomListEl.appendChild(li);
  });

  // Update header invite btn
  const myRoom = rooms.find(r => r.name === currentRoom);
  if (myRoom?.isOwn && myRoom?.inviteCode) {
    currentInviteCode = myRoom.inviteCode;
    inviteBtn.classList.remove("hidden");
  } else if (myRoom?.inviteCode === currentRoom) {
    // default public room
    currentInviteCode = currentRoom;
    inviteBtn.classList.remove("hidden");
  } else {
    inviteBtn.classList.add("hidden");
    currentInviteCode = null;
  }
}

// ── Render Users ──────────────────────────────────────────────
function renderUsers(users) {
  userListEl.innerHTML = "";
  users.forEach(({ username, status, avatarColor }) => {
    const li = document.createElement("li");
    li.className = "user-item";
    const color = avatarColor || "#f5a623";
    li.innerHTML = `
      <div class="user-item-avatar" style="color:${color}; border: 1.5px solid ${color}40">
        ${initial(username)}
        <span class="user-status-badge ${status || "online"}"></span>
      </div>
      <span class="user-item-name" style="color:${color}">${esc(username)}</span>
    `;
    userListEl.appendChild(li);
  });
  roomMemberCount.textContent = `${users.length} online`;
}

// ── Append Message ─────────────────────────────────────────────
function appendMessage({ id, username, avatarColor, text, time, replyTo }) {
  const isOwn = username === myUsername;
  const color = avatarColor || "#f5a623";

  const div = document.createElement("div");
  div.className = "msg" + (isOwn ? " own" : "");
  div.dataset.id = id || "";

  const replyHtml = replyTo ? `
    <div class="msg-reply-quote">
      <span class="reply-quote-name">${esc(replyTo.username)}</span>
      <span class="reply-quote-text">${esc(replyTo.text)}</span>
    </div>
  ` : "";

  div.innerHTML = `
    <div class="msg-avatar" style="color:${color}; border-color:${color}40">${initial(username)}</div>
    <div class="msg-body">
      ${replyHtml}
      <div class="msg-meta">
        <span class="msg-author" style="color:${color}">${esc(username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-text">${esc(text)}</div>
    </div>
    <button class="msg-reply-btn" title="Reply">↩</button>
  `;

  // Reply button
  div.querySelector(".msg-reply-btn").addEventListener("click", () => {
    startReply({ username, text });
  });

  messagesEl.appendChild(div);
  scrollBot();
}

// ── Append Voice Note ──────────────────────────────────────────
function appendVoiceNote({ username, avatarColor, audioData, duration, time }) {
  const isOwn = username === myUsername;
  const color = avatarColor || "#f5a623";
  const dur   = Math.round(duration);
  const bars  = Array(8).fill("<span></span>").join("");

  const div = document.createElement("div");
  div.className = "msg" + (isOwn ? " own" : "");
  div.innerHTML = `
    <div class="msg-avatar" style="color:${color}; border-color:${color}40">${initial(username)}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-author" style="color:${color}">${esc(username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="voice-note-player">
        <button class="voice-play-btn">▶</button>
        <div class="voice-waveform">${bars}</div>
        <span class="voice-duration">${fmtTime(dur)}</span>
      </div>
    </div>
  `;

  const audio    = new Audio(audioData);
  const playBtn  = div.querySelector(".voice-play-btn");
  const waveform = div.querySelector(".voice-waveform");

  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
      playBtn.textContent = "⏸"; playBtn.classList.add("playing");
      waveform.classList.add("playing");
    } else {
      audio.pause(); audio.currentTime = 0;
      playBtn.textContent = "▶"; playBtn.classList.remove("playing");
      waveform.classList.remove("playing");
    }
  });
  audio.addEventListener("ended", () => {
    playBtn.textContent = "▶"; playBtn.classList.remove("playing");
    waveform.classList.remove("playing");
  });

  messagesEl.appendChild(div);
  scrollBot();
}

// ── Append Notification ────────────────────────────────────────
function appendNotification({ text, type }) {
  const div = document.createElement("div");
  div.className = "msg notification";
  div.innerHTML = `<span class="notification-text ${type}">${esc(text)}</span>`;
  messagesEl.appendChild(div);
  scrollBot();
}

// ── Reply system ───────────────────────────────────────────────
function startReply({ username, text }) {
  replyingTo = { username, text };
  replyBarName.textContent = username;
  replyBarText.textContent = text.slice(0, 60) + (text.length > 60 ? "…" : "");
  replyBar.classList.remove("hidden");
  msgInput.focus();
}
function cancelReply() {
  replyingTo = null;
  replyBar.classList.add("hidden");
}

// ── Send Message ───────────────────────────────────────────────
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !socket) return;
  socket.emit("message", { text, replyTo: replyingTo });
  msgInput.value = "";
  cancelReply();
  handleTypingStop();
}

// ── Room handling ──────────────────────────────────────────────
function handleRoomClick(room, isPrivate) {
  if (room === currentRoom) return;
  if (isPrivate) {
    pendingPrivateRoom = room;
    pwModalRoomName.textContent = `#${room}`;
    joinPasswordInput.value = "";
    passwordError.classList.add("hidden");
    passwordModal.classList.remove("hidden");
    joinPasswordInput.focus();
  } else {
    socket.emit("switch_room", { room, password: "" });
  }
}

// ── Typing ────────────────────────────────────────────────────
function handleTypingStart() {
  if (!isTyping) { isTyping = true; socket?.emit("typing", { isTyping: true }); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(handleTypingStop, 2000);
}
function handleTypingStop() {
  if (isTyping) { isTyping = false; socket?.emit("typing", { isTyping: false }); }
  clearTimeout(typingTimer);
}
function updateTypingUI() {
  if (!typingUsers.size) { typingIndicator.innerHTML = ""; return; }
  const names = [...typingUsers];
  const label = names.length === 1 ? `${names[0]} is typing`
    : names.length === 2 ? `${names[0]} & ${names[1]} are typing`
    : "several people are typing";
  typingIndicator.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>${esc(label)}…`;
}

// ── Voice Recording ────────────────────────────────────────────
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks  = [];
    mediaRecorder = new MediaRecorder(stream);
    recordingStart = Date.now();
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const dur  = (Date.now() - recordingStart) / 1000;
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onloadend = () => {
        if (socket && dur > 0.5) socket.emit("voice_note", { audioData: reader.result, duration: dur });
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    micBtn.classList.add("recording");
    recordingOverlay.classList.remove("hidden");
    recordingInterval = setInterval(() => {
      const e = Math.floor((Date.now() - recordingStart) / 1000);
      recordingTimer.textContent = fmtTime(e);
    }, 1000);
  } catch {
    appendNotification({ text: "Mic access denied 🎤❌", type: "leave" });
  }
}
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  micBtn.classList.remove("recording");
  recordingOverlay.classList.add("hidden");
  clearInterval(recordingInterval);
  recordingTimer.textContent = "0:00";
}

// ══════════════════════════════════════════════════════════════
//  SOCKET LISTENERS
// ══════════════════════════════════════════════════════════════
function setupSocket() {

  socket.on("welcome", ({ username, room, rooms, usersInRoom, avatarColor, bio }) => {
    myUsername    = username;
    myAvatarColor = avatarColor || myAvatarColor;
    myBio         = bio || "";
    currentRoom   = room;
    showApp();
    renderRooms(rooms);
    renderUsers(usersInRoom);
    currentRoomName.textContent = room;
    appendNotification({ text: `Welcome to #${room}! 🎉`, type: "info" });
  });

  socket.on("message",    p => appendMessage(p));
  socket.on("voice_note", p => appendVoiceNote(p));
  socket.on("notification", p => appendNotification(p));
  socket.on("room_list",    r => renderRooms(r));
  socket.on("users_in_room", u => renderUsers(u));

  socket.on("room_switched", ({ room, usersInRoom }) => {
    currentRoom = room;
    currentRoomName.textContent = room;
    pendingPrivateRoom = null;
    passwordError.classList.add("hidden");
    passwordModal.classList.add("hidden");
    messagesEl.innerHTML = "";
    typingUsers.clear(); updateTypingUI();
    renderUsers(usersInRoom);
    appendNotification({ text: `Switched to #${room}`, type: "info" });

    // Lock icon
    const item = roomListEl.querySelector(`[data-room="${room}"]`);
    roomLockIcon.classList.toggle("hidden", item?.dataset.private !== "true");
  });

  socket.on("room_error", ({ message }) => {
    passwordError.textContent = message;
    passwordError.classList.remove("hidden");
    joinPasswordInput.value = "";
    joinPasswordInput.focus();
    passwordModal.classList.remove("hidden");
  });

  socket.on("switch_room_request", ({ room, password }) => {
    socket.emit("switch_room", { room, password: password || "" });
  });

  socket.on("profile_updated", ({ bio, avatarColor, status }) => {
    myBio = bio; myAvatarColor = avatarColor; myStatus = status;
    updateProfileUI();
  });

  socket.on("typing", ({ username, isTyping: t }) => {
    if (t) typingUsers.add(username); else typingUsers.delete(username);
    updateTypingUI();
  });

  socket.on("disconnect", () => appendNotification({ text: "Disconnected… reconnecting", type: "leave" }));
  socket.on("connect",    () => { if (myUsername) socket.emit("join", { username: myUsername, avatarColor: myAvatarColor, bio: myBio }); });
}

// ══════════════════════════════════════════════════════════════
//  DOM EVENT LISTENERS
// ══════════════════════════════════════════════════════════════

// Landing
joinBtn.addEventListener("click", join);
usernameInput.addEventListener("keydown", e => { if (e.key === "Enter") join(); });

// Chat
sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
msgInput.addEventListener("input", () => { msgInput.value.trim() ? handleTypingStart() : handleTypingStop(); });
replyCancel.addEventListener("click", cancelReply);

// Invite btn (header)
inviteBtn.addEventListener("click", () => {
  if (!currentInviteCode) return;
  const url = `${location.origin}/#${currentInviteCode}`;
  navigator.clipboard.writeText(url).then(() => showToast("📋 Invite link copied!"));
});

// Panel toggle (mobile)
panelToggle.addEventListener("click", () => rightPanel.classList.toggle("open"));

// ── Profile ──────────────────────────────────────────────────
bioInput.addEventListener("input", () => {
  bioCharCount.textContent = `${bioInput.value.length}/100`;
});
saveBioBtn.addEventListener("click", () => {
  myBio = bioInput.value.trim();
  socket?.emit("update_profile", { bio: myBio, avatarColor: myAvatarColor, status: myStatus });
  showToast("✅ Bio saved!");
});

// Avatar color
colorGrid.addEventListener("click", e => {
  const swatch = e.target.closest(".color-swatch");
  if (!swatch) return;
  myAvatarColor = swatch.dataset.color;
  socket?.emit("update_profile", { bio: myBio, avatarColor: myAvatarColor, status: myStatus });
  updateProfileUI();
  showToast("🎨 Color updated!");
});

// Status buttons
statusBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    myStatus = btn.dataset.status;
    socket?.emit("update_profile", { bio: myBio, avatarColor: myAvatarColor, status: myStatus });
    statusBtns.forEach(b => b.classList.toggle("active", b === btn));
    showToast(`Status: ${myStatus}`);
  });
});

// ── Mic ──────────────────────────────────────────────────────
micBtn.addEventListener("mousedown",  e => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("mouseup",    stopRecording);
micBtn.addEventListener("mouseleave", stopRecording);
micBtn.addEventListener("touchstart", e => { e.preventDefault(); startRecording(); }, { passive: false });
micBtn.addEventListener("touchend",   stopRecording);

// ── Create Room Modal ─────────────────────────────────────────
createRoomBtn.addEventListener("click", () => {
  newRoomInput.value = ""; roomPasswordInput.value = "";
  isPrivateRoom = false;
  togglePublic.classList.add("active"); togglePrivate.classList.remove("active");
  passwordWrap.classList.add("hidden");
  createModal.classList.remove("hidden"); newRoomInput.focus();
});
modalCancel.addEventListener("click",  () => createModal.classList.add("hidden"));
createModal.addEventListener("click",  e => { if (e.target === createModal) createModal.classList.add("hidden"); });

togglePublic.addEventListener("click", () => {
  isPrivateRoom = false;
  togglePublic.classList.add("active"); togglePrivate.classList.remove("active");
  passwordWrap.classList.add("hidden");
});
togglePrivate.addEventListener("click", () => {
  isPrivateRoom = true;
  togglePrivate.classList.add("active"); togglePublic.classList.remove("active");
  passwordWrap.classList.remove("hidden"); roomPasswordInput.focus();
});

function confirmCreateRoom() {
  const name = newRoomInput.value.trim();
  if (!name || !socket) return;
  socket.emit("create_room", { room: name, isPrivate: isPrivateRoom, password: isPrivateRoom ? roomPasswordInput.value.trim() : "" });
  createModal.classList.add("hidden");
}
modalConfirm.addEventListener("click", confirmCreateRoom);
newRoomInput.addEventListener("keydown", e => { if (e.key === "Enter") confirmCreateRoom(); if (e.key === "Escape") createModal.classList.add("hidden"); });

// ── Password Modal ────────────────────────────────────────────
pwModalCancel.addEventListener("click",  () => { passwordModal.classList.add("hidden"); pendingPrivateRoom = null; });
passwordModal.addEventListener("click",  e => { if (e.target === passwordModal) { passwordModal.classList.add("hidden"); pendingPrivateRoom = null; } });

function confirmJoinPrivate() {
  if (!pendingPrivateRoom) return;
  socket.emit("switch_room", { room: pendingPrivateRoom, password: joinPasswordInput.value });
}
pwModalConfirm.addEventListener("click", confirmJoinPrivate);
joinPasswordInput.addEventListener("keydown", e => { if (e.key === "Enter") confirmJoinPrivate(); if (e.key === "Escape") { passwordModal.classList.add("hidden"); pendingPrivateRoom = null; } });
