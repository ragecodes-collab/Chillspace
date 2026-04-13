// ============================================================
//  ChillSpace v2 — Client Script
//  New: Voice notes, Private rooms with passwords
// ============================================================

// ── DOM Elements ─────────────────────────────────────────────
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
const myAvatarEl       = document.getElementById("my-avatar");
const myUsernameEl     = document.getElementById("my-username");

// Mic / recording
const micBtn            = document.getElementById("mic-btn");
const recordingOverlay  = document.getElementById("recording-overlay");
const recordingTimer    = document.getElementById("recording-timer");

// Create room modal
const createRoomBtn     = document.getElementById("create-room-btn");
const modal             = document.getElementById("create-room-modal");
const newRoomInput      = document.getElementById("new-room-input");
const togglePublic      = document.getElementById("toggle-public");
const togglePrivate     = document.getElementById("toggle-private");
const passwordWrap      = document.getElementById("password-wrap");
const roomPasswordInput = document.getElementById("room-password-input");
const modalCancel       = document.getElementById("modal-cancel");
const modalConfirm      = document.getElementById("modal-confirm");

// Password modal (join private room)
const passwordModal        = document.getElementById("password-modal");
const passwordModalRoomName = document.getElementById("password-modal-room-name");
const joinPasswordInput    = document.getElementById("join-password-input");
const passwordError        = document.getElementById("password-error");
const passwordModalCancel  = document.getElementById("password-modal-cancel");
const passwordModalConfirm = document.getElementById("password-modal-confirm");

const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebar       = document.querySelector(".sidebar");

// ── State ─────────────────────────────────────────────────────
let myUsername    = "";
let currentRoom   = "general";
let socket        = null;
let typingTimer   = null;
let isTyping      = false;
const typingUsers = new Set();

// Recording state
let mediaRecorder   = null;
let audioChunks     = [];
let recordingStart  = null;
let recordingInterval = null;
let pendingPrivateRoom = null; // room name waiting for password

// ── Helpers ──────────────────────────────────────────────────
function initial(name)  { return name.charAt(0).toUpperCase(); }
function usernameColor(name) {
  let hash = 0;
  for (const ch of name) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 60%, 65%)`;
}
function escapeHTML(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;").replace(/'/g,"&#x27;");
}
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// ── Join ──────────────────────────────────────────────────────
function join() {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.style.borderColor = "var(--red)";
    setTimeout(() => (usernameInput.style.borderColor = ""), 800);
    return;
  }
  myUsername = name;
  socket = io();
  setupSocketListeners();
  socket.emit("join", { username: name });
}

function showApp() {
  landing.classList.add("hidden");
  app.classList.remove("hidden");
  myUsernameEl.textContent   = myUsername;
  myAvatarEl.textContent     = initial(myUsername);
  myAvatarEl.style.color     = usernameColor(myUsername);
  myAvatarEl.style.borderColor = usernameColor(myUsername);
  msgInput.focus();
}

// ── Render room list ──────────────────────────────────────────
function renderRooms(rooms) {
  roomListEl.innerHTML = "";
  rooms.forEach(({ name, count, isPrivate }) => {
    const li = document.createElement("li");
    li.className = "room-item" + (name === currentRoom ? " active" : "");
    li.dataset.room = name;
    li.dataset.private = isPrivate ? "true" : "false";
    li.innerHTML = `
      <span class="hash-sign">#</span>
      <span>${escapeHTML(name)}</span>
      ${isPrivate ? '<span class="lock-icon">🔒</span>' : ""}
      <span class="room-count">${count}</span>
    `;
    li.addEventListener("click", () => handleRoomClick(name, isPrivate));
    roomListEl.appendChild(li);
  });
}

// ── Handle room click (private check) ────────────────────────
function handleRoomClick(room, isPrivate) {
  if (room === currentRoom) return;
  if (isPrivate) {
    // Show password modal
    pendingPrivateRoom = room;
    passwordModalRoomName.textContent = `#${room}`;
    joinPasswordInput.value = "";
    passwordError.classList.add("hidden");
    passwordModal.classList.remove("hidden");
    joinPasswordInput.focus();
  } else {
    switchRoom(room, "");
  }
  closeSidebar();
}

// ── Render users ──────────────────────────────────────────────
function renderUsers(users) {
  userListEl.innerHTML = "";
  users.forEach((uname) => {
    const li = document.createElement("li");
    li.className = "user-item";
    li.innerHTML = `<span class="user-dot"></span><span style="color:${usernameColor(uname)}">${escapeHTML(uname)}</span>`;
    userListEl.appendChild(li);
  });
  roomMemberCount.textContent = `${users.length} member${users.length !== 1 ? "s" : ""}`;
}

// ── Append chat message ───────────────────────────────────────
function appendMessage({ username, text, time }) {
  const isOwn  = username === myUsername;
  const color  = usernameColor(username);
  const div    = document.createElement("div");
  div.className = "msg" + (isOwn ? " own" : "");
  div.innerHTML = `
    <div class="msg-avatar" style="color:${color};border-color:${color}30">${initial(username)}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-author" style="color:${color}">${escapeHTML(username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-text">${escapeHTML(text)}</div>
    </div>
  `;
  messagesEl.appendChild(div);
  scrollToBottom();
}

