
import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import Groq from 'groq-sdk';
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { LocalEmbeddings } from './utils/LocalEmbeddings.js';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';
const VECTOR_STORE_PATH = './vector_store';
const SESSIONS_FILE = './sessions.json';

// In-memory session store (Map<sessionId, Array<Message>>)
let Sessions = new Map();
let vectorStore = null;

// --- Session Management ---
function loadSessions() {
    if (fs.existsSync(SESSIONS_FILE)) {
        try {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            // Convert Object back to Map
            Sessions = new Map(Object.entries(parsed));
            console.log(`Loaded ${Sessions.size} chat sessions.`);
        } catch (e) {
            console.error("Error loading sessions:", e);
        }
    }
}

function saveSessions() {
    try {
        const obj = Object.fromEntries(Sessions);
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
        console.error("Error saving sessions:", e);
    }
}

// Load sessions on startup
loadSessions();

// --- Vector Store Logic ---
async function getVectorStore() {
    if (!vectorStore) {
        console.log("Loading vector store...");
        try {
            vectorStore = await HNSWLib.load(VECTOR_STORE_PATH, new LocalEmbeddings());
            console.log("Vector store loaded.");
        } catch (error) {
            console.error("Failed to load vector store. Make sure you have run 'node index.js'.", error);
            throw error;
        }
    }
    return vectorStore;
}

// --- Chat Logic ---
async function transformQuery(history, question) {
    // Use only recent history for rewriting to save tokens
    const recentHistory = history.slice(-8);
    const messages = [
        {
            role: 'system',
            content: `You are a query rewriting expert for a university course database (ZHCET, Aligarh Muslim University).
Rewrite the user's follow-up question as a standalone query that can be understood without the chat history.

IMPORTANT RULES:
- Always preserve the exact branch name (e.g., "Computer Engineering", "Artificial Intelligence", "Electrical Engineering") from chat context.
- Always preserve the semester number from chat context.
- If the user says something short like "Semester 3" or "what about CE?", infer the full meaning from the previous messages.
- Only output the rewritten question and nothing else.`
        },
        ...recentHistory,
        { role: 'user', content: question }
    ];

    const response = await groq.chat.completions.create({
        model: MODEL,
        messages: messages,
        temperature: 0.0,
        max_tokens: 256,
    });

    return response.choices[0].message.content;
}

// --- Options Parsing ---
function parseOptions(text) {
    const optionRegex = /<<OPTIONS:\s*(.+?)\s*>>/g;
    const options = [];
    let cleanText = text;

    let match;
    while ((match = optionRegex.exec(text)) !== null) {
        const items = match[1].split('|').map(s => s.trim()).filter(Boolean);
        options.push(...items);
        cleanText = cleanText.replace(match[0], '');
    }

    return { cleanText: cleanText.trim(), options };
}

