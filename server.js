
import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import Groq from 'groq-sdk';
import multer from 'multer';
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { LocalEmbeddings } from './utils/LocalEmbeddings.js';
import { TimetableManager } from './timetableManager.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    }
}));
app.use(express.json({ limit: '128kb' }));
app.use(express.static('public'));

// Setup Multer for handling file uploads (temporarily stores in 'uploads/' folder)
const upload = multer({ dest: 'uploads/' });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';
const VECTOR_STORE_PATH = './vector_store';
const SESSIONS_FILE = './sessions.json';
const COURSES_JSON = './zhcet_courses.json';
const GENERAL_INFO_MD = './zhcet_general_info.md';
const REGISTRATION_RULES = JSON.parse(fs.readFileSync('./zhcet_registration_rules.json', 'utf8'));
const MAX_HISTORY_MESSAGES = 8;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONTEXT_CHARS = 12000;
const VECTOR_K_PER_QUERY = Number(process.env.VECTOR_K_PER_QUERY || 24);
const LEXICAL_K_PER_QUERY = Number(process.env.LEXICAL_K_PER_QUERY || 40);
const ENABLE_LLM_RERANK = (process.env.ENABLE_LLM_RERANK || 'false').toLowerCase() === 'true';
const LLM_RERANK_LIMIT = Number(process.env.LLM_RERANK_LIMIT || 10);

const BRANCHES = {
    AI: 'ARTIFICIAL INTELLIGENCE',
    AUTOMOBILE: 'AUTOMOBILE ENGINEERING (ELECTRIC AND HYBRID VEHICLES)',
    CHEMICAL: 'CHEMICAL ENGINEERING',
    CIVIL: 'CIVIL ENGINEERING',
    COMPUTER: 'COMPUTER ENGINEERING',
    ELECTRICAL: 'ELECTRICAL ENGINEERING',
    ECE: 'ELECTRONICS & COMMUNICATION ENGINEERING',
    FOOD: 'FOOD TECHNOLOGY',
    MECHANICAL: 'MECHANICAL ENGINEERING',
    PETRO: 'PETROCHEMICAL ENGINEERING',
    FIRST_YEAR: 'All Branches (First Year)',
};

const branchAliasMap = new Map();

