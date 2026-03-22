import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://bb51-37-216-212-89.ngrok-free.app",   // ← Add your current ngrok URL here
      "http://127.0.0.1:3000",
      "https://meetify-ashy.vercel.app/",
      "*"   // Temporary for testing - remove later
    ],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["*"]
  }
});

// ─────────────────────────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────────────────────────
interface ServerToClientEvents {
  matched: (data: { peerId: string; isInitiator: boolean }) => void;
  status: (status: 'waiting' | 'idle') => void;
  offer: (data: { from: string; offer: RTCSessionDescriptionInit }) => void;
  answer: (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (candidate: RTCIceCandidateInit) => void;
  'partner-left': () => void;
}

interface ClientToServerEvents {
  'join-queue': () => void;
  offer: (payload: { to: string; offer: RTCSessionDescriptionInit }) => void;
  answer: (payload: { to: string; answer: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (payload: { to: string; candidate: RTCIceCandidateInit }) => void;
  next: () => void;
}

// Global state (typed)
let waitingUser: string | null = null;
const activePairs = new Map<string, string>();   // socketId → roomName

// ─────────────────────────────────────────────────────────────
// Socket connection
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  console.log(`✅ User connected: ${socket.id}`);

  // Join random matching queue
  socket.on('join-queue', () => {
    console.log(`[Server] join-queue received from ${socket.id}`);

    if (waitingUser && waitingUser !== socket.id) {
      const room = [waitingUser, socket.id].sort().join('--');

      socket.join(room);
      io.sockets.sockets.get(waitingUser)?.join(room);

      console.log(`[Server] MATCHING ${waitingUser} with ${socket.id}`);

      // Send to first user
      socket.emit('matched', { peerId: waitingUser, isInitiator: false });
      console.log(`[Server] Sent matched to ${socket.id}`);

      // Send to second user
      io.to(waitingUser).emit('matched', { peerId: socket.id, isInitiator: true });
      console.log(`[Server] Sent matched to ${waitingUser}`);

      activePairs.set(socket.id, room);
      activePairs.set(waitingUser, room);

      waitingUser = null;
    } else {
      waitingUser = socket.id;
      socket.emit('status', 'waiting');
      console.log(`[Server] ${socket.id} is now waiting`);
    }
  });

  // WebRTC signaling
  socket.on('offer', (payload) => {
    io.to(payload.to).emit('offer', { from: socket.id, offer: payload.offer });
  });

  socket.on('answer', (payload) => {
    io.to(payload.to).emit('answer', { from: socket.id, answer: payload.answer });
  });

  socket.on('ice-candidate', (payload) => {
    io.to(payload.to).emit('ice-candidate', payload.candidate);
  });

  // Next / leave current chat
  socket.on('next', () => {
    const room = activePairs.get(socket.id);
    if (room) {
      socket.to(room).emit('partner-left');
      socket.leave(room);
      activePairs.delete(socket.id);
    }
    socket.emit('status', 'idle');
  });

  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`);

    if (waitingUser === socket.id) waitingUser = null;

    const room = activePairs.get(socket.id);
    if (room) {
      socket.to(room).emit('partner-left');
      activePairs.delete(socket.id);
    }
  });
});

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
});