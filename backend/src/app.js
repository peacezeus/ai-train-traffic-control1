// ============================================================
// backend/src/app.js  — PRODUCTION UPGRADED
// FIX 1: CORS restricted to frontend URL only
// FIX 2: Standardized error handler
// FIX 3: Security headers added (helmet)
// FIX 4: Rate limiting added
// FIX 5: NoSQL injection protection added
// ============================================================

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
require("express-async-errors");

// Route Imports
const authRoutes = require("./routes/auth");
const trainRoutes = require("./routes/trains");
const sectionRoutes = require("./routes/sections");
const tsrRoutes = require("./routes/tsr");
const aiRoutes = require("./routes/ai");
const analyticsRoutes = require("./routes/analytics");
const scheduleRoutes = require("./routes/schedules");
const trafficControlRoutes = require("./routes/trafficControl");
const maintenanceRoutes = require("./routes/maintenance");

const app = express();

// ─── Security Headers ─────────────────────────────────────────
app.use(helmet({ crossOriginEmbedderPolicy: false }));

// ─── CORS — FIX: was `origin: true` (allows everyone) ────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);

// ─── Rate Limiting ─────────────────────────────────────────────
// DISABLED for development/demo - too restrictive for fast testing
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 300,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: {
//     success: false,
//     message: "Too many requests, please slow down.",
//   },
// });
// app.use("/api/", limiter);

// ─── NoSQL Injection Protection ───────────────────────────────
app.use(mongoSanitize());

// ─── Body Parsing ─────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(morgan("dev"));

// ─── Config Endpoint — tells frontend the actual backend URL ────
app.get("/api/config", async (req, res) => {
  const backendUrl =
    process.env.BACKEND_URL ||
    "https://ai-train-traffic-control1-2.onrender.com";

  res.status(200).json({
    success: true,
    data: {
      backendUrl,
      apiUrl: `${backendUrl}/api`,
      wsUrl: backendUrl,
      environment: process.env.NODE_ENV || "production",
      timestamp: new Date().toISOString(),
    },
  });
});

// ─── Health Check ─────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  const mongoose = require("mongoose");
  const aiStatus = await checkAIService();
  res.status(200).json({
    success: true,
    message: "AI Train Traffic Control API is healthy",
    data: {
      status: "healthy",
      uptime: Math.floor(process.uptime()),
      database:
        mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      aiService: aiStatus,
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
    },
  });
});

async function checkAIService() {
  try {
    const axios = require("axios");
    await axios.get(
      `${process.env.AI_SERVICE_URL || "http://localhost:8000"}/health`,
      { timeout: 2000 }
    );
    return "healthy";
  } catch {
    return "unavailable";
  }
}

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/trains", trainRoutes);
app.use("/api/sections", sectionRoutes);
app.use("/api/tsr", tsrRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/traffic", trafficControlRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/analytics", analyticsRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "AI Train Traffic Control System API v2.0",
    docs: "/api/health",
  });
});

// ─── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// ─── Global Error Handler (FIX: was leaking stack traces) ─────
app.use((err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  // Mongoose cast error (invalid ObjectId)
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue)[0];
    message = `Duplicate value for '${field}'. Please use a different value.`;
  }

  // Mongoose validation errors
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(". ");
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token. Please log in again.";
  }
  if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired. Please log in again.";
  }

  console.error(`[${new Date().toISOString()}] ${statusCode} - ${message}`);

  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };

  // Only show stack in development
  if (process.env.NODE_ENV === "development" && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
});

module.exports = app;