function normalizeLookup(text = '') {
    return text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function addBranchAlias(alias, canonical) {
    branchAliasMap.set(normalizeLookup(alias), canonical);
}

[
    ['AI', BRANCHES.AI],
    ['ARTIFICIAL INTELLIGENCE', BRANCHES.AI],
    ['COMPUTER ENGINEERING', BRANCHES.COMPUTER],
    ['COMPUTER', BRANCHES.COMPUTER],
    ['CE', BRANCHES.COMPUTER],
    ['ELECTRICAL ENGINEERING', BRANCHES.ELECTRICAL],
    ['ELECTRICAL', BRANCHES.ELECTRICAL],
    ['EE', BRANCHES.ELECTRICAL],
    ['ELECTRONICS AND COMMUNICATION ENGINEERING', BRANCHES.ECE],
    ['ELECTRONICS & COMMUNICATION ENGINEERING', BRANCHES.ECE],
    ['ELECTRONICS COMMUNICATION ENGINEERING', BRANCHES.ECE],
    ['ECE', BRANCHES.ECE],
    ['MECHANICAL ENGINEERING', BRANCHES.MECHANICAL],
    ['MECHANICAL', BRANCHES.MECHANICAL],
    ['ME', BRANCHES.MECHANICAL],
    ['CIVIL ENGINEERING', BRANCHES.CIVIL],
    ['CIVIL', BRANCHES.CIVIL],
    ['CHEMICAL ENGINEERING', BRANCHES.CHEMICAL],
    ['CHEMICAL', BRANCHES.CHEMICAL],
    ['FOOD TECHNOLOGY', BRANCHES.FOOD],
    ['FOOD TECH', BRANCHES.FOOD],
    ['AUTOMOBILE ENGINEERING', BRANCHES.AUTOMOBILE],
    ['AUTOMOBILE ENGINEERING (ELECTRIC AND HYBRID VEHICLES)', BRANCHES.AUTOMOBILE],
    ['AUTOMOBILE ENGINEERING (ELECTRIC AND HYBRID VEHICLES', BRANCHES.AUTOMOBILE],
    ['AUTOMOBILE', BRANCHES.AUTOMOBILE],
    ['PETROCHEMICAL ENGINEERING', BRANCHES.PETRO],
    ['PETROCHEMICAL', BRANCHES.PETRO],
    ['FIRST YEAR', BRANCHES.FIRST_YEAR],
    ['ALL BRANCHES', BRANCHES.FIRST_YEAR],
    ['ALL BRANCHES FIRST YEAR', BRANCHES.FIRST_YEAR],
].forEach(([alias, canonical]) => addBranchAlias(alias, canonical));

const orderedBranchAliases = Array.from(branchAliasMap.entries())
    .sort((a, b) => b[0].length - a[0].length);

// In-memory session store (Map<sessionId, Array<Message>>)
let Sessions = new Map();
let vectorStore = null;
let vectorStorePromise = null;
let sessionSaveQueue = Promise.resolve();
let lexicalIndex = null;

// --- Session Management ---
function loadSessions() {
    if (fs.existsSync(SESSIONS_FILE)) {
        try {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            // Convert Object back to Map and migrate old flat-array format
            Sessions = new Map(
                Object.entries(parsed).map(([id, val]) => {
                    // Migrate old sessions (plain arrays) to {context, messages}
                    if (Array.isArray(val)) {
                        return [id, {
                            context: { branch: null, semester: null, section: null, categories: [], intent: 'other' },
                            messages: val
                        }];
                    }
                    return [id, val];
                })
            );
            console.log(`Loaded ${Sessions.size} chat sessions.`);
        } catch (e) {
            console.error("Error loading sessions:", e);
        }
    }
}

function saveSessions() {
    const obj = Object.fromEntries(Sessions);
    sessionSaveQueue = sessionSaveQueue
        .catch(() => { })
        .then(() => fs.promises.writeFile(SESSIONS_FILE, JSON.stringify(obj, null, 2)))
        .catch((e) => console.error("Error saving sessions:", e));
}

// Load sessions on startup
loadSessions();

// --- Vector Store Logic ---
async function getVectorStore() {
    if (vectorStore) return vectorStore;
    if (vectorStorePromise) return vectorStorePromise;

    vectorStorePromise = (async () => {
        console.log("Loading vector store...");
        try {
            vectorStore = await HNSWLib.load(VECTOR_STORE_PATH, new LocalEmbeddings());
            console.log("Vector store loaded.");
            return vectorStore;
        } catch (error) {
            console.error("Failed to load vector store. Make sure you have run 'node index.js'.", error);
            throw error;
        } finally {
            vectorStorePromise = null;
        }
    })();

    return vectorStorePromise;
}

function normalizeText(text = '') {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9&\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(text = '') {
    return normalizeText(text)
        .split(' ')
        .filter(token => token.length > 1);
}

function buildGroupText(coursesInGroup) {
    const { program, branch, semester } = coursesInGroup[0];
    const lines = [
        `${program} ${branch} — Semester ${semester}`,
        `This semester contains ${coursesInGroup.length} courses:`,
        '',
    ];

    for (const c of coursesInGroup) {
        const code = c.course_code || 'Elective/TBD';
        const ltp = c.contact_periods ? ` (LTP: ${c.contact_periods})` : '';
        lines.push(
            `• ${code}: ${c.course_title} — ${c.course_category_full} (${c.course_category}), ${c.credits} credits${ltp}`
        );
    }

    return lines.join('\n');
}

function buildGeneralInfoChunks(generalText) {
    const sections = generalText.split(/\n{2,}/);
    const chunks = [];
    let chunk = '';

    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;

        if (chunk.length + trimmed.length > 2500 && chunk.length > 0) {
            chunks.push(chunk.trim());
            chunk = '';
        }
        chunk += `${trimmed}\n\n`;
    }

    if (chunk.trim().length > 0) {
        chunks.push(chunk.trim());
    }

    return chunks;
}

function buildLexicalDocuments() {
    const docs = [];

    if (fs.existsSync(COURSES_JSON)) {
        const courses = JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8'));
        const grouped = {};

        for (const course of courses) {
            const key = `${course.branch}__${course.semester}${course.section ? '__' + course.section : ''}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(course);
        }

        for (const coursesInGroup of Object.values(grouped)) {
            const first = coursesInGroup[0];
            docs.push({
                pageContent: buildGroupText(coursesInGroup),
                metadata: {
                    source: 'zhcet_courses.json',
                    type: 'course_group',
                    program: first.program,
                    branch: first.branch,
                    semester: first.semester,
                    section: first.section || null,
                    course_count: coursesInGroup.length,
                    course_codes: coursesInGroup.map(c => c.course_code || 'Elective/TBD').join(', '),
                    course_titles: coursesInGroup.map(c => c.course_title).join(', '),
                },
            });
        }

        for (const course of courses) {
            const code = course.course_code || 'Elective/TBD';
            const searchableText = [
                course.searchable_text || '',
                `${course.program} ${course.branch} Semester ${course.semester}`,
                `${course.course_category_full} ${course.course_category}`,
                `${code} ${course.course_title}`,
                `credits ${course.credits}`,
            ].join(' ');

            docs.push({
                pageContent: searchableText,
                metadata: {
                    source: 'zhcet_courses.json',
                    type: 'course',
                    program: course.program,
                    branch: course.branch,
                    semester: course.semester,
                    section: course.section || null,
                    course_category: course.course_category,
                    course_category_full: course.course_category_full,
                    course_code: code,
                    course_title: course.course_title,
                    credits: course.credits,
                    contact_periods: course.contact_periods || 'N/A',
                    marks: course.marks || 'N/A',
                },
            });
        }
    }

    if (fs.existsSync(GENERAL_INFO_MD)) {
        const generalText = fs.readFileSync(GENERAL_INFO_MD, 'utf8');
        for (const chunk of buildGeneralInfoChunks(generalText)) {
            docs.push({
                pageContent: chunk,
                metadata: {
                    source: 'zhcet_general_info.md',
                    type: 'general_info',
                },
            });
        }
    }

    return docs;
}

function buildLexicalIndex() {
    const docs = buildLexicalDocuments();
    const docFreq = new Map();
    const indexedDocs = [];
    let totalLength = 0;

    for (const doc of docs) {
        const metaText = [
            doc.metadata.branch || '',
            doc.metadata.semester ? `semester ${doc.metadata.semester}` : '',
            doc.metadata.course_code || '',
            doc.metadata.course_title || '',
            doc.metadata.course_category || '',
        ].join(' ');
        const tokens = tokenize(`${doc.pageContent} ${metaText}`);
        const termFreq = new Map();
        for (const token of tokens) {
            termFreq.set(token, (termFreq.get(token) || 0) + 1);
        }
        for (const token of new Set(tokens)) {
            docFreq.set(token, (docFreq.get(token) || 0) + 1);
        }

        totalLength += tokens.length;
        indexedDocs.push({
            ...doc,
            key: uniqueResultKey(doc),
            termFreq,
            length: tokens.length,
        });
    }

    return {
        docs: indexedDocs,
        docFreq,
        docCount: indexedDocs.length,
        avgDocLength: indexedDocs.length > 0 ? totalLength / indexedDocs.length : 1,
    };
}

function getLexicalIndex() {
    if (!lexicalIndex) {
        lexicalIndex = buildLexicalIndex();
        console.log(`Lexical index built with ${lexicalIndex.docCount} documents.`);
    }
    return lexicalIndex;
}

function bm25Score(queryTokens, doc, index) {
    if (queryTokens.length === 0) return 0;
    const k1 = 1.2;
    const b = 0.75;
    let score = 0;

    for (const token of queryTokens) {
        const tf = doc.termFreq.get(token) || 0;
        if (tf === 0) continue;

        const df = index.docFreq.get(token) || 0;
        const idf = Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5));
        const denom = tf + k1 * (1 - b + b * (doc.length / index.avgDocLength));
        score += idf * ((tf * (k1 + 1)) / denom);
    }

    return score;
}

function sanitizeSessionId(sessionId) {
    if (typeof sessionId !== 'string') return null;
    const trimmed = sessionId.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
    return trimmed;
}

// --- LLM Tools Definition ---
const TOOLS = [
    {
        type: "function",
        function: {
            name: "get_courses",
            description: "Retrieves a list of courses for a specific branch, semester, and optional section.",
            parameters: {
                type: "object",
                properties: {
                    branch: { type: "string", description: "The canonical branch name (e.g. 'COMPUTER ENGINEERING')" },
                    semester: { type: "integer", description: "The semester number (1-8)" },
                    section: { type: "string", description: "Optional section, usually for first year (e.g. 'A1A' or 'A1DEF')" },
                    category: { type: "string", description: "Optional category filter (e.g. 'PC', 'PE', 'OE')" }
                },
                required: ["branch", "semester"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_course_details",
            description: "Retrieves specific details about a single course like credits, ltp, or lab status, given its course code.",
            parameters: {
                type: "object",
                properties: {
                    course_code: { type: "string", description: "The exact course code (e.g. 'COC2142')" },
                    student_current_semester: { type: "integer", description: "The student's current semester (1-8). Extract this from the conversation (e.g., '6th semester' = 6). If unknown, ask the user." }
                },
                required: ["course_code", "student_current_semester"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_registration_rules",
            description: "Retrieves the ZHCET registration rules, including ordinances about modes of registration (a, b, c mode), attendance condonation, detentions, backlogs, promotion, and special registrations.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },
    {
        type: "function",
        function: {
            name: "search_general_guidelines",
            description: "Searches the ZHCET knowledge base for general guidelines not covered by registration rules (e.g. syllabi preamble, placement info, scholarships).",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The search query string." }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_active_timetable",
            description: "Retrieves the currently active class timetable for schedule or clash checks.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    }
];

// Load courses into memory once
const COURSES_DATA = fs.existsSync(COURSES_JSON) ? JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8')) : [];

// --- Tool Implementations ---
async function executeTool(toolCall) {
    const { name, arguments: argsString } = toolCall.function;
    const args = JSON.parse(argsString);
    console.log(`🛠️ Executing tool: ${name}`, args);

    switch (name) {
        case 'get_courses': {
            const sem = Number(args.semester);
            let filtered = COURSES_DATA.filter(c =>
                (c.branch === args.branch || (sem <= 2 && c.branch.includes('First Year'))) &&
                Number(c.semester) === sem
            );
            if (args.section) {
                filtered = filtered.filter(c => !c.section || c.section === args.section || c.section.includes(args.section));
            }
            if (args.category) {
                const cat = args.category.toUpperCase();
                filtered = filtered.filter(c => c.course_category === cat);
            }
            if (filtered.length === 0) return JSON.stringify({ error: "No courses found matching the criteria." });
            return JSON.stringify(filtered.map(c => ({
                code: c.course_code,
                title: c.course_title,
                category: c.course_category,
                credits: c.credits,
                ltp: c.contact_periods
            })));
        }
        case 'get_course_details': {
            const course = COURSES_DATA.find(c => c.course_code === args.course_code);
            if (!course) return JSON.stringify({ error: `Course ${args.course_code} not found.` });

            // Native Evaluation of Constants
            const courseSem = Number(course.semester);
            let parity_evaluation = null;
            let is_lab = false;

            if (course.contact_periods) {
                const parts = course.contact_periods.split('-');
                if (parts.length === 3 && Number(parts[2]) > 0) is_lab = true;
            }

            if (args.student_current_semester) {
                const currentSem = Number(args.student_current_semester);
                const isCurrentEven = currentSem % 2 === 0;
                const isCourseEven = courseSem % 2 === 0;

                if (isCurrentEven !== isCourseEven) {
                    if (courseSem <= 2) {
                        parity_evaluation = `SYSTEM VERIFIED: Parity Mismatch (Sem ${currentSem} vs Sem ${courseSem}), HOWEVER this is a FIRST-YEAR COURSE (Sem <= 2). First-Year courses are offered in ALL semesters. Registration is PERMITTED. Ignore odd/even rules for this specific course.`;
                    } else {
                        parity_evaluation = `SYSTEM VERIFIED: CRITICAL PARITY MISMATCH. Student is in Sem ${currentSem} (${isCurrentEven ? 'Even' : 'Odd'}) but course is Sem ${courseSem} (${isCourseEven ? 'Even' : 'Odd'}). Registration is STRICTLY FORBIDDEN. You MUST tell the user they cannot register due to parity mismatch.`;
                    }
                } else {
                    parity_evaluation = `SYSTEM VERIFIED: Parity MATCH (Both are ${isCurrentEven ? 'Even' : 'Odd'} semesters). Registration is PERMITTED regarding Odd/Even rules. Do NOT say cross-registration between even semesters is forbidden.`;
                }
            }

            const extendedCourse = {
                ...course,
                is_lab_course: is_lab,
                ...(parity_evaluation ? { parity_evaluation } : {})
            };
            return JSON.stringify(extendedCourse);
        }
        case 'get_registration_rules': {
            return JSON.stringify(REGISTRATION_RULES);
        }
        case 'search_general_guidelines': {
            const store = await getVectorStore();
            const results = await store.similaritySearch(args.query, 4);
            return JSON.stringify(results.map(r => r.pageContent));
        }
        case 'get_active_timetable': {
            const activeTimetable = TimetableManager.getActiveTimetable();
            if (!activeTimetable) return JSON.stringify({ message: "No active timetable found." });
            return JSON.stringify(activeTimetable);
        }
        default:
            return JSON.stringify({ error: "Unknown tool" });
    }
}

// --- Chat Logic ---

// Options Parsing (Retained for backwards compatibility if the LLM generates them)
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
        Sessions.set(sessionId, { messages: [] });
    }
    const sessionData = Sessions.get(sessionId);
    // Backward compatibility for old format
    const history = Array.isArray(sessionData.messages) ? sessionData.messages :
        Array.isArray(sessionData) ? sessionData : [];

    const systemPrompt = `You are **ZHCET Buddy** 🎓, a highly accurate academic advisor for **Zakir Husain College of Engineering & Technology (ZHCET), Aligarh Muslim University**.

### STRICT RULES:
1. **Never Hallucinate:** Use the provided tools to retrieve real data. Do not guess course codes, credits, or registration policies.
2. **Missing Category:** If you use tools to find PE/OE/AU courses and none are returned, say explicitly: "There are no [Category] courses offered for this branch and semester."
3. **Registration Queries ("Mode A/B/C", backlogs, attendance, promotion):** ALWAYS call \`get_registration_rules\` to verify the policy. ALWAYS call \`get_course_details\` if the user asks about a specific course.
   **Odd/Even Semester Parity (CRITICAL):** When assessing if a student can take a course, you MUST check the \`parity_evaluation\` field returned by \`get_course_details\`. If it says "Registration is PERMITTED", do NOT invent rules forbidding it. If it says "Registration is STRICTLY FORBIDDEN", do not allow it. Follow the \`parity_evaluation\` verbatim.
4. **General Info:** If the user asks about library, placements, scholarships, etc., use \`search_general_guidelines\`.
5. **Interactive Flow:** If a user asks "What courses are in my semester?", ask them for their Branch and Semester instead of assuming.
6. **Final Semester:** Translate "final semester" to semester 8 for B.Tech, or 4 for M.Tech/MCA.
7. **First Year Sections:** If they ask for 1st or 2nd semester courses, ask for their section group (A1A/A1B/A1C vs A1D/A1E/A1F) if they haven't provided it, because first-year courses swap between groups.
8. **LTP Formatting:** 'L-T-P' means Lecture-Tutorial-Practical. A Practical (P) > 0 means it has a lab component. If P=0 (e.g., 3-1-0), it is a Theory course, NOT a lab.

### Format style:
- Friendly, warm tone.
- Format course returns as nice Markdown tables with columns: Code, Title, Category, Credits, LTP.
- You may dynamically append interactive options to the very end of your final response using EXACTLY this format if helpful: <<OPTIONS: Option 1 | Option 2>>`;

    // Ensure session isn't too huge before appending new questions
    let contextMessages = [...history].slice(-MAX_HISTORY_MESSAGES);

    // Convert generic local history formats if necessary, ensuring proper roles
    const groqMessages = [
        { role: 'system', content: systemPrompt },
        ...contextMessages.map(m => ({
            role: m.role || 'user',
            content: m.content || '',
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id, name: m.name } : {})
        })),
        { role: 'user', content: question }
    ];

    let currentResponse = null;
    let iterations = 0;
    const MAX_TOOL_ITERATIONS = 4;

    while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;
        console.log("LLM Call Iteration " + iterations + "...");

        currentResponse = await groq.chat.completions.create({
            model: MODEL,
            messages: groqMessages,
            temperature: 0.1,
            max_tokens: 2048,
            tools: TOOLS,
            tool_choice: "auto"
        });

        const msg = currentResponse.choices[0].message;
        groqMessages.push(msg); // Append LLM's raw response (which may just be a tool call)

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            // LLM decided to call tools
            for (const toolCall of msg.tool_calls) {
                const toolResult = await executeTool(toolCall);
                groqMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolCall.function.name,
                    content: toolResult
                });
            }
            // Loop goes again with the new tool results appended to history
        } else {
            // Processing done, LLM returned final text
            break;
        }
    }

    const finalContent = currentResponse.choices[0]?.message?.content || "I'm sorry, I couldn't process that request properly.";
    const { cleanText, options } = parseOptions(finalContent);

    // Save final interactions to session history
    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: cleanText });

    // Update store
    if (!Sessions.has(sessionId)) {
        Sessions.set(sessionId, { messages: history });
    } else {
        Sessions.get(sessionId).messages = history;
    }
    saveSessions();

    return { text: cleanText, options };
}

