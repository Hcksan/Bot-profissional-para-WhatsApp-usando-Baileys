import fs from "fs";
import path from "path";

/**
 * Sistema simples de logs
 */
class Logger {
  constructor() {
    this.logDir = "./logs";
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  getLogFileName() {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.logDir, `bot-${date}.log`);
  }

  writeLog(level, message, data = null) {
    const timestamp = this.getTimestamp();
    const logEntry = {
      timestamp,
      level,
      message,
      ...(data && { data }),
    };

    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${
      data ? ` | ${JSON.stringify(data)}` : ""
    }\n`;

    // Escrever no arquivo
    fs.appendFileSync(this.getLogFileName(), logLine);

    // Também mostrar no console com cores
    const colors = {
      info: "\x1b[36m",
      error: "\x1b[31m",
      warn: "\x1b[33m",
      success: "\x1b[32m",
    };
    const reset = "\x1b[0m";
    const color = colors[level] || "";

    console.log(`${color}${logLine.trim()}${reset}`);
  }

  info(message, data) {
    this.writeLog("info", message, data);
  }

  error(message, data) {
    this.writeLog("error", message, data);
  }

  warn(message, data) {
    this.writeLog("warn", message, data);
  }

  success(message, data) {
    this.writeLog("success", message, data);
  }
}

export default new Logger();
