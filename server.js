// ============================================================
//  ChillSpace — Server
//  Stack: Node.js + Express + Socket.IO (no database, in-memory)
// ============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ── Serve static files from /public ──────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── In-memory state ──────────────────────────────────────────
// Map of socketId → { username, room }
const users = {};

// Map of roomName → Set of socketIds
const rooms = {
  "general": new Set(),
  "gaming":  new Set(),
  "music":   new Set(),
};

// ── Helpers ──────────────────────────────────────────────────

/** Return a plain list of room names + member counts */
function getRoomList() {
  return Object.entries(rooms).map(([name, members]) => ({
    name,
    count: members.size,
  }));
}

/** Return list of users currently in a given room */
function getUsersInRoom(room) {
  return Object.values(users)
    .filter((u) => u.room === room)
    .map((u) => u.username);
}

/** Broadcast updated room list to every connected client */
function broadcastRooms() {
  io.emit("room_list", getRoomList());
}

// ── Socket.IO events ─────────────────────────────────────────
io.on("connection", (socket) => {

  // ── 1. User joins with a username ────────────────────────
  socket.on("join", ({ username }) => {
    const name = username.trim().slice(0, 24) || "Anonymous";
    const room = "general"; // always start in General

    // Store user info
    users[socket.id] = { username: name, room };

    // Join the Socket.IO room
    socket.join(room);
    rooms[room].add(socket.id);

    console.log(`[+] ${name} connected → #${room}`);

    // Tell this client who they are + current state
    socket.emit("welcome", {
      username: name,
      room,
      rooms: getRoomList(),
      usersInRoom: getUsersInRoom(room),
    });

    // Notify everyone else in the room
    socket.to(room).emit("notification", {
      text: `${name} joined #${room} 👋`,
      type: "join",
    });

    // Update user list for everyone in the room
    io.to(room).emit("users_in_room", getUsersInRoom(room));

    // Update room list counts for all clients
    broadcastRooms();
  });

  // ── 2. User sends a chat message ─────────────────────────
  socket.on("message", ({ text }) => {
    const user = users[socket.id];
    if (!user) return;

    const clean = text.trim();
    if (!clean) return; // ignore empty messages

    const payload = {
      username: user.username,
      text: clean,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    // Broadcast to everyone in the same room (including sender)
    io.to(user.room).emit("message", payload);
    console.log(`[msg] #${user.room} | ${user.username}: ${clean}`);
  });

  // ── 3. User switches rooms ────────────────────────────────
  socket.on("switch_room", ({ room: newRoom }) => {
    const user = users[socket.id];
    if (!user) return;

    // Only allow known rooms (or newly created ones)
    if (!rooms[newRoom]) return;

    const oldRoom = user.room;
    if (oldRoom === newRoom) return;

    // Leave old room
    socket.leave(oldRoom);
    rooms[oldRoom].delete(socket.id);
    socket.to(oldRoom).emit("notification", {
      text: `${user.username} left #${oldRoom}`,
      type: "leave",
    });
    io.to(oldRoom).emit("users_in_room", getUsersInRoom(oldRoom));

    // Join new room
    user.room = newRoom;
    socket.join(newRoom);
    rooms[newRoom].add(socket.id);
    socket.to(newRoom).emit("notification", {
      text: `${user.username} joined #${newRoom} 👋`,
      type: "join",
    });

    // Confirm switch to the client
    socket.emit("room_switched", {
      room: newRoom,
      usersInRoom: getUsersInRoom(newRoom),
    });

    io.to(newRoom).emit("users_in_room", getUsersInRoom(newRoom));
    broadcastRooms();

    console.log(`[switch] ${user.username}: #${oldRoom} → #${newRoom}`);
  });

  // ── 4. User creates a new room ────────────────────────────
  socket.on("create_room", ({ room: newRoom }) => {
    const user = users[socket.id];
    if (!user) return;

    const name = newRoom.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 20);
    if (!name) return;
    if (rooms[name]) {
      // Room already exists — just switch to it
      socket.emit("notification", { text: `#${name} already exists. Switching…`, type: "info" });
    } else {
      rooms[name] = new Set();
      io.emit("notification", { text: `#${name} was created 🎉`, type: "info" });
      console.log(`[room] #${name} created by ${user.username}`);
    }

    broadcastRooms();
    // Now switch the creator into the new room
    socket.emit("switch_room_request", { room: name });
  });

  // ── 5. Typing indicators ──────────────────────────────────
  socket.on("typing", ({ isTyping }) => {
    const user = users[socket.id];
    if (!user) return;
    socket.to(user.room).emit("typing", {
      username: user.username,
      isTyping,
    });
  });

  // ── 6. Disconnect ─────────────────────────────────────────
  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (!user) return;

    const { username, room } = user;
    rooms[room]?.delete(socket.id);
    delete users[socket.id];

    socket.to(room).emit("notification", {
      text: `${username} left the space`,
      type: "leave",
    });
    io.to(room).emit("users_in_room", getUsersInRoom(room));
    broadcastRooms();

    console.log(`[-] ${username} disconnected`);
  });
});

// ── Start server ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅  ChillSpace running → http://localhost:${PORT}`);
});
