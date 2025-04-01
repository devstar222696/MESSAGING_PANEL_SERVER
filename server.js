require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { OpenAI } = require("openai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const agents = {
  "Lisa": {
    name: "Lisa",
    prompt: "You are Lisa, a friendly support agent. Keep it casual and helpful."
  },
  "Dr. Maxwell": {
    name: "Dr. Maxwell",
    prompt: "You are Dr. Maxwell, a technical expert. Respond concisely and formally."
  },
  "Zara": {
    name: "Zara",
    prompt: "You are Zara, a witty assistant. Make responses fun and clever."
  }
};

async function retryOpenAIRequest(requestFn, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await requestFn();
    } catch (err) {
      if (err.status === 429 && i < retries - 1) {
        console.warn("⚠️ Rate limit hit. Retrying in", delayMs, "ms...");
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        throw err;
      }
    }
  }
}

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  socket.on("userMessage", async ({ message, agent }) => {
    try {
      const selectedAgent = agents[agent] || agents["Lisa"];

      const response = await retryOpenAIRequest(() =>
        openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: selectedAgent.prompt },
            { role: "user", content: message },
          ],
        })
      );

      const reply = response.choices[0].message.content;

      const suggestionResponse = await retryOpenAIRequest(() =>
        openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are an assistant that suggests the next 3 possible follow-up questions a user might ask based on a conversation. Respond only with the suggestions, formatted as a numbered list without any extra commentary."
            },
            {
              role: "user",
              content: `Conversation:\nUser: ${message}\nAgent: ${reply}\n\nSuggest 3 follow-up questions.`
            }
          ],
          temperature: 0.7,
        })
      );

      const suggestionText = suggestionResponse.choices[0].message.content.trim();
      const suggestions = suggestionText
        .split(/\n+/)
        .map(line => line.replace(/^\d+\.\s*/, ""))
        .filter(Boolean);

      socket.emit("agentReply", {
        reply,
        suggestions,
        agentName: selectedAgent.name
      });
    } catch (error) {
      console.error("OpenAI error:", error.message);
      socket.emit("agentReply", {
        reply: "⚠️ Error generating response",
        suggestions: ["Please try again."],
        agentName: "System"
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

