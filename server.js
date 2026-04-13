// ============================================================
//  ChillSpace v3 — Server
//  New: Message replies, Private rooms (creator only),
//       Invite links, Online/Busy/Offline status, Profile
// ============================================================

const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");
const path    = require("path");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { maxHttpBufferSize: 5e6 });
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ── In-memory state ──────────────────────────────────────────

// socketId → { username, room, status, bio, avatarColor, createdRooms[] }
const users = {};

// roomName → { members: Set, isPrivate, password, createdBy, inviteCode }
const rooms = {
  general: { members: new Set(), isPrivate: false, password: "", createdBy: "system", inviteCode: "general" },
  gaming:  { members: new Set(), isPrivate: false, password: "", createdBy: "system", inviteCode: "gaming"  },
};

// inviteCode → roomName
const inviteCodes = {
  general: "general",
  gaming:  "gaming",
};

// ── Helpers ──────────────────────────────────────────────────

function generateCode() {
  return Math.random().toString(36).substring(2, 8);
}

// Rooms visible to a specific socket:
// - Default public rooms (general, gaming)
// - Public rooms created by anyone
// - Private rooms created BY this user
function getRoomsForSocket(socketId) {
  const user = users[socketId];
  return Object.entries(rooms).map(([name, data]) => {
    const isOwn    = data.createdBy === user?.username;
    const isSystem = data.createdBy === "system";
    const visible  = !data.isPrivate || isOwn || isSystem;
    return {
      name,
      count:     data.members.size,
      isPrivate: data.isPrivate,
      isOwn,
      inviteCode: (isOwn || isSystem) ? data.inviteCode : null,
      visible,
    };
  }).filter(r => r.visible);
}

function getUsersInRoom(room) {
  return Object.values(users)
    .filter(u => u.room === room)
    .map(u => ({
      username:    u.username,
      status:      u.status,
      avatarColor: u.avatarColor,
    }));
}

function broadcastRoomLists() {
  Object.keys(users).forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit("room_list", getRoomsForSocket(sid));
  });
}