// ── Append voice note ─────────────────────────────────────────
function appendVoiceNote({ username, audioData, duration, time }) {
  const isOwn = username === myUsername;
  const color = usernameColor(username);
  const dur   = Math.round(duration);

  const div = document.createElement("div");
  div.className = "msg" + (isOwn ? " own" : "");

  // Build waveform bars
  const bars = Array.from({ length: 8 }, () => "<span></span>").join("");

  div.innerHTML = `
    <div class="msg-avatar" style="color:${color};border-color:${color}30">${initial(username)}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-author" style="color:${color}">${escapeHTML(username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="voice-note-player">
        <button class="voice-play-btn" aria-label="Play voice note">▶</button>
        <div class="voice-waveform">${bars}</div>
        <span class="voice-duration">${formatDuration(dur)}</span>
      </div>
    </div>
  `;

  // Create audio element from base64
  const audio    = new Audio(audioData);
  const playBtn  = div.querySelector(".voice-play-btn");
  const waveform = div.querySelector(".voice-waveform");

  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
      playBtn.textContent = "⏸";
      playBtn.classList.add("playing");
      waveform.classList.add("playing");
    } else {
      audio.pause();
      audio.currentTime = 0;
      playBtn.textContent = "▶";
      playBtn.classList.remove("playing");
      waveform.classList.remove("playing");
    }
  });

  audio.addEventListener("ended", () => {
    playBtn.textContent = "▶";
    playBtn.classList.remove("playing");
    waveform.classList.remove("playing");
  });

  messagesEl.appendChild(div);
  scrollToBottom();
}

// ── Append notification ───────────────────────────────────────
function appendNotification({ text, type }) {
  const div = document.createElement("div");
  div.className = "msg notification";
  div.innerHTML = `<span class="notification-text ${type}">${escapeHTML(text)}</span>`;
  messagesEl.appendChild(div);
  scrollToBottom();
}

// ── Send message ──────────────────────────────────────────────
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !socket) return;
  socket.emit("message", { text });
  msgInput.value = "";
  handleTypingStop();
}

