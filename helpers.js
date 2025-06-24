import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { BOT_CONTENT } from "./constant.js";

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

// Agent Management Helpers
function getNextAgent(onlineAgents, agentToUsers) {
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

function handleAgentConnection(agentId, ws, onlineAgents, agentToUsers, persistConnectionState, logEvent) {
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

function handleUserConnection(userId, ws, connectedClients, userToAgent, onlineAgents, userSession, persistConnectionState, getPersistedConnectionState, createFrontendBotResponse, BOT_CONTENT, logEvent, connectionState) {
  logEvent("USER_CONNECTED", `User ${userId} connected`, {
    userId,
    totalClients: connectedClients.size
  });
  const persistedState = getPersistedConnectionState(userId, connectionState, logEvent);
  // Restore userToAgent mapping from persisted state if needed
  if (persistedState?.agentId && !userToAgent.has(userId)) {
    userToAgent.set(userId, persistedState.agentId);
    logEvent("RECONNECT_RESTORE_AGENT_ASSIGNMENT", `Restored agent assignment for user ${userId} to agent ${persistedState.agentId}`, { userId, agentId: persistedState.agentId });
  }
  const assignedAgent = userToAgent.get(userId) || (persistedState?.agentId);
  const isReconnecting = !!persistedState;
  if (assignedAgent && onlineAgents.has(assignedAgent)) {
    restoreAgentConnection(userId, assignedAgent, ws);
    persistConnectionState(userId, 'user', assignedAgent, connectionState, logEvent);
  } else {
    if (!isReconnecting) {
      ws.send(
        JSON.stringify(createFrontendBotResponse({
          type: "welcome",
          message: BOT_CONTENT.WELCOME.message,
          buttons: BOT_CONTENT.WELCOME.buttons,
          options: [],
          form: undefined,
          senderRole: "bot",
          senderName: "AI Assistant"
        }))
      );
    }
    userSession.set(userId, { stage: "category", data: {} });
    persistConnectionState(userId, 'user', undefined, connectionState, logEvent);
  }
}

function restoreAgentConnection(userId, agentId, ws, sendClearChat, sendAgentStatus, notifyAgentReconnection, logEvent) {
  logEvent("RESTORE_AGENT_CONNECTION", `Restoring user ${userId} connection to agent ${agentId}`, {
    userId,
    agentId
  });
  sendClearChat(ws);
  sendAgentStatus(userId, agentId, ws);
  notifyAgentReconnection(userId, agentId);
}

function startWithBot(userId, ws, userSession) {
  ws.send(
    JSON.stringify({
      type: "support_status",
      agentAvailable: false,
      message: "You're now chatting with our AI assistant 🤖. Please start by typing a category.",
      senderRole: "bot",
      senderName: "AI Assistant"
    })
  );
  userSession.set(userId, { stage: "category", data: {} });
}

function sendClearChat(ws) {
  ws.send(
    JSON.stringify({
      type: "clear_chat",
      message: "Switching to agent chat..."
    })
  );
}

function sendAgentStatus(userId, agentId, ws) {
  ws.send(
    JSON.stringify({
      type: "support_status",
      agentAvailable: true,
      agentId,
      message: `You're now connected to Agent ${agentId}`,
      senderRole: "agent",
      senderName: `Agent ${agentId}`,
      clearPrevious: true
    })
  );
}

function notifyAgentReconnection(userId, agentId, connectedClients, logEvent) {
  const agent = connectedClients.get(agentId);
  if (agent && agent.socket) {
    agent.socket.send(
      JSON.stringify({
        type: "user_reconnected",
        userId,
      })
    );
  } else {
    logEvent("SOCKET_WARNING", `Tried to send to agent ${agentId}, but socket not found.`);
  }
}

function assignUserToAgent(userId, agentId, userToAgent, agentToUsers, logEvent, sendClearChat, sendAgentStatus, notifyNewUserConnection, connectedClients) {
  if (userToAgent.has(userId)) {
    const currentAgent = userToAgent.get(userId);
    if (currentAgent === agentId) {
      logEvent("USER_ALREADY_ASSIGNED", `User ${userId} already assigned to agent ${agentId}`, {
        userId,
        agentId
      });
      return false;
    }
    removeFromPreviousAgent(userId, currentAgent, agentToUsers, logEvent);
  }
  assignToNewAgent(userId, agentId, userToAgent, agentToUsers, logEvent, sendClearChat, sendAgentStatus, notifyNewUserConnection, connectedClients);
  return true;
}

function removeFromPreviousAgent(userId, previousAgent, agentToUsers, logEvent) {
  const previousAgentUsers = agentToUsers.get(previousAgent);
  if (previousAgentUsers) {
    previousAgentUsers.delete(userId);
    logEvent("USER_REMOVED_FROM_AGENT", `User ${userId} removed from agent ${previousAgent}`, {
      userId,
      previousAgent
    });
  }
}

function assignToNewAgent(userId, agentId, userToAgent, agentToUsers, logEvent, sendClearChat, sendAgentStatus, notifyNewUserConnection, connectedClients) {
  userToAgent.set(userId, agentId);
  if (!agentToUsers.has(agentId)) {
    agentToUsers.set(agentId, new Set());
  }
  agentToUsers.get(agentId).add(userId);
  const user = connectedClients.get(userId);
  const agent = connectedClients.get(agentId);
  logEvent("USER_ASSIGNED", `User ${userId} assigned to agent ${agentId}`, {
    userId,
    agentId,
    totalAssignedUsers: userToAgent.size,
    agentUserCount: agentToUsers.get(agentId).size
  });
  sendClearChat(user?.socket);
  sendAgentStatus(userId, agentId, user?.socket);
  notifyNewUserConnection(userId, agent?.socket, logEvent);
}

function notifyNewUserConnection(userId, agentWs, logEvent) {
  if (agentWs && agentWs.socket) {
    agentWs.socket.send(
      JSON.stringify({
        type: "new_user_connected",
        userId,
      })
    );
  } else {
    logEvent("SOCKET_WARNING", `Tried to send to agent ${agentWs}, but socket not found.`);
  }
}

async function saveLead(userId, contact, leadsFilePath, logEvent) {
  try {
    if (!fs.existsSync(leadsFilePath)) {
      await fs.promises.writeFile(leadsFilePath, JSON.stringify([], null, 2));
    }
    const data = await fs.promises.readFile(leadsFilePath, "utf8");
    const leads = JSON.parse(data);
    leads.push({
      userId,
      contact,
      timestamp: new Date().toISOString(),
    });
    await fs.promises.writeFile(leadsFilePath, JSON.stringify(leads, null, 2));
    console.log("✅ Lead saved successfully");
  } catch (err) {
    console.error("❌ Error saving lead:", err);
  }
}

function getHardcodedResponse(input, session) {
  const lower = input.toLowerCase();
  if (lower.includes("hi") || lower.includes("hello") || lower.includes("hey") || lower.includes("greetings")) {
    session.intent = "welcome";
    return "WELCOME";
  }
  if (lower.includes("course") || lower.includes("learn") || lower.includes("explore")) {
    session.intent = "explore_courses";
    return "EXPLORE_COURSES";
  }
  if (lower.includes("challenge") || lower.includes("problem") || lower.includes("practice")) {
    session.intent = "find_challenges";
    return "FIND_CHALLENGES";
  }
  if (lower.includes("tip") || lower.includes("advice") || lower.includes("help")) {
    session.intent = "coding_tips";
    return "CODING_TIPS";
  }
  if (lower.includes("agent") || lower.includes("human")) {
    session.intent = "talk_to_agent";
    if (!session.agentAvailable) {
      return "AGENT_UNAVAILABLE_FORM";
    } else {
      return "TALK_TO_AGENT";
    }
  }
  if (
    lower.includes("exit") ||
    lower.includes("disconnect") ||
    lower.includes("end chat") ||
    lower.includes("stop")
  ) {
    session.intent = "exit_chat";
    return "EXIT_CHAT";
  }
  return null;
}

function getSuggestedButtons(context = "") {
  return [{ label: "Talk to Agent", value: "talk to agent" }];
}

function parseGeminiJsonResponse(content) {
  // Remove markdown/code block wrappers and trim
  let cleaned = content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    parsed = { message: cleaned };
  }
  // Ensure all fields are present and properly typed
  return {
    message: typeof parsed.message === 'string' ? parsed.message : '',
    buttons: Array.isArray(parsed.buttons) ? parsed.buttons : [],
    options: Array.isArray(parsed.options) ? parsed.options : [],
    form: typeof parsed.form === 'object' && parsed.form !== null ? parsed.form : undefined,
    type: typeof parsed.type === 'string' ? parsed.type : 'gemini',
  };
}

function buildBotResponse(type, data = {}) {
  const key = type?.toUpperCase();
  const content = BOT_CONTENT[key] || {};
  let message = content.message || "";
  if (key === "AGENT_UNAVAILABLE_FORM" && !message) {
    message = "No agents are currently available. Please leave your contact details and we'll get back to you.";
  }
  return createFrontendBotResponse({
    type: type === "form" || key === "AGENT_UNAVAILABLE_FORM" ? "form" : "message",
    message,
    text: message,
    buttons: content.buttons || [],
    options: content.options || [],
    form: content.form,
    senderRole: "bot",
    senderName: "AI Assistant",
    ...data
  });
}

function createFrontendBotResponse({
  type = "message",
  message = "",
  text = undefined,
  buttons = [],
  form = undefined,
  options = [],
  senderRole = "bot",
  senderName = "AI Assistant"
}) {
  const fallback = "I'm here to help! Please select an option or ask a question.";
  const msg = message && message.trim() ? message : fallback;
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    text: text || msg,
    message: msg,
    sender: "assistant",
    timestamp: new Date(),
    buttons: Array.isArray(buttons) ? buttons : [],
    options: Array.isArray(options) ? options : [],
    form: form || undefined,
    type
  };
}

