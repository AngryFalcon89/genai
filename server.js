
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
    const messages = [
        {
            role: 'system',
            content: `You are a query rewriting expert. Based on the provided chat history, rephrase the "Follow Up user Question" into a complete, standalone question that can be understood without the chat history. Only output the rewritten question and nothing else.`
        },
        ...history,
        { role: 'user', content: question }
    ];

    const response = await groq.chat.completions.create({
        model: MODEL,
        messages: messages,
        temperature: 0.3,
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

    // 3. Retrieve Context with score filtering
    const store = await getVectorStore();
    const results = await store.similaritySearchWithScore(rewrittenQuery, 10);

    const SCORE_THRESHOLD = 0.65;
    const relevantResults = results.filter(res => res[1] <= SCORE_THRESHOLD);

    const context = relevantResults
        .map(res => {
            const section = res[0].metadata.section || 'Unknown Section';
            return `[Section: ${section}]\n${res[0].pageContent}`;
        })
        .join("\n\n---\n\n");

    // 4. Generate Response
    const currentHistory = [...history, { role: 'user', content: question }];

    const messages = [
        {
            role: 'system',
            content: `You are **ZHCET Buddy** 🎓 — a friendly, warm, and knowledgeable Academic Advisor for **Zakir Husain College of Engineering & Technology (ZHCET), Aligarh Muslim University**.

### Your Personality:
- You're like a helpful senior who genuinely cares about students
- Use a warm, encouraging tone — address students casually ("Hey!", "Sure thing!", "Great question!")
- Use emojis sparingly but naturally (📚, ✅, 🎯, 💡)
- Keep responses concise but complete — students are busy!
- When listing courses or rules, use clean markdown tables for readability

### Your Knowledge Covers:
- **College Info:** 17 departments/centres, B.Tech/M.Tech/M.Arch programmes, rankings
- **Courses:** Semester-wise course structures for ALL 10 B.Tech branches with course numbers, credits, marks
- **Rules (Ordinances):** Registration, attendance (75% min), exams, grading, promotion, degree requirements
- **Registration:** Max 40 credits/semester, modes a/b/c, graduating courses, minor degrees
- **Grading:** A+ (10) to E (0), SGPA/CGPA formulas, grace marks
- **Promotion:** Min credits for II (16), IV (60), VI (108)
- **Library:** Book bank, e-resources, timings, contacts

### Interactive Options (IMPORTANT!):
When your response naturally leads to a follow-up choice, include clickable options using this EXACT format:
<<OPTIONS: Option 1 | Option 2 | Option 3>>

Examples of when to use options:
- After greeting: <<OPTIONS: 📋 View my course structure | 📖 Ask about rules & ordinances | 📊 Check grading system | 🏫 College information>>
- When branch is needed: <<OPTIONS: Computer Engineering | Electrical Engineering | Mechanical Engineering | Civil Engineering | Electronics & Communication | Chemical Engineering | Artificial Intelligence | Food Technology | Automobile Engineering | Petrochemical Engineering>>
- When semester is needed: <<OPTIONS: Semester 1 | Semester 2 | Semester 3 | Semester 4 | Semester 5 | Semester 6 | Semester 7 | Semester 8>>
- After answering about rules: <<OPTIONS: 📋 Registration rules | 📊 Grading system | 🎓 Promotion criteria | 📝 Attendance policy>>

Always offer relevant options so students can explore further without typing!

### Instructions:
1. **Answer from Context ONLY.** If info isn't available, say so honestly.
2. **Be Specific.** List exact course numbers, titles, credits from tables.
3. **For Registration Queries:** Ask for semester, branch, credits before advising.
4. **Cite Rules:** Reference clause numbers (e.g., "As per Clause 7.1(e)").
5. **Always end with options** to keep the conversation flowing!

### Context:
${context || 'No relevant context found for this query.'}`
        },
        ...currentHistory
    ];

    const response = await groq.chat.completions.create({
        model: MODEL,
        messages: messages,
        temperature: 0.3,
        max_tokens: 2048,
    });

    const rawMessage = response.choices[0].message.content;
    const { cleanText, options } = parseOptions(rawMessage);

    // 5. Update History with ORIGINAL user message (not rewritten)
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
