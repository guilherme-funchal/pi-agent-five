const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const selected = levels[process.env.LOG_LEVEL] || levels.info;

function write(level, message, data) {
  if (levels[level] < selected) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    agent: process.env.AGENT_ID || process.env.PI_SESSION_NAME || "agent",
    message,
    ...(data === undefined ? {} : { data })
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (message, data) => write("debug", message, data),
  info: (message, data) => write("info", message, data),
  warn: (message, data) => write("warn", message, data),
  error: (message, data) => write("error", message, data)
};
