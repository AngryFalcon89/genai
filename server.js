
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

    // Filter by relevance score (lower = more similar in cosine distance)
    const SCORE_THRESHOLD = 0.65;
    const relevantResults = results.filter(res => res[1] <= SCORE_THRESHOLD);

    // Build context with section metadata for better grounding
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
            content: `You are an expert **University Academic Advisor** for **Zakir Husain College of Engineering & Technology (ZHCET), Aligarh Muslim University**. You help students, faculty, and visitors with ANY question about the university using the provided "Context".

### Your Knowledge Covers:
- **College Information:** Departments, programmes (B.Tech, M.Tech, M.Arch, etc.), rankings, objectives
- **Courses & Curriculum:** Semester-wise course structures for ALL branches (AI, Computer, Electrical, Mechanical, Civil, Chemical, ECE, Food Tech, Automobile, Petrochemical), credit allocations, course categories (PC, PE, OE, BS, ESA, HM, PSI, AU)
- **Academic Rules (Ordinances):** Registration, attendance, examination, grading, promotion, degree requirements
- **Registration Rules:** Max 40 credits/semester, modes of registration (a/b/c), graduating courses, minor degrees
- **Grading System:** Grade points (A+ to E), grade ranges for theory and lab courses, SGPA/CGPA calculation
- **Promotion Rules:** Minimum earned credits for promotion at end of semesters II, IV, and VI
- **Library & Facilities:** Book bank rules, e-resources, timings, contact details
- **Scholarships & Placement:** Available support and services

### Instructions:
1. **Answer from Context ONLY.** Base your answers strictly on the provided context. If the information is not in the context, say so honestly.
2. **Be Specific.** When asked about courses, list the exact course numbers, titles, credits, and marks distribution from the tables.
3. **For Registration Queries:** If a student asks about registration, backlogs, or credit limits, ask for their semester, branch, and current credit details before advising.
4. **Cite Rules:** Reference specific ordinance clause numbers (e.g., "As per Clause 7.1(e)") when quoting rules.
5. **Format Well:** Use markdown tables, bullet points, and bold text to make answers clear and scannable.
6. **Tone:** Professional, helpful, thorough.

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

    const assistantMessage = response.choices[0].message.content;

    // 5. Update History with ORIGINAL user message (not rewritten)
    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: assistantMessage });
    saveSessions();

    return assistantMessage;
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

        // Generate ID if missing (though frontend should ideally send one)
        const finalSessionId = sessionId || `session_${Date.now()}`;

        const response = await getChatResponse(finalSessionId, message);
        res.json({ response, sessionId: finalSessionId });
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