async function getBotResponse(userId, userMessage, userSession, uuidv4, getHardcodedResponse, createFrontendBotResponse, app, logEvent) {
  let session = userSession.get(userId) || {};
  if (!session.thread_id) session.thread_id = uuidv4();

  // If user is with agent or just disconnected, don't process bot responses
  if (session.stage === "with_agent") {
    return null;
  }

  // If user just disconnected from agent and sends a message, now we can show options
  if (session.stage === "post_agent" && session.justDisconnectedFromAgent) {
    session.justDisconnectedFromAgent = false; // Reset the flag
    session.stage = "category"; // Reset to normal bot interaction
    const mapped = createFrontendBotResponse({
      type: "welcome",
      message: BOT_CONTENT.WELCOME.message,
      buttons: BOT_CONTENT.WELCOME.buttons,
      options: [],
      form: undefined,
      senderRole: "bot",
      senderName: "AI Assistant",
      minimize_chat: false
    });
    userSession.set(userId, session);
    return mapped;
  }

  const hardcodedKey = getHardcodedResponse(userMessage, session);
  if (hardcodedKey) {
    const content = BOT_CONTENT[hardcodedKey];
    const mapped = createFrontendBotResponse({
      type: hardcodedKey,
      message: content.message,
      buttons: content.buttons,
      form: content.form,
      options: content.options,
      senderRole: "bot",
      senderName: "AI Assistant",
      minimize_chat: session.minimize_chat
    });
    userSession.set(userId, session);
    console.log("[BOT RESPONSE]", mapped);
    return mapped;
  }
  // 🚧 can be optimized: Prune chat history to last 10 messages for LLM performance
  let history = (session.history || []).filter(
    m => m.role === "user" || m.role === "assistant"
  ).slice(-10); // Only keep last 10

  // Deduplication: Prevent storing duplicate consecutive user messages
  const lastUserMsg = [...history].reverse().find(m => m.role === "user");
  const isDuplicate = lastUserMsg && lastUserMsg.content === userMessage;

  const input = isDuplicate
    ? [...history]
    : [...history, { role: "user", content: userMessage }];
  const config = { configurable: { thread_id: session.thread_id } };
  // ⏱️ potential delay: Awaiting LLM response
  const output = await app.invoke(input, config);
  const lastMessage = output.messages[output.messages.length - 1];
  session.history = isDuplicate
    ? [
        ...history,
        { role: "assistant", content: lastMessage.content }
      ]
    : [
        ...history,
        { role: "user", content: userMessage },
        { role: "assistant", content: lastMessage.content }
      ];
  userSession.set(userId, session);
  // Always use parseGeminiJsonResponse for consistent structure
  const parsed = parseGeminiJsonResponse(lastMessage.content);
  const mapped = createFrontendBotResponse({
    ...parsed,
    senderRole: "bot",
    senderName: "AI Assistant"
  });
  console.log("[BOT RESPONSE]", mapped);
  return mapped;
}

