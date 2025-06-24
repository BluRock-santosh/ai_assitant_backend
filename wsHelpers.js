import fs from "fs";
import { BOT_CONTENT } from "./constant.js";

// WebSocket State
const connectedClients = new Map(); // userId -> { role, socket }
const onlineAgents = new Set(); // agent userIds
const userToAgent = new Map(); // userId -> agentId
const userSession = new Map(); // userId -> { stage, data }
const agentToUsers = new Map(); // agentId -> Set of userIds
const connectionAttempts = new Map(); // userId -> { attempts, lastAttempt }
const connectionState = new Map(); // userId -> { role, agentId, timestamp }

// Logging Helper
function logEvent(type, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    type,
    message,
    ...data
  };
  console.log(`[${timestamp}] ${type}: ${message}`, data);
  return logEntry;
}

function getPersistedConnectionState(userId) {
  try {
    const state = connectionState.get(userId);
    if (state) {
      if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
        connectionState.delete(userId);
        return null;
      }
      return state;
    }
    return null;
  } catch (error) {
    logEvent("PERSISTENCE_ERROR", `Failed to get persisted connection state for ${userId}`, {
      userId,
      error: error.message
    });
    return null;
  }
}

function handleConnectionError(userId, ws) {
  const attempts = connectionAttempts.get(userId) || { attempts: 0, lastAttempt: Date.now() };
  if (attempts.attempts === 0) {
    return true;
  }
  attempts.attempts++;
  attempts.lastAttempt = Date.now();
  connectionAttempts.set(userId, attempts);
  logEvent("CONNECTION_ERROR", `Connection error for user ${userId}`, {
    userId,
    attempts: attempts.attempts,
    lastAttempt: attempts.lastAttempt
  });
  if (Date.now() - attempts.lastAttempt > 5 * 60 * 1000) {
    attempts.attempts = 0;
    connectionAttempts.set(userId, attempts);
  }
  if (attempts.attempts > 5) {
    const waitTime = Math.min(1000 * Math.pow(2, attempts.attempts - 5), 30000);
    setTimeout(() => {
      attempts.attempts = 0;
      connectionAttempts.set(userId, attempts);
    }, waitTime);
    return false;
  }
  return true;
}

function handleAgentConnection(agentId, ws) {
  onlineAgents.add(agentId);
  agentToUsers.set(agentId, new Set());
  logEvent("AGENT_CONNECTED", `Agent ${agentId} connected`, {
    agentId,
    totalAgents: onlineAgents.size,
    onlineAgents: Array.from(onlineAgents)
  });
  persistConnectionState(agentId, 'agent', agentId);
  ws.send(
    JSON.stringify({
      type: "agent_status",
      message: `You are now online as Agent ${agentId}`,
      agentId,
      senderRole: "agent",
      senderName: `Agent ${agentId}`
    })
  );
}

function handleUserConnection(userId, ws) {
  logEvent("USER_CONNECTED", `User ${userId} connected`, {
    userId,
    totalClients: connectedClients.size
  });
  const persistedState = getPersistedConnectionState(userId);
  const assignedAgent = userToAgent.get(userId) || (persistedState?.agentId);
  const isReconnecting = !!persistedState;
  if (assignedAgent && onlineAgents.has(assignedAgent)) {
    // restoreAgentConnection(userId, assignedAgent, ws); // implement if needed
    persistConnectionState(userId, 'user', assignedAgent);
  } else {
    if (!isReconnecting) {
      ws.send(
        JSON.stringify({
          type: "welcome",
          message: BOT_CONTENT.WELCOME.message,
          buttons: BOT_CONTENT.WELCOME.buttons,
          options: [],
          form: undefined,
          senderRole: "bot",
          senderName: "AI Assistant"
        })
      );
    }
    userSession.set(userId, { stage: "category", data: {} });
    persistConnectionState(userId, 'user');
  }
}

function getNextAgent() {
  const agents = Array.from(onlineAgents);
  if (agents.length === 0) return null;
  let minUsers = Infinity;
  let selectedAgent = null;
  for (const agentId of agents) {
    const userCount = agentToUsers.get(agentId)?.size || 0;
    if (userCount < minUsers) {
      minUsers = userCount;
      selectedAgent = agentId;
    }
  }
  return selectedAgent;
}

function assignUserToAgent(userId, agentId) {
  userToAgent.set(userId, agentId);
  if (!agentToUsers.has(agentId)) agentToUsers.set(agentId, new Set());
  agentToUsers.get(agentId).add(userId);
  logEvent("USER_ASSIGNED", `User ${userId} assigned to agent ${agentId}`, { userId, agentId });
}

function persistConnectionState(userId, role, agentId = null) {
  try {
    if (role === 'agent') {
      agentId = userId;
    }
    const state = {
      userId,
      role,
      agentId,
      timestamp: Date.now()
    };
    connectionState.set(userId, state);
    logEvent("CONNECTION_STATE_PERSISTED", `Connection state persisted for ${userId}`, {
      userId,
      role,
      agentId
    });
  } catch (error) {
    logEvent("PERSISTENCE_ERROR", `Failed to persist connection state for ${userId}`, {
      userId,
      error: error.message
    });
  }
}

function clearPersistedConnectionState(userId) {
  try {
    connectionState.delete(userId);
    logEvent("CONNECTION_STATE_CLEARED", `Connection state cleared for ${userId}`, {
      userId
    });
  } catch (error) {
    logEvent("PERSISTENCE_ERROR", `Failed to clear persisted connection state for ${userId}`, {
      userId,
      error: error.message
    });
  }
}

export {
  connectedClients,
  onlineAgents,
  userToAgent,
  userSession,
  agentToUsers,
  connectionAttempts,
  connectionState,
  logEvent,
  getPersistedConnectionState,
  handleConnectionError,
  handleAgentConnection,
  handleUserConnection,
  getNextAgent,
  assignUserToAgent,
  persistConnectionState,
  clearPersistedConnectionState
}; 