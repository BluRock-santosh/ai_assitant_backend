import "dotenv/config";
import { WebSocketServer } from "ws";
import { BOT_CONTENT } from "./constant.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { v4 as uuidv4 } from "uuid";
import { initializeGeminiChat } from "./gemini_fix.js";
import {
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
} from "./wsHelpers.js";
import {
  getHardcodedResponse,
  createFrontendBotResponse,
  getBotResponse,
  buildBotResponse,
  saveLead,
  sendClearChat,
  sendAgentStatus,
  notifyNewUserConnection,
  handleAgentDisconnection,
  handleUserDisconnection,
} from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const leadsFilePath = path.join(__dirname, "leads.json");

// Initialize Gemini chat with proper system message handling
const app = initializeGeminiChat();

// Removed old Gemini setup since we're using the new implementation from gemini_fix.js

// Removed old workflow initialization since we're using the new Gemini chat implementation

// WebSocket Server Setup
const port = process.env.PORT || 8080; // Render injects this
const wss = new WebSocketServer({ port, host: "0.0.0.0" });
logEvent("SERVER_START", "WebSocket server started on port 8080", {
  port: 8080,
});

wss.on("connection", (ws) => {
  let currentUserId = null;
  let currentRole = null;
  let isReconnecting = false;

  ws.on("message", async (data) => {
    const startTime = Date.now();
    try {
      const payload = JSON.parse(data.toString());
      logEvent("MESSAGE_RECEIVED", "Received message", { payload });
      switch (payload.type) {
        case "login": {
          const { userId, role } = payload;
          if (!userId || !role) {
            ws.send(
              JSON.stringify(
                buildBotResponse("error", { message: "Missing userId or role" })
              )
            );
            return;
          }
          isReconnecting = !!getPersistedConnectionState(
            userId,
            connectionState,
            logEvent
          );
          if (!connectionAttempts.has(userId)) {
            connectionAttempts.set(userId, {
              attempts: 0,
              lastAttempt: Date.now(),
            });
          }
          if (
            !handleConnectionError(userId, ws, connectionAttempts, logEvent)
          ) {
            ws.send(
              JSON.stringify(
                buildBotResponse("error", {
                  message:
                    "Too many connection attempts. Please try again later.",
                })
              )
            );
            return;
          }
          currentUserId = userId;
          currentRole = role;
          connectedClients.set(userId, { role, socket: ws });
          if (role === "agent") {
            handleAgentConnection(
              userId,
              ws,
              onlineAgents,
              agentToUsers,
              persistConnectionState,
              logEvent
            );
          } else if (role === "user") {
            handleUserConnection(
              userId,
              ws,
              connectedClients,
              userToAgent,
              onlineAgents,
              userSession,
              persistConnectionState,
              getPersistedConnectionState,
              createFrontendBotResponse,
              BOT_CONTENT,
              logEvent,
              connectionState
            );
          }
          break;
        }
        case "private_message": {
          const senderId = currentUserId;
          const { message, recipientId } = payload;

          // Log every user message for better visibility
          if (currentRole === "user") {
            logEvent("USER_MESSAGE", `User message received from ${senderId}`, {
              senderId,
              message,
              timestamp: new Date().toISOString(),
            });
          }

          // 1. Validate message
          if (!message || typeof message !== "string") {
            logEvent(
              "INVALID_MESSAGE_PAYLOAD",
              `Invalid message payload from ${senderId}`,
              {
                senderId,
                payload,
              }
            );
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid message format. Please try again.",
              })
            );
            return;
          }

          // 2. User logic
          if (currentRole === "user") {
            const agentId = userToAgent.get(senderId);
            const lowerMessage = message.toLowerCase().trim();

            // 2a. User wants to disconnect from agent (only if assigned)
            if (agentId && connectedClients.has(agentId)) {
              if (
                lowerMessage.includes("exit") ||
                lowerMessage.includes("disconnect") ||
                lowerMessage.includes("end chat") ||
                lowerMessage.includes("stop")
              ) {
                const agentUsers = agentToUsers.get(agentId);
                if (agentUsers) agentUsers.delete(senderId);
                userToAgent.delete(senderId);
                const agent = connectedClients.get(agentId);
                agent?.socket?.send(
                  JSON.stringify({
                    type: "user_disconnected",
                    userId: senderId,
                    message: "User has ended the chat",
                  })
                );
                ws.send(
                  JSON.stringify({
                    type: "private_message",
                    ...createFrontendBotResponse({
                      type: "EXIT_CHAT",
                      message: BOT_CONTENT.EXIT_CHAT.message,
                      buttons: BOT_CONTENT.EXIT_CHAT.buttons,
                      options: BOT_CONTENT.EXIT_CHAT.options,
                      senderRole: "bot",
                      senderName: "AI Assistant",
                    }),
                    senderId: "bot",
                    recipientId: senderId,
                  })
                );
                userSession.set(senderId, {
                  stage: "category",
                  data: {},
                  justDisconnectedFromAgent: true,
                });
                logEvent(
                  "USER_EXIT_AGENT",
                  `User ${senderId} exited agent chat`,
                  { userId: senderId, agentId }
                );
                return;
              }
              // 2b. User is assigned to agent: forward message
              connectedClients.get(agentId).socket.send(
                JSON.stringify({
                  type: "private_message",
                  senderId,
                  recipientId: agentId,
                  message,
                  senderRole: "user",
                })
              );
              return;
            }

            // 2c. Detect agent intent using regex (pro-level)
            const agentIntentRegex = /\b(agent|human|support)\b/i;
            if (agentIntentRegex.test(lowerMessage)) {
              logEvent("ROUTE_AGENT_INTENT", "Routing to agent intent", { senderId, message });
              const availableAgentId = getNextAgent(onlineAgents, agentToUsers);
              if (availableAgentId) {
                assignUserToAgent(
                  senderId,
                  availableAgentId,
                  userToAgent,
                  agentToUsers,
                  logEvent,
                  sendClearChat,
                  sendAgentStatus,
                  notifyNewUserConnection,
                  connectedClients
                );
                // Only send the visible chat message to the user
                ws.send(
                  JSON.stringify({
                    type: "private_message",
                    senderId: "agent",
                    recipientId: senderId,
                    message: "You are now connected to a human agent.",
                    senderRole: "agent",
                    senderName: `Agent ${availableAgentId}`,
                  })
                );
                // Notify the agent of the new user assignment
                const agentClient = connectedClients.get(availableAgentId);
                if (agentClient && agentClient.socket) {
                  agentClient.socket.send(
                    JSON.stringify({
                      type: "user_assigned",
                      userId: senderId,
                      message: `A new user (${senderId}) has been assigned to you.`,
                      internal: true, // Agent dashboard can use this for UI, not chat
                    })
                  );
                  // --- Forward the original message to the agent after assignment ---
                  agentClient.socket.send(
                    JSON.stringify({
                      type: "private_message",
                      senderId,
                      recipientId: availableAgentId,
                      message, // the original message
                      senderRole: "user",
                    })
                  );
                }
                logEvent(
                  "AGENT_ASSIGNED",
                  `User ${senderId} assigned to agent ${availableAgentId}`,
                  { senderId, agentId: availableAgentId }
                );
              } else {
                ws.send(
                  JSON.stringify(buildBotResponse("AGENT_UNAVAILABLE_FORM"))
                );
                logEvent(
                  "AGENT_UNAVAILABLE",
                  `No agent available for user ${senderId}`,
                  { senderId }
                );
              }
              return;
            }

            // 2d. Not assigned and no agent intent: send to bot/LLM
            const hardcodedKey = getHardcodedResponse(message, userSession.get(senderId) || {});
            if (hardcodedKey) {
              logEvent("ROUTE_HARDCODED", "Matched hardcoded intent", { senderId, message, hardcodedKey });
            } else {
              logEvent("ROUTE_LLM", "Routing to Gemini LLM", { senderId, message });
            }
            const llmStart = Date.now();
            try {
              const botReply = await getBotResponse(senderId, message, userSession, uuidv4, getHardcodedResponse, createFrontendBotResponse, app, logEvent);
              const llmEnd = Date.now();
              logEvent("LLM_RESPONSE", "LLM response sent", { senderId, durationMs: llmEnd - llmStart });
              ws.send(JSON.stringify({
                type: "private_message",
                ...botReply,
                senderId: "bot",
                recipientId: senderId
              }));
            } catch (err) {
              logEvent("LLM_ERROR", "Error from LLM or response handler", { error: err.message, payload });
              ws.send(JSON.stringify({ type: "error", message: "Sorry, something went wrong. Please try again.", recipientId: senderId }));
            }
            const endTime = Date.now();
            logEvent("MESSAGE_FLOW_COMPLETE", "Message flow complete", { senderId, totalDurationMs: endTime - startTime });
            return;
          }

          // 3. Agent logic
          if (currentRole === "agent" && recipientId) {
            const assignedAgent = userToAgent.get(recipientId);
            if (assignedAgent !== senderId) {
              logEvent(
                "UNAUTHORIZED_ACCESS",
                `Agent ${senderId} tried to message unassigned user ${recipientId}`,
                {
                  agentId: senderId,
                  userId: recipientId,
                  assignedAgent,
                }
              );
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "You are not assigned to this user",
                  recipientId: senderId,
                })
              );
              return;
            }
            const user = connectedClients.get(recipientId);
            user?.socket?.send(
              JSON.stringify({
                type: "private_message",
                senderId,
                recipientId,
                message,
                senderRole: "agent",
                senderName: `Agent ${senderId}`,
              })
            );
            return;
          }
          break;
        }
        case "form_submission": {
          const senderId = payload.senderId;

          await saveLead(senderId, payload.data, leadsFilePath, logEvent);
          ws.send(
            JSON.stringify(
              buildBotResponse("message", {
                message: "✅ Thank you! Our team will contact you soon.",
                buttons: [],
                options: [],
                form: undefined,
                senderRole: "bot",
                senderName: "AI Assistant",
              })
            )
          );
          break;
        }
        default:
          ws.send(
            JSON.stringify(
              buildBotResponse("error", { message: "Unknown message type" })
            )
          );
      }
    } catch (e) {
      logEvent("MESSAGE_ERROR", "Error processing message", {
        error: e.message,
        userId: currentUserId,
        role: currentRole,
        payload: data?.toString()
      });
      ws.send(JSON.stringify(buildBotResponse("error", { message: "Invalid message format. Please try again." })));
    }
  });

  ws.on("close", () => {
    if (!currentUserId) return;
    logEvent(
      "CLIENT_DISCONNECTED",
      `${currentUserId} (${currentRole}) disconnected`,
      {
        userId: currentUserId,
        role: currentRole,
        totalClients: connectedClients.size - 1,
      }
    );
    connectedClients.delete(currentUserId);
    if (currentRole === "agent") {
      handleAgentDisconnection(
        currentUserId,
        onlineAgents,
        agentToUsers,
        connectedClients,
        logEvent
      );
    }
    if (currentRole === "user") {
      handleUserDisconnection(
        currentUserId,
        userToAgent,
        agentToUsers,
        connectedClients,
        logEvent
      );
    }
  });

  ws.on("error", (err) => {
    logEvent("WEBSOCKET_ERROR", `WebSocket error for ${currentUserId}`, {
      userId: currentUserId,
      role: currentRole,
      error: err.message,
    });
    console.error(`WebSocket error for ${currentUserId}:`, err);
  });
});