// ── Socket events ─────────────────────────────────────────────
io.on("connection", socket => {

  // 1. JOIN
  socket.on("join", ({ username, avatarColor, bio }) => {
    const name = (username || "").trim().slice(0, 24) || "Anonymous";
    const room = "general";

    users[socket.id] = {
      username:    name,
      room,
      status:      "online",
      bio:         bio || "",
      avatarColor: avatarColor || "#f5a623",
      createdRooms: [],
    };

    socket.join(room);
    rooms[room].members.add(socket.id);

    socket.emit("welcome", {
      username:    name,
      room,
      rooms:       getRoomsForSocket(socket.id),
      usersInRoom: getUsersInRoom(room),
      avatarColor: users[socket.id].avatarColor,
      bio:         users[socket.id].bio,
    });

    socket.to(room).emit("notification", { text: `${name} joined 👋`, type: "join" });
    io.to(room).emit("users_in_room", getUsersInRoom(room));
    broadcastRoomLists();
  });

  // 2. CHAT MESSAGE (with optional reply)
  socket.on("message", ({ text, replyTo }) => {
    const user = users[socket.id];
    if (!user) return;
    const clean = text.trim();
    if (!clean) return;

    io.to(user.room).emit("message", {
      id:          Date.now() + socket.id,
      username:    user.username,
      avatarColor: user.avatarColor,
      text:        clean,
      time:        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      replyTo:     replyTo || null, // { username, text }
    });
  });

  // 3. VOICE NOTE
  socket.on("voice_note", ({ audioData, duration }) => {
    const user = users[socket.id];
    if (!user || !audioData) return;
    io.to(user.room).emit("voice_note", {
      username:    user.username,
      avatarColor: user.avatarColor,
      audioData,
      duration:    duration || 0,
      time:        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  });

  // 4. UPDATE PROFILE
  socket.on("update_profile", ({ bio, avatarColor, status }) => {
    const user = users[socket.id];
    if (!user) return;
    if (bio         !== undefined) user.bio         = bio.slice(0, 100);
    if (avatarColor !== undefined) user.avatarColor = avatarColor;
    if (status      !== undefined) user.status      = status;

    // Notify room of status/profile change
    io.to(user.room).emit("users_in_room", getUsersInRoom(user.room));
    socket.emit("profile_updated", { bio: user.bio, avatarColor: user.avatarColor, status: user.status });
  });

  // 5. SWITCH ROOM
  socket.on("switch_room", ({ room: newRoom, password }) => {
    const user = users[socket.id];
    if (!user || !rooms[newRoom]) return;

    const roomData = rooms[newRoom];
    if (roomData.isPrivate && roomData.createdBy !== user.username) {
      if (roomData.password !== password) {
        socket.emit("room_error", { message: "Wrong password 🔒" });
        return;
      }
    }

    const oldRoom = user.room;
    if (oldRoom === newRoom) return;

    socket.leave(oldRoom);
    rooms[oldRoom].members.delete(socket.id);
    socket.to(oldRoom).emit("notification", { text: `${user.username} left`, type: "leave" });
    io.to(oldRoom).emit("users_in_room", getUsersInRoom(oldRoom));

    user.room = newRoom;
    socket.join(newRoom);
    roomData.members.add(socket.id);
    socket.to(newRoom).emit("notification", { text: `${user.username} joined 👋`, type: "join" });

    socket.emit("room_switched", { room: newRoom, usersInRoom: getUsersInRoom(newRoom) });
    io.to(newRoom).emit("users_in_room", getUsersInRoom(newRoom));
    broadcastRoomLists();
  });

  // 6. JOIN VIA INVITE CODE
  socket.on("join_via_invite", ({ inviteCode }) => {
    const roomName = inviteCodes[inviteCode];
    if (!roomName) { socket.emit("room_error", { message: "Invalid invite link 😕" }); return; }
    const roomData = rooms[roomName];
    // For private rooms via invite, no password needed
    const user = users[socket.id];
    if (!user) return;

    const oldRoom = user.room;
    if (oldRoom === roomName) return;

    socket.leave(oldRoom);
    rooms[oldRoom].members.delete(socket.id);
    socket.to(oldRoom).emit("notification", { text: `${user.username} left`, type: "leave" });
    io.to(oldRoom).emit("users_in_room", getUsersInRoom(oldRoom));

    user.room = roomName;
    socket.join(roomName);
    roomData.members.add(socket.id);
    socket.to(roomName).emit("notification", { text: `${user.username} joined via invite 👋`, type: "join" });
    socket.emit("room_switched", { room: roomName, usersInRoom: getUsersInRoom(roomName) });
    io.to(roomName).emit("users_in_room", getUsersInRoom(roomName));
    broadcastRoomLists();
  });

  // 7. CREATE ROOM
  socket.on("create_room", ({ room: newRoom, isPrivate, password }) => {
    const user = users[socket.id];
    if (!user) return;

    const name = newRoom.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 20);
    if (!name) return;

    const inviteCode = generateCode();

    if (!rooms[name]) {
      rooms[name] = {
        members:    new Set(),
        isPrivate:  !!isPrivate,
        password:   isPrivate ? (password || "") : "",
        createdBy:  user.username,
        inviteCode,
      };
      inviteCodes[inviteCode] = name;
      console.log(`[room] #${name} by ${user.username} | private:${!!isPrivate} | code:${inviteCode}`);
    }

    broadcastRoomLists();
    socket.emit("switch_room_request", { room: name, password: isPrivate ? password : "" });
  });

  // 8. TYPING
  socket.on("typing", ({ isTyping }) => {
    const user = users[socket.id];
    if (!user) return;
    socket.to(user.room).emit("typing", { username: user.username, isTyping });
  });

  // 9. DISCONNECT
  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (!user) return;
    const { username, room } = user;
    rooms[room]?.members.delete(socket.id);
    delete users[socket.id];
    socket.to(room).emit("notification", { text: `${username} left`, type: "leave" });
    io.to(room).emit("users_in_room", getUsersInRoom(room));
    broadcastRoomLists();
  });
});

server.listen(PORT, () => console.log(`✅ ChillSpace v3 → http://localhost:${PORT}`));