// ── Switch room ───────────────────────────────────────────────
function switchRoom(room, password) {
  if (room === currentRoom || !socket) return;
  socket.emit("switch_room", { room, password: password || "" });
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
function updateTypingIndicator() {
  if (typingUsers.size === 0) { typingIndicator.innerHTML = ""; return; }
  const names = [...typingUsers];
  const label = names.length === 1 ? `${names[0]} is typing`
    : names.length === 2 ? `${names[0]} and ${names[1]} are typing`
    : `several people are typing`;
  typingIndicator.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>${escapeHTML(label)}…`;
}

// ══════════════════════════════════════════════════════════════
//  VOICE RECORDING
// ══════════════════════════════════════════════════════════════

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks  = [];
    mediaRecorder = new MediaRecorder(stream);
    recordingStart = Date.now();

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const duration = (Date.now() - recordingStart) / 1000;
      const blob     = new Blob(audioChunks, { type: "audio/webm" });

      // Convert blob to base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result; // data:audio/webm;base64,...
        if (socket && duration > 0.5) { // only send if > 0.5s
          socket.emit("voice_note", { audioData: base64, duration });
        }
      };
      reader.readAsDataURL(blob);

      // Stop all tracks
      stream.getTracks().forEach((t) => t.stop());
    };

    mediaRecorder.start();
    micBtn.classList.add("recording");
    recordingOverlay.classList.remove("hidden");

    // Update timer every second
    recordingInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStart) / 1000);
      recordingTimer.textContent = formatDuration(elapsed);
    }, 1000);

  } catch (err) {
    console.error("Mic access denied:", err);
    appendNotification({ text: "Microphone access denied 🎤❌", type: "leave" });
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  micBtn.classList.remove("recording");
  recordingOverlay.classList.add("hidden");
  clearInterval(recordingInterval);
  recordingTimer.textContent = "0:00";
}

// ── Mic button: hold to record (mouse + touch) ────────────────
micBtn.addEventListener("mousedown",  (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("mouseup",    stopRecording);
micBtn.addEventListener("mouseleave", stopRecording);
micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); }, { passive: false });
micBtn.addEventListener("touchend",   stopRecording);

// ══════════════════════════════════════════════════════════════
//  CREATE ROOM MODAL
// ══════════════════════════════════════════════════════════════

let isPrivateRoom = false;

function openCreateModal() {
  modal.classList.remove("hidden");
  newRoomInput.value = "";
  roomPasswordInput.value = "";
  isPrivateRoom = false;
  togglePublic.classList.add("active");
  togglePrivate.classList.remove("active");
  passwordWrap.classList.add("hidden");
  newRoomInput.focus();
}
function closeCreateModal() { modal.classList.add("hidden"); }

function confirmCreateRoom() {
  const name = newRoomInput.value.trim();
  if (!name || !socket) return;
  const password = isPrivateRoom ? roomPasswordInput.value.trim() : "";
  socket.emit("create_room", { room: name, isPrivate: isPrivateRoom, password });
  closeCreateModal();
}

togglePublic.addEventListener("click", () => {
  isPrivateRoom = false;
  togglePublic.classList.add("active");
  togglePrivate.classList.remove("active");
  passwordWrap.classList.add("hidden");
});
togglePrivate.addEventListener("click", () => {
  isPrivateRoom = true;
  togglePrivate.classList.add("active");
  togglePublic.classList.remove("active");
  passwordWrap.classList.remove("hidden");
  roomPasswordInput.focus();
});

createRoomBtn.addEventListener("click", openCreateModal);
modalCancel.addEventListener("click", closeCreateModal);
modalConfirm.addEventListener("click", confirmCreateRoom);
newRoomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmCreateRoom(); if (e.key === "Escape") closeCreateModal(); });
modal.addEventListener("click", (e) => { if (e.target === modal) closeCreateModal(); });

// ══════════════════════════════════════════════════════════════
//  PASSWORD MODAL (join private room)
// ══════════════════════════════════════════════════════════════

function closePasswordModal() {
  passwordModal.classList.add("hidden");
  pendingPrivateRoom = null;
}

function confirmJoinPrivate() {
  if (!pendingPrivateRoom) return;
  const pw = joinPasswordInput.value;
  switchRoom(pendingPrivateRoom, pw);
  passwordModal.classList.add("hidden");
  // Don't clear pendingPrivateRoom yet — wait for error or success
}

passwordModalCancel.addEventListener("click", closePasswordModal);
passwordModalConfirm.addEventListener("click", confirmJoinPrivate);
joinPasswordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmJoinPrivate(); if (e.key === "Escape") closePasswordModal(); });
passwordModal.addEventListener("click", (e) => { if (e.target === passwordModal) closePasswordModal(); });

// ══════════════════════════════════════════════════════════════
//  SOCKET LISTENERS
// ══════════════════════════════════════════════════════════════
function setupSocketListeners() {

  socket.on("welcome", ({ username, room, rooms, usersInRoom }) => {
    myUsername  = username;
    currentRoom = room;
    showApp();
    renderRooms(rooms);
    renderUsers(usersInRoom);
    currentRoomName.textContent = currentRoom;
    appendNotification({ text: `Welcome to #${room}! 🎉`, type: "info" });
  });

  socket.on("message", (payload) => appendMessage(payload));

  socket.on("voice_note", (payload) => appendVoiceNote(payload));

  socket.on("notification", (payload) => appendNotification(payload));

  socket.on("room_list", (rooms) => renderRooms(rooms));

  socket.on("users_in_room", (users) => renderUsers(users));

  socket.on("room_switched", ({ room, usersInRoom }) => {
    currentRoom = room;
    currentRoomName.textContent = room;
    pendingPrivateRoom = null;
    passwordError.classList.add("hidden");
    messagesEl.innerHTML = "";
    typingUsers.clear();
    updateTypingIndicator();
    renderUsers(usersInRoom);
    appendNotification({ text: `You joined #${room}`, type: "info" });

    // Show lock icon if private
    const roomItem = roomListEl.querySelector(`[data-room="${room}"]`);
    if (roomItem?.dataset.private === "true") {
      roomLockIcon.classList.remove("hidden");
    } else {
      roomLockIcon.classList.add("hidden");
    }
  });

  socket.on("room_error", ({ message }) => {
    // Wrong password
    passwordError.textContent = message;
    passwordError.classList.remove("hidden");
    joinPasswordInput.value = "";
    joinPasswordInput.focus();
    passwordModal.classList.remove("hidden"); // re-show if dismissed
  });

  socket.on("switch_room_request", ({ room, password }) => {
    socket.emit("switch_room", { room, password: password || "" });
  });

  socket.on("typing", ({ username, isTyping: typing }) => {
    if (typing) typingUsers.add(username); else typingUsers.delete(username);
    updateTypingIndicator();
  });

  socket.on("disconnect", () => appendNotification({ text: "Disconnected. Reconnecting…", type: "leave" }));

  socket.on("connect", () => {
    if (myUsername) socket.emit("join", { username: myUsername });
  });
}

// ══════════════════════════════════════════════════════════════
//  BASIC EVENT LISTENERS
// ══════════════════════════════════════════════════════════════

joinBtn.addEventListener("click", join);
usernameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });

sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
msgInput.addEventListener("input", () => {
  if (msgInput.value.trim()) handleTypingStart(); else handleTypingStop();
});

sidebarToggle.addEventListener("click", toggleSidebar);
app.addEventListener("click", (e) => {
  if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== sidebarToggle) closeSidebar();
});

function toggleSidebar() { sidebar.classList.toggle("open"); }
function closeSidebar()  { sidebar.classList.remove("open"); }