// --- API Endpoints ---

// Get all sessions (lightweight list)
app.get('/api/sessions', (req, res) => {
    const list = Array.from(Sessions.keys()).map(id => {
        const sessionData = Sessions.get(id);
        const history = sessionData.messages || sessionData; // backward compat
        const firstMsg = (Array.isArray(history) ? history : []).find(m => m.role === 'user')?.content || 'New Chat';
        return {
            id,
            title: firstMsg.substring(0, 30) + (firstMsg.length > 30 ? '...' : ''),
            count: Array.isArray(history) ? history.length : 0
        };
    });
    res.json(list.reverse());
});

// Get specific session history
app.get('/api/sessions/:id', (req, res) => {
    const id = sanitizeSessionId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'Invalid session id' });
    }
    if (Sessions.has(id)) {
        const sessionData = Sessions.get(id);
        res.json(sessionData.messages || sessionData);
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// Delete a session
app.delete('/api/sessions/:id', (req, res) => {
    const id = sanitizeSessionId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'Invalid session id' });
    }
    if (Sessions.delete(id)) {
        saveSessions();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// Get all Timetables (Admin)
app.get('/api/admin/timetable', (req, res) => {
    const timetables = TimetableManager.getAllTimetables();
    res.json({ active: timetables.length > 0, timetables });
});

// Upload a new Timetable (Admin only)
app.post('/api/admin/timetable', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const course = req.body.course || '';
        const branch = req.body.branch || '';
        const semester = req.body.semester || '';
        const newTimetable = await TimetableManager.processAndSaveTimetable(req.file.path, req.file.mimetype, course, branch, semester);
        const displayName = branch || 'Untitled Timetable';
        res.json({ success: true, message: `Timetable "${displayName}" processed!`, data: newTimetable });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a specific timetable by ID
app.delete('/api/admin/timetable/:id', (req, res) => {
    if (TimetableManager.deleteTimetable(req.params.id)) {
        res.json({ success: true, message: 'Timetable removed.' });
    } else {
        res.status(404).json({ error: 'Timetable not found.' });
    }
});

// Delete all timetables
app.delete('/api/admin/timetable', (req, res) => {
    if (TimetableManager.deleteAllTimetables()) {
        res.json({ success: true, message: 'All timetables removed.' });
    } else {
        res.status(404).json({ error: 'No timetables found.' });
    }
});

// Update timetable metadata
app.patch('/api/admin/timetable/:id/metadata', (req, res) => {
    const { course, branch, semester } = req.body;
    const updated = TimetableManager.updateTimetableMetadata(req.params.id, { course, branch, semester });
    if (updated) {
        res.json({ success: true, timetable: updated });
    } else {
        res.status(404).json({ error: 'Timetable not found.' });
    }
});

// Update timetable entries (full replace)
app.patch('/api/admin/timetable/:id/entries', (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'Entries must be an array.' });
    const updated = TimetableManager.updateTimetableEntries(req.params.id, entries);
    if (updated) {
        res.json({ success: true, timetable: updated });
    } else {
        res.status(404).json({ error: 'Timetable not found.' });
    }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        if (typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` });
        }

        const safeSessionId = sessionId ? sanitizeSessionId(sessionId) : null;
        if (sessionId && !safeSessionId) {
            return res.status(400).json({ error: 'Invalid session id' });
        }
        const finalSessionId = safeSessionId || `session_${Date.now()} `;

        const { text, options } = await getChatResponse(finalSessionId, message.trim());
        res.json({ response: text, options, sessionId: finalSessionId });
    } catch (error) {
        console.error('Error processing chat:', error);
        res.status(500).json({ error: 'Internal server error' });
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
