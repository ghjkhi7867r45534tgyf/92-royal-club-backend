require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";
const MONGO_URI = `mongodb://fk7673939_db_user:7VYILhpMbIBulZU6@ac-kcwuzt4-shard-00-00.tm7a1ok.mongodb.net:27017,ac-kcwuzt4-shard-00-01.tm7a1ok.mongodb.net:27017,ac-kcwuzt4-shard-00-02.tm7a1ok.mongodb.net:27017/vip_platform?ssl=true&replicaSet=atlas-1anjro-shard-0&authSource=admin&appName=Cluster0`;
// ================= SCHEMAS =================
const UserSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 100 }, // Rs. 100 Signup Bonus
  vipLevel: { type: Number, default: 1 },
  referralCode: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone: { type: String, required: true },
  type: { type: String, enum: ['DEPOSIT', 'WITHDRAW'], required: true },
  amount: { type: Number, required: true },
  channel: { type: String, default: 'JazzCash' },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

// ================= AUTH MIDDLEWARE =================
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: "No token provided." });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: "Session expired or invalid." });
    req.user = decoded;
    next();
  });
}

// ================= ROUTES =================

// Health check route
app.get('/', (req, res) => {
  res.send({ status: "Online", message: "VIP Backend Server is Running Perfectly!" });
});

// 1. REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, password, referralCode } = req.body;
    if (!phone || !password) return res.status(400).json({ success: false, message: "Phone & password required." });

    const exists = await User.findOne({ phone });
    if (exists) return res.status(400).json({ success: false, message: "Phone number already exists." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ phone, password: hashedPassword, referralCode });
    await user.save();

    const token = jwt.sign({ id: user._id, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, message: "Account created successfully!", token, user: { phone: user.phone, balance: user.balance } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(400).json({ success: false, message: "User not found." });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, message: "Invalid credentials." });

    const token = jwt.sign({ id: user._id, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, message: "Login successful!", token, user: { phone: user.phone, balance: user.balance, vipLevel: user.vipLevel } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. PROFILE / BALANCE
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. DEPOSIT REQUEST
app.post('/api/wallet/deposit', verifyToken, async (req, res) => {
  try {
    const { amount, channel } = req.body;
    const tx = new Transaction({
      userId: req.user.id,
      phone: req.user.phone,
      type: 'DEPOSIT',
      amount: Number(amount),
      channel: channel || 'JazzCash'
    });
    await tx.save();
    res.json({ success: true, message: "Deposit submitted! Admin will verify." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. WITHDRAW REQUEST
app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  try {
    const { amount, channel } = req.body;
    const user = await User.findById(req.user.id);
    if (user.balance < amount) return res.status(400).json({ success: false, message: "Insufficient balance." });

    user.balance -= Number(amount);
    await user.save();

    const tx = new Transaction({
      userId: req.user.id,
      phone: req.user.phone,
      type: 'WITHDRAW',
      amount: Number(amount),
      channel: channel || 'Easypaisa'
    });
    await tx.save();
    res.json({ success: true, message: "Withdrawal placed successfully!", balance: user.balance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// --- AVIATOR / CRASH ENGINE LOGIC ---
let crashState = {
  multiplier: 1.00,
  status: "WAITING",
  crashPoint: 0,
  countdown: 5
};

function startCrashRound() {
  crashState.status = "WAITING";
  crashState.multiplier = 1.00;
  crashState.countdown = 5;

  const rand = Math.random();
  crashState.crashPoint = rand < 0.10 ? 1.00 : parseFloat((0.99 / (1 - rand)).toFixed(2));
  if (crashState.crashPoint > 50) crashState.crashPoint = 50.00;

  const waitInterval = setInterval(() => {
    io.emit("crash_tick", { status: "WAITING", countdown: crashState.countdown });
    crashState.countdown--;

    if (crashState.countdown < 0) {
      clearInterval(waitInterval);
      runFlyingPhase();
    }
  }, 1000);
}

function runFlyingPhase() {
  crashState.status = "FLYING";
  
  const flightInterval = setInterval(() => {
    crashState.multiplier = parseFloat((crashState.multiplier + 0.03 + (crashState.multiplier * 0.015)).toFixed(2));

    if (crashState.multiplier >= crashState.crashPoint) {
      clearInterval(flightInterval);
      crashState.status = "CRASHED";
      io.emit("crash_tick", { status: "CRASHED", multiplier: crashState.crashPoint });
      setTimeout(startCrashRound, 4000);
    } else {
      io.emit("crash_tick", { status: "FLYING", multiplier: crashState.multiplier });
    }
  }, 100);
}

// CONNECT DATABASE & RUN SERVER
const PORT = process.env.PORT || 5000;
mongoose.connect(MONGO_URI)
  .then(() => {
    startCrashRound();
    server.listen(PORT, () => {
      console.log("-----------------------------------------");
      console.log("Database Connected Successfully!");
      console.log(`Server & Game Engine Live on http://localhost:${PORT}`);
      console.log("-----------------------------------------");
    });
  })
  .catch((err) => {
    console.log("Database connection error:", err.message);
  });

