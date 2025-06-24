import { ChatGroq } from "@langchain/groq";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import fs from "fs";

export function initializeGeminiChat() {
  const geminiRules = fs.readFileSync("./gemini_rules.txt", "utf8");

  const model = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,

    model: "llama-3.3-70b-versatile",
    temperature: 0,
    maxOutputTokens: 2048,
    maxRetries: 2,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", geminiRules],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);

  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  const invokeWithSystem = async (messages, config = {}) => {
    const chat_history = messages.filter((m) => m.role !== "system");
    const lastUser = messages.reverse().find((m) => m.role === "user");
    const input = lastUser?.content || "";

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await chain.invoke({ input, chat_history }, config);
      return {
        messages: [
          ...messages.reverse(),
          { role: "assistant", content: result },
        ],
      };
    } catch (err) {
      console.error("Gemini chat error:", err);
      return {
        messages: [
          ...messages.reverse(),
          {
            role: "assistant",
            content: JSON.stringify({
              message:
                "I'm having trouble processing your request. Would you like to talk to a human agent?",
              buttons: [{ label: "Talk to Agent", value: "talk to agent" }],
            }),
          },
        ],
      };
    }
  };

  return { invoke: invokeWithSystem };
}
