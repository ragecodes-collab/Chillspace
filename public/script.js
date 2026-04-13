// ============================================================
//  ChillSpace — Client Script
//  Handles: Socket.IO events, UI updates, chat, rooms, typing
// ============================================================

// ── Grab DOM elements ────────────────────────────────────────
const landing         = document.getElementById("landing");
const usernameInput   = document.getElementById("username-input");
const joinBtn         = document.getElementById("join-btn");

const app             = document.getElementById("app");
const messagesEl      = document.getElementById("messages");
const msgInput        = document.getElementById("msg-input");
const sendBtn         = document.getElementById("send-btn");
const roomListEl      = document.getElementById("room-list");
const userListEl      = document.getElementById("user-list");
const currentRoomName = document.getElementById("current-room-name");
const roomMemberCount = document.getElementById("room-member-count");
const typingIndicator = document.getElementById("typing-indicator");
const myAvatarEl      = document.getElementById("my-avatar");
const myUsernameEl    = document.getElementById("my-username");

const createRoomBtn   = document.getElementById("create-room-btn");
const modal           = document.getElementById("create-room-modal");
const newRoomInput    = document.getElementById("new-room-input");
const modalCancel     = document.getElementById("modal-cancel");
const modalConfirm    = document.getElementById("modal-confirm");

const sidebarToggle   = document.getElementById("sidebar-toggle");
const sidebar         = document.querySelector(".sidebar");

// ── App state ────────────────────────────────────────────────
let myUsername  = "";
let currentRoom = "general";
let socket      = null;
let typingTimer = null;
let isTyping    = false;

// Track who is currently typing (by username)
const typingUsers = new Set();

// ── Utility: avatar initial ──────────────────────────────────
function initial(name) {
  return name.charAt(0).toUpperCase();
}

// ── Utility: hue from username (for colored avatars) ─────────
function usernameColor(name) {
  let hash = 0;
  for (const ch of name) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 65%)`;
}

// ── Join: connect socket and send username ───────────────────
function join() {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.focus();
    usernameInput.style.borderColor = "var(--red)";
    setTimeout(() => (usernameInput.style.borderColor = ""), 800);
    return;
  }

  myUsername = name;

  // Connect to the server
  socket = io();

  // Register all listeners before emitting join
  setupSocketListeners();

  // Tell the server who we are
  socket.emit("join", { username: name });
}

// ── Switch to app view ───────────────────────────────────────
function showApp() {
  landing.classList.add("hidden");
  app.classList.remove("hidden");
  myUsernameEl.textContent = myUsername;
  myAvatarEl.textContent   = initial(myUsername);
  myAvatarEl.style.color   = usernameColor(myUsername);
  myAvatarEl.style.borderColor = usernameColor(myUsername);
  msgInput.focus();
}

// ── Render the room list in the sidebar ─────────────────────
function renderRooms(rooms) {
  roomListEl.innerHTML = "";
  rooms.forEach(({ name, count }) => {
    const li = document.createElement("li");
    li.className = "room-item" + (name === currentRoom ? " active" : "");
    li.dataset.room = name;
    li.innerHTML = `
      <span class="hash-sign">#</span>
      <span>${name}</span>
      <span class="room-count">${count}</span>
    `;
    li.addEventListener("click", () => switchRoom(name));
    roomListEl.appendChild(li);
  });
}

// ── Render online users in the sidebar ──────────────────────
function renderUsers(users) {
  userListEl.innerHTML = "";
  users.forEach((uname) => {
    const li = document.createElement("li");
    li.className = "user-item";
    li.innerHTML = `
      <span class="user-dot"></span>
      <span style="color:${usernameColor(uname)}">${uname}</span>
    `;
    userListEl.appendChild(li);
  });
  roomMemberCount.textContent = `${users.length} member${users.length !== 1 ? "s" : ""}`;
}

// ── Append a chat message bubble ────────────────────────────
function appendMessage({ username, text, time }) {
  const isOwn = username === myUsername;

  const div = document.createElement("div");
  div.className = "msg" + (isOwn ? " own" : "");

  const color = usernameColor(username);

  div.innerHTML = `
    <div class="msg-avatar" style="color:${color}; border-color:${color}30">${initial(username)}</div>
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

// ── Append a notification line ───────────────────────────────
function appendNotification({ text, type }) {
  const div = document.createElement("div");
  div.className = "msg notification";
  div.innerHTML = `<span class="notification-text ${type}">${escapeHTML(text)}</span>`;
  messagesEl.appendChild(div);
  scrollToBottom();
}

// ── Scroll chat to the bottom ────────────────────────────────
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Escape HTML to prevent XSS ──────────────────────────────
function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ── Send a message ───────────────────────────────────────────
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !socket) return;

  socket.emit("message", { text });
  msgInput.value = "";

  // Stop typing indicator when message is sent
  handleTypingStop();
}