async function getChatResponse(sessionId, question) {
    // 1. Get or Create Session
    if (!Sessions.has(sessionId)) {
        Sessions.set(sessionId, []);
    }
    const history = Sessions.get(sessionId);

    // 2. Rewrite Query (for vector search only)
    const rewrittenQuery = await transformQuery(history, question);
    console.log(`🔍 Rewritten query: "${rewrittenQuery}"`);

    // 3. Retrieve Context with score filtering (broader retrieval for completeness)
    const store = await getVectorStore();
    const results = await store.similaritySearchWithScore(rewrittenQuery, 25);

    const SCORE_THRESHOLD = 0.80;
    const relevantResults = results.filter(res => res[1] <= SCORE_THRESHOLD);
    console.log(`📊 Retrieved ${relevantResults.length}/${results.length} results (threshold: ${SCORE_THRESHOLD})`);

    // 4. Format context with clear delimiters for better LLM parsing
    const context = relevantResults
        .map(res => {
            const meta = res[0].metadata;
            if (meta.type === 'course_group') {
                return `=== SEMESTER COURSE GROUP ===\nBranch: ${meta.branch}\nSemester: ${meta.semester}\nTotal Courses: ${meta.course_count}\n\n${res[0].pageContent}\n=== END GROUP ===`;
            }
            if (meta.type === 'course') {
                return `=== INDIVIDUAL COURSE ===\nBranch: ${meta.branch}\nSemester: ${meta.semester}\nCode: ${meta.course_code}\nTitle: ${meta.course_title}\nCategory: ${meta.course_category_full} (${meta.course_category})\nCredits: ${meta.credits}\nContact Periods (LTP): ${meta.contact_periods}\nMarks: ${meta.marks}\n=== END COURSE ===`;
            }
            return `=== GENERAL INFORMATION ===\n${res[0].pageContent}\n=== END INFO ===`;
        })
        .join("\n\n");

    // 5. Generate Response (trim history to last 8 messages for token efficiency)
    const recentHistory = history.slice(-8);
    const currentHistory = [...recentHistory, { role: 'user', content: question }];

    const messages = [
        {
            role: 'system',
            content: `You are **ZHCET Buddy** 🎓, a highly accurate academic advisor for **Zakir Husain College of Engineering & Technology (ZHCET), Aligarh Muslim University**.

### STRICT ACCURACY RULES (NON-NEGOTIABLE):
- Use **ONLY** the retrieved context below to answer. Do not rely on prior knowledge for course data.
- If the exact answer is **not present** in the context, reply: "I cannot find this exact information in the official curriculum."
- **NEVER fabricate or hallucinate** course codes, course names, credits, or any academic data.
- Before listing a course, **verify** that its code prefix matches the branch (COC=Computer, MEC=Mechanical, EEC=Electrical, ELC=Electronics, CEC=Civil, CHC=Chemical, AIC=AI, FTC=Food Tech, PKC=Petrochemical, AUC=Automobile).

### THINK BEFORE ANSWERING (follow these steps internally):
1. Identify which **branch** and **semester** the user is asking about.
2. Look for a "SEMESTER COURSE GROUP" block in the context that matches that exact branch and semester.
3. If a group block is found, use ALL courses from that block — do not omit any.
4. Cross-check every course code prefix against the branch before including it.
5. If the context has fewer results than expected, say so honestly with a disclaimer.

### MISSING DATA GUARDRAIL:
- If the context contains fewer than 5 courses for a full semester, add this disclaimer:
  "⚠️ Note: The retrieved data may be incomplete. The official syllabus may list additional courses not shown here."
- NEVER say "there are only X courses" unless the context explicitly confirms the total count.

### Your Personality:
- Friendly and warm — like a helpful senior who cares about students.
- Use emojis sparingly (📚, ✅, 🎯, 💡).
- Keep responses concise. Use markdown tables for course listings.

### Interactive Options:
When it makes sense, offer follow-up choices using this format:
<<OPTIONS: Option 1 | Option 2 | Option 3>>

Use options for:
- Branch selection: <<OPTIONS: Computer Engineering | Electrical Engineering | Mechanical Engineering | Civil Engineering | Electronics & Communication | Chemical Engineering | Artificial Intelligence | Food Technology | Automobile Engineering | Petrochemical Engineering>>
- Semester selection: <<OPTIONS: Semester 1 | Semester 2 | Semester 3 | Semester 4 | Semester 5 | Semester 6 | Semester 7 | Semester 8>>

### Output Format:
1. Answer from Context ONLY.
2. Be specific — list exact course numbers, titles, and credits.
3. Format course listings as markdown tables with columns: Code, Title, Category, Credits, LTP.
4. Always end with relevant options.

### Example:
User: "What courses are in semester 5 for Computer Engineering?"

Here are the courses for **B.Tech Computer Engineering — Semester 5** 📚

| Code | Title | Category | Credits | LTP |
|------|-------|----------|---------|-----|
| COC3092 | Microprocessor Theory & Applications | PC | 3 | 3-0-0 |
| COC3932 | Algorithms & Operating Systems Lab | PC | 2 | 0-1-2 |

<<OPTIONS: Semester 4 | Semester 6 | Show electives only>>

### Retrieved Context:
${context || 'No relevant context found for this query.'}`
        },
        ...currentHistory
    ];

    const response = await groq.chat.completions.create({
        model: MODEL,
        messages: messages,
        temperature: 0.0,
        max_tokens: 2048,
    });

    const rawMessage = response.choices[0].message.content;
    const { cleanText, options } = parseOptions(rawMessage);

    // 6. Update History with ORIGINAL user message (not rewritten)
    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: cleanText });
    saveSessions();

    return { text: cleanText, options };
}

// --- API Endpoints ---

// Get all sessions (lightweight list)
app.get('/api/sessions', (req, res) => {
    const list = Array.from(Sessions.keys()).map(id => {
        const history = Sessions.get(id);
        const firstMsg = history.find(m => m.role === 'user')?.content || 'New Chat';
        return {
            id,
            title: firstMsg.substring(0, 30) + (firstMsg.length > 30 ? '...' : ''),
            count: history.length
        };
    });
    res.json(list.reverse()); // Newest first (if keys are ordered by insertion)
});

// Get specific session history
app.get('/api/sessions/:id', (req, res) => {
    const { id } = req.params;
    if (Sessions.has(id)) {
        res.json(Sessions.get(id));
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// Delete a session
app.delete('/api/sessions/:id', (req, res) => {
    const { id } = req.params;
    if (Sessions.delete(id)) {
        saveSessions();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const finalSessionId = sessionId || `session_${Date.now()}`;

        const { text, options } = await getChatResponse(finalSessionId, message);
        res.json({ response: text, options, sessionId: finalSessionId });
    } catch (error) {
        console.error('Error processing chat:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);
    try {
        await getVectorStore();
    } catch (e) {
        console.log("Warning: Vector store not found. Please run 'node index.js' to create it.");
    }
});
