// ============================================================
//  ChillSpace v2 — Server
//  New: Voice notes, Private rooms with password, No music room
// ============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6 // 5MB max for voice notes
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ── In-memory state ──────────────────────────────────────────

// Map of socketId → { username, room }
const users = {};

// Map of roomName → { members: Set, isPrivate: bool, password: string, createdBy: string }
const rooms = {
  "general": { members: new Set(), isPrivate: false, password: "", createdBy: "system" },
  "gaming":  { members: new Set(), isPrivate: false, password: "", createdBy: "system" },
};

// ── Helpers ──────────────────────────────────────────────────

/** Room list — only show public rooms + rooms the user is in */
function getRoomListForUser(socketId) {
  const user = users[socketId];
  return Object.entries(rooms).map(([name, data]) => ({
    name,
    count: data.members.size,
    isPrivate: data.isPrivate,
    // user can see private room if they're already in it
    isMember: user?.room === name,
  }));
}

/** Public room list for everyone */
function getPublicRoomList() {
  return Object.entries(rooms).map(([name, data]) => ({
    name,
    count: data.members.size,
    isPrivate: data.isPrivate,
  }));
}

function getUsersInRoom(room) {
  return Object.values(users)
    .filter((u) => u.room === room)
    .map((u) => u.username);
}

function broadcastRooms() {
  // Send each socket a room list
  Object.keys(users).forEach((sid) => {
    const socket = io.sockets.sockets.get(sid);
    if (socket) socket.emit("room_list", getRoomListForUser(sid));
  });
  // Also broadcast to anyone not yet in users map
  io.emit("room_list_public", getPublicRoomList());
}

// ── Socket.IO events ─────────────────────────────────────────
io.on("connection", (socket) => {

  // ── 1. Join ──────────────────────────────────────────────
  socket.on("join", ({ username }) => {
    const name = username.trim().slice(0, 24) || "Anonymous";
    const room = "general";

    users[socket.id] = { username: name, room };
    socket.join(room);
    rooms[room].members.add(socket.id);

    console.log(`[+] ${name} connected → #${room}`);

    socket.emit("welcome", {
      username: name,
      room,
      rooms: getRoomListForUser(socket.id),
      usersInRoom: getUsersInRoom(room),
    });

    socket.to(room).emit("notification", { text: `${name} joined #${room} 👋`, type: "join" });
    io.to(room).emit("users_in_room", getUsersInRoom(room));
    broadcastRooms();
  });

  // ── 2. Chat message ──────────────────────────────────────
  socket.on("message", ({ text }) => {
    const user = users[socket.id];
    if (!user) return;
    const clean = text.trim();
    if (!clean) return;

    io.to(user.room).emit("message", {
      username: user.username,
      text: clean,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  });

  // ── 3. Voice note ────────────────────────────────────────
  socket.on("voice_note", ({ audioData, duration }) => {
    const user = users[socket.id];
    if (!user || !audioData) return;

    // Broadcast audio to everyone in the room (including sender)
    io.to(user.room).emit("voice_note", {
      username: user.username,
      audioData, // base64 encoded audio
      duration: duration || 0,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });

    console.log(`[voice] #${user.room} | ${user.username} sent a voice note`);
  });

  // ── 4. Switch room ───────────────────────────────────────
  socket.on("switch_room", ({ room: newRoom, password }) => {
    const user = users[socket.id];
    if (!user || !rooms[newRoom]) return;

    const roomData = rooms[newRoom];

    // Check password for private rooms
    if (roomData.isPrivate && roomData.password !== password) {
      socket.emit("room_error", { message: "Wrong password! 🔒" });
      return;
    }

    const oldRoom = user.room;
    if (oldRoom === newRoom) return;

    // Leave old room
    socket.leave(oldRoom);
    rooms[oldRoom].members.delete(socket.id);
    socket.to(oldRoom).emit("notification", { text: `${user.username} left #${oldRoom}`, type: "leave" });
    io.to(oldRoom).emit("users_in_room", getUsersInRoom(oldRoom));

    // Join new room
    user.room = newRoom;
    socket.join(newRoom);
    roomData.members.add(socket.id);
    socket.to(newRoom).emit("notification", { text: `${user.username} joined #${newRoom} 👋`, type: "join" });

    socket.emit("room_switched", {
      room: newRoom,
      usersInRoom: getUsersInRoom(newRoom),
    });

    io.to(newRoom).emit("users_in_room", getUsersInRoom(newRoom));
    broadcastRooms();
  });

  // ── 5. Create room ───────────────────────────────────────
  socket.on("create_room", ({ room: newRoom, isPrivate, password }) => {
    const user = users[socket.id];
    if (!user) return;

    const name = newRoom.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 20);
    if (!name) return;

    if (!rooms[name]) {
      rooms[name] = {
        members: new Set(),
        isPrivate: !!isPrivate,
        password: isPrivate ? (password || "") : "",
        createdBy: user.username,
      };

      const visibility = isPrivate ? "🔒 private" : "🌐 public";
      io.emit("notification", { text: `#${name} was created (${visibility}) 🎉`, type: "info" });
      console.log(`[room] #${name} created by ${user.username} | private: ${!!isPrivate}`);
    }

    broadcastRooms();
    socket.emit("switch_room_request", { room: name, password: isPrivate ? password : "" });
  });

  // ── 6. Typing ────────────────────────────────────────────
  socket.on("typing", ({ isTyping }) => {
    const user = users[socket.id];
    if (!user) return;
    socket.to(user.room).emit("typing", { username: user.username, isTyping });
  });

  // ── 7. Disconnect ────────────────────────────────────────
  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (!user) return;

    const { username, room } = user;
    rooms[room]?.members.delete(socket.id);
    delete users[socket.id];

    socket.to(room).emit("notification", { text: `${username} left the space`, type: "leave" });
    io.to(room).emit("users_in_room", getUsersInRoom(room));
    broadcastRooms();

    console.log(`[-] ${username} disconnected`);
  });
});

server.listen(PORT, () => {
  console.log(`✅  ChillSpace v2 running → http://localhost:${PORT}`);
});