// ── Switch to a different room ───────────────────────────────
function switchRoom(room) {
  if (room === currentRoom || !socket) return;
  socket.emit("switch_room", { room });
  closeSidebar();
}

// ── Typing indicator logic ───────────────────────────────────
function handleTypingStart() {
  if (!isTyping) {
    isTyping = true;
    socket?.emit("typing", { isTyping: true });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(handleTypingStop, 2000);
}

function handleTypingStop() {
  if (isTyping) {
    isTyping = false;
    socket?.emit("typing", { isTyping: false });
  }
  clearTimeout(typingTimer);
}

// ── Update the typing indicator bar ─────────────────────────
function updateTypingIndicator() {
  if (typingUsers.size === 0) {
    typingIndicator.innerHTML = "";
    return;
  }

  const names = [...typingUsers];
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : `several people are typing`;

  typingIndicator.innerHTML = `
    <div class="typing-dots">
      <span></span><span></span><span></span>
    </div>
    ${escapeHTML(label)}…
  `;
}

// ── Modal helpers ────────────────────────────────────────────
function openModal() {
  modal.classList.remove("hidden");
  newRoomInput.value = "";
  newRoomInput.focus();
}

function closeModal() {
  modal.classList.add("hidden");
}

function confirmCreateRoom() {
  const name = newRoomInput.value.trim();
  if (!name || !socket) return;
  socket.emit("create_room", { room: name });
  closeModal();
}

// ── Sidebar toggle (mobile) ──────────────────────────────────
function toggleSidebar() {
  sidebar.classList.toggle("open");
}

function closeSidebar() {
  sidebar.classList.remove("open");
}

// ── All Socket.IO event listeners ───────────────────────────
function setupSocketListeners() {

  // ── Welcome: initial state on connect ──
  socket.on("welcome", ({ username, room, rooms, usersInRoom }) => {
    myUsername  = username;
    currentRoom = room;

    showApp();
    renderRooms(rooms);
    renderUsers(usersInRoom);
    currentRoomName.textContent = currentRoom;
    appendNotification({ text: `Welcome to #${room}! 🎉`, type: "info" });
  });

  // ── Incoming chat message ──
  socket.on("message", (payload) => {
    appendMessage(payload);
  });

  // ── Notification (join/leave/info) ──
  socket.on("notification", (payload) => {
    appendNotification(payload);
  });

  // ── Updated room list (counts) ──
  socket.on("room_list", (rooms) => {
    renderRooms(rooms);
  });

  // ── Updated user list for current room ──
  socket.on("users_in_room", (users) => {
    renderUsers(users);
  });

  // ── Room switch confirmed by server ──
  socket.on("room_switched", ({ room, usersInRoom }) => {
    currentRoom = room;
    currentRoomName.textContent = room;
    messagesEl.innerHTML = ""; // clear messages for new room
    typingUsers.clear();
    updateTypingIndicator();
    renderUsers(usersInRoom);
    appendNotification({ text: `You joined #${room}`, type: "info" });
  });

  // ── Server asks client to switch room (after creating one) ──
  socket.on("switch_room_request", ({ room }) => {
    socket.emit("switch_room", { room });
  });

  // ── Typing indicator from others ──
  socket.on("typing", ({ username, isTyping: typing }) => {
    if (typing) {
      typingUsers.add(username);
    } else {
      typingUsers.delete(username);
    }
    updateTypingIndicator();
  });

  // ── Connection error / disconnect ──
  socket.on("disconnect", () => {
    appendNotification({ text: "Disconnected. Trying to reconnect…", type: "leave" });
  });

  socket.on("connect", () => {
    // Re-show after reconnect (socket.io auto-reconnects)
    if (myUsername) {
      socket.emit("join", { username: myUsername });
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  Event Listeners (DOM)
// ══════════════════════════════════════════════════════════════

// Join on button click
joinBtn.addEventListener("click", join);

// Join on Enter key
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});

// Send message on button click
sendBtn.addEventListener("click", sendMessage);

// Send message on Enter key (Shift+Enter = newline not needed here)
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Typing indicator: emit when user types
msgInput.addEventListener("input", () => {
  if (msgInput.value.trim()) {
    handleTypingStart();
  } else {
    handleTypingStop();
  }
});

// Create room button
createRoomBtn.addEventListener("click", openModal);

// Modal cancel
modalCancel.addEventListener("click", closeModal);

// Modal confirm
modalConfirm.addEventListener("click", confirmCreateRoom);

// Modal Enter key
newRoomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") confirmCreateRoom();
  if (e.key === "Escape") closeModal();
});

// Close modal clicking overlay
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// Mobile sidebar toggle
sidebarToggle.addEventListener("click", toggleSidebar);

// Close sidebar when clicking outside (mobile)
app.addEventListener("click", (e) => {
  if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== sidebarToggle) {
    closeSidebar();
  }
});