function handleConnectionError(userId, ws, connectionAttempts, logEvent) {
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

function persistConnectionState(userId, role, agentId = null, connectionState, logEvent) {
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

function getPersistedConnectionState(userId, connectionState, logEvent) {
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

function clearPersistedConnectionState(userId, connectionState, logEvent) {
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

function handleAgentDisconnection(agentId, onlineAgents, agentToUsers, connectedClients, logEvent) {
  onlineAgents.delete(agentId);
  agentToUsers.delete(agentId);
  connectedClients.delete(agentId);
  logEvent("AGENT_DISCONNECTED", `Agent ${agentId} disconnected`, { agentId });
}

function handleUserDisconnection(userId, userToAgent, agentToUsers, connectedClients, logEvent) {
  const agentId = userToAgent.get(userId);
  if (agentId) {
    const agentUsers = agentToUsers.get(agentId);
    if (agentUsers) {
      agentUsers.delete(userId);
    }
    userToAgent.delete(userId);
  }
  connectedClients.delete(userId);
  logEvent("USER_DISCONNECTED", `User ${userId} disconnected`, { userId });
}

export {
  logEvent,
  buildBotResponse,
  getHardcodedResponse,
  getBotResponse,
  createFrontendBotResponse,
  getNextAgent,
  handleAgentConnection,
  handleUserConnection,
  restoreAgentConnection,
  startWithBot,
  sendClearChat,
  sendAgentStatus,
  notifyAgentReconnection,
  assignUserToAgent,
  removeFromPreviousAgent,
  assignToNewAgent,
  notifyNewUserConnection,
  saveLead,
  getSuggestedButtons,
  parseGeminiJsonResponse,
  handleConnectionError,
  persistConnectionState,
  getPersistedConnectionState,
  clearPersistedConnectionState,
  handleAgentDisconnection,
  handleUserDisconnection
}; 