
import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import Groq from 'groq-sdk';
import multer from 'multer';
// Groq vision model is used for OCR (free tier, no Gemini dependency)
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
// ── 4-Tier Model Hierarchy ──────────────────────────────────────────────────
// Router: lightweight classifier — never used for final answers
const ROUTER_MODEL   = 'llama-3.1-8b-instant';
// Tier 1 (LOGIC)   : best for complex ordinance / promotion / honours reasoning
const TIER1_MODEL    = 'openai/gpt-oss-120b';
// Tier 2 (GENERAL) : versatile catch-all for basic info, greetings, simple facts
const TIER2_MODEL    = 'llama-3.3-70b-versatile';
// Tier 3 (DATA)    : 500 K TPD window, ideal for large JSON timetable/course data
const TIER3_MODEL    = 'qwen/qwen3-32b';
// Failover chain order (Tier 1 → 2 → 3 → Router as final safety net)
const FAILOVER_CHAIN = [TIER1_MODEL, TIER2_MODEL, TIER3_MODEL, ROUTER_MODEL];
// Legacy aliases kept so other parts of the file (OCR parsing, reranking) still work
const MODEL          = TIER2_MODEL;          // default / OCR parsing model
const FALLBACK_MODEL = ROUTER_MODEL;         // lightweight fallback for reranking

// Groq Vision model for OCR extraction (free tier)
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const VECTOR_STORE_PATH = './vector_store';
const SESSIONS_FILE = './sessions.json';
const SESSIONS_FILE_TMP = './sessions.json.tmp';
const SESSIONS_FILE_BAK = './sessions.json.bak';
const COURSES_JSON = './knowledge_base/zhcet_courses.json';
const GENERAL_INFO_MD = './knowledge_base/zhcet_general_info.md';
let REGISTRATION_RULES = {};
try {
    REGISTRATION_RULES = JSON.parse(fs.readFileSync('./knowledge_base/zhcet_registration_rules.json', 'utf8'));
} catch (error) {
    console.error('[Startup Error] Critical Knowledge Base file (registration_rules.json) missing or corrupt:', error.message);
    // Server continues with empty rules — queries will return {} but won't crash
}

// ── Task 3: Knowledge Base Anchoring — Non-negotiable academic constants ─────
const CONSTANTS_SUMMARY = `MANDATORY ACADEMIC CONSTANTS (These are non-negotiable facts. You MUST use these exact values and NEVER contradict them):
• Total Graduation Credits for B.Tech: 180 credits (not 160, not 200 — exactly 180).
• Maximum Credits per Semester: 40 credits (absolute hard cap, no exceptions).
• First-Year Backlog Rule: Semester 1 & 2 courses are offered in BOTH Odd and Even semesters. Students can register for first-year backlogs regardless of their current semester parity.
• B.Tech Duration: 4 years (8 semesters).
• Semester Parity: Odd semesters (1,3,5,7) and Even semesters (2,4,6,8). Courses from odd semesters cannot be taken in even semesters and vice versa, EXCEPT first-year courses (Sem 1 & 2).
• Minor Degree: A Minor Degree must consist of 24–30 additional credits beyond major requirements. Never suggest a total lower than 24 based on a database search.
• Online Courses (MOOCS): A minimum of 12 overall credits from online platforms (MOOCS/NPTEL) is mandatory for graduation. These satisfy PE (Programme Elective) or OE (Open Elective) categories.
• CGPA Degree Classification (CRITICAL — do NOT confuse these):
  - First Division (Honours): A student MUST satisfy BOTH conditions simultaneously:
      (a) Secure a CGPA of 8.5 or above, AND
      (b) Pass EVERY single course on the FIRST ATTEMPT — no backlogs, no failures, no repeats.
      A backlog in ANY semester permanently disqualifies a student from Honours, even if their final CGPA is 9.5.
  - First Division: CGPA between 6.5 and 8.5 (backlogs do NOT disqualify from this tier).
  - Branch Change Requirement: CGPA of 7.5 or above AND seat availability. (NOT related to graduation honours)
  - These three thresholds are DISTINCT. Never substitute one for another.
• Friday Library Rule: The ZHCET Library operates on a unique two-shift schedule on Fridays: 08:00 AM – 12:30 PM and 04:00 PM – 10:00 PM. You MUST use this specific timing whenever Friday is mentioned. Do NOT hallucinate continuous hours for Friday.`;
const MAX_HISTORY_MESSAGES = 8;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONTEXT_CHARS = 12000;
const VECTOR_K_PER_QUERY = Number(process.env.VECTOR_K_PER_QUERY || 24);
const LEXICAL_K_PER_QUERY = Number(process.env.LEXICAL_K_PER_QUERY || 40);
const ENABLE_LLM_RERANK = (process.env.ENABLE_LLM_RERANK || 'false').toLowerCase() === 'true';
const LLM_RERANK_LIMIT = Number(process.env.LLM_RERANK_LIMIT || 10);
/// Session eviction policy
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
const MAX_SESSIONS = 200;

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

/**
 * Migrate a raw session value from older formats to the canonical shape
 * { context, messages }.
 */
function migrateSession(id, val) {
    if (Array.isArray(val)) {
        return [id, {
            context: { branch: null, semester: null, section: null, categories: [], intent: 'other' },
            messages: val
        }];
    }
    return [id, val];
}

/**
 * Fix 2.3 — Resilient loadSessions.
 * Tries the primary sessions.json first. If that is corrupt or missing it falls
 * back to sessions.json.bak. Creates a fresh .bak on every successful load so
 * a good copy is always available.
 */
function loadSessions() {
    const tryParse = (filePath) => {
        const data = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(data);
        return new Map(Object.entries(parsed).map(([id, val]) => migrateSession(id, val)));
    };

    if (fs.existsSync(SESSIONS_FILE)) {
        try {
            Sessions = tryParse(SESSIONS_FILE);
            // Save a known-good backup
            fs.copyFileSync(SESSIONS_FILE, SESSIONS_FILE_BAK);
            console.log(`✅ Loaded ${Sessions.size} chat sessions from primary file.`);
            return;
        } catch (e) {
            console.error(`[Resilient Load] Primary ${SESSIONS_FILE} is corrupt: ${e.message}`);
        }
    }

    if (fs.existsSync(SESSIONS_FILE_BAK)) {
        try {
            Sessions = tryParse(SESSIONS_FILE_BAK);
            console.warn(`⚠️  Loaded ${Sessions.size} sessions from BACKUP (primary was corrupt/missing).`);
            return;
        } catch (e) {
            console.error(`[Resilient Load] Backup ${SESSIONS_FILE_BAK} is also corrupt: ${e.message}`);
        }
    }

    console.warn('[Resilient Load] Starting with empty session store.');
    Sessions = new Map();
}

/**
 * Fix 3.2 — Evict stale sessions before saving.
 * Removes sessions older than SESSION_TTL_MS and caps the store at MAX_SESSIONS
 * (keeping the most recently accessed).
 */
function evictStaleSessions() {
    const now = Date.now();
    let entries = Array.from(Sessions.entries())
        .filter(([_, v]) => !v.lastAccessed || (now - v.lastAccessed) < SESSION_TTL_MS)
        .sort((a, b) => (b[1].lastAccessed || 0) - (a[1].lastAccessed || 0))
        .slice(0, MAX_SESSIONS);

    const before = Sessions.size;
    Sessions = new Map(entries);
    if (Sessions.size < before) {
        console.log(`[Session Eviction] Retained ${Sessions.size}/${before} sessions (TTL=${SESSION_TTL_MS / 86400000}d, cap=${MAX_SESSIONS}).`);
    }
}

/**
 * Fix 2.1 — Atomic saveSessions.
 * Writes to a .tmp file, checks byte-count integrity, then renames atomically.
 * The rename is a POSIX atomic operation — readers always see a complete file.
 */
function saveSessions() {
    evictStaleSessions();
    const obj = Object.fromEntries(Sessions);
    const payload = JSON.stringify(obj, null, 2);

    sessionSaveQueue = sessionSaveQueue
        .catch(() => { })
        .then(async () => {
            await fs.promises.writeFile(SESSIONS_FILE_TMP, payload, 'utf8');

            // ── Logic Gate: verify the write was not truncated ────────────
            const stat = await fs.promises.stat(SESSIONS_FILE_TMP);
            const expectedBytes = Buffer.byteLength(payload, 'utf8');
            if (stat.size !== expectedBytes) {
                await fs.promises.unlink(SESSIONS_FILE_TMP).catch(() => { });
                throw new Error(
                    `[Strict Write] Session file integrity check failed: ` +
                    `expected ${expectedBytes} bytes, wrote ${stat.size}.`
                );
            }

            // Atomic promotion
            await fs.promises.rename(SESSIONS_FILE_TMP, SESSIONS_FILE);
        })
        .catch((e) => console.error('[Strict Write] Error saving sessions:', e));
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

function uniqueResultKey(doc) {
    const meta = doc.metadata || {};
    let parts = [meta.source || 'unknown', meta.type || 'unknown'];
    if (meta.course_code) parts.push(meta.course_code);
    if (meta.branch) parts.push(meta.branch.replace(/\s+/g, ''));
    if (meta.semester) parts.push(meta.semester);
    if (meta.section) parts.push(meta.section);
    if (meta.type === 'general_info' && doc.pageContent) {
        let hash = 0;
        for (let i = 0; i < doc.pageContent.length; i++) {
            hash = ((hash << 5) - hash) + doc.pageContent.charCodeAt(i);
            hash |= 0;
        }
        parts.push(Math.abs(hash).toString(16));
    }
    return parts.join('_').replace(/[^a-zA-Z0-9_]/g, '');
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
                    student_current_semester: { type: "integer", description: "The student's current semester (1-8). Optional — only provide if known from the conversation. Used for parity evaluation." }
                },
                required: ["course_code"]
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
            description: "Retrieves uploaded class timetables. Can filter by branch, semester, and a specific weekday. When a user asks about 'today' or 'tomorrow', derive the exact weekday name first, then call this tool with the day parameter set to that weekday (e.g. 'Friday').",
            parameters: {
                type: "object",
                properties: {
                    branch: { type: "string", description: "Optional branch filter (e.g. 'Computer Engineering')" },
                    semester: { type: "integer", description: "Optional semester number (1-8) to filter" },
                    day: { type: "string", description: "Optional weekday to filter entries (e.g. 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'). Derive this from 'today' or 'tomorrow' using the current date before calling." }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "validate_registration_card",
            description: "Validates the registration card/result that the student has uploaded in this chat session. Cross-references every course on the card against the official ZHCET curriculum. Call this tool ONLY when the student has uploaded a registration card image in this chat and asks to verify/validate it, or immediately after the system notifies you that a card was uploaded.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    }
];

// ── Task 1: Hard-Coded Tool White-List ───────────────────────────────────────
// Build a Set of valid tool names from the TOOLS array for O(1) lookup.
const VALID_TOOL_NAMES = new Set(TOOLS.map(t => t.function.name));

// Load courses into memory once
const COURSES_DATA = fs.existsSync(COURSES_JSON) ? JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8')) : [];

// --- Tool Implementations ---
async function executeTool(toolCall) {
    const { name, arguments: argsString } = toolCall.function;

    // ── Task 1: White-List Gate — Block hallucinated tool names at execution level
    if (!VALID_TOOL_NAMES.has(name)) {
        console.warn(`🚫 [Tool Guard] LLM tried to call non-existent tool: "${name}". Blocked.`);
        return JSON.stringify({
            error: `Error: Tool "${name}" does not exist. Please use search_general_guidelines to find this information instead.`
        });
    }

    // Guard: JSON.parse(null) returns null — always default to {} for no-param tools
    const args = (argsString ? JSON.parse(argsString) : null) ?? {};
    console.log(`🛠️ Executing tool: ${name}`, args);

    switch (name) {
        case 'get_courses': {
            const sem = Number(args.semester);
            const branchUpper = (args.branch || '').toUpperCase();
            let filtered = COURSES_DATA.filter(c =>
                // Case-insensitive branch match
                (c.branch.toUpperCase() === branchUpper || (sem <= 2 && c.branch.toUpperCase().includes('FIRST YEAR'))) &&
                Number(c.semester) === sem
            );
            if (args.section) {
                filtered = filtered.filter(c => !c.section || c.section === args.section || c.section.includes(args.section));
            }
            if (args.category) {
                const cat = args.category.toUpperCase();
                filtered = filtered.filter(c => c.course_category === cat);
            }
            if (filtered.length === 0) {
                const branchNote = args.branch
                    ? `"${args.branch}" (Semester ${args.semester})`
                    : `Semester ${args.semester}`;
                return JSON.stringify({
                    error: `System Note: No courses were found for ${branchNote}. Please verify the branch name is an exact canonical name (e.g., "COMPUTER ENGINEERING", "ARTIFICIAL INTELLIGENCE"). If the user asked about a backlog or elective, check if this course belongs to a different semester or use search_general_guidelines instead.`
                });
            }
            // ── Task 3: Truncate large result sets to prevent context-window bloat ──
            // Returning 100+ courses causes 90-second LLM latencies.
            const COURSE_LIMIT = 20;
            const truncated = filtered.length > 25;
            const resultSet = truncated ? filtered.slice(0, COURSE_LIMIT) : filtered;
            const payload = resultSet.map(c => ({
                code:     c.course_code,
                title:    c.course_title,
                category: c.course_category,
                credits:  c.credits,
                ltp:      c.contact_periods
            }));
            if (truncated) {
                console.log(`[get_courses] Truncated ${filtered.length} → ${COURSE_LIMIT} results to prevent context bloat.`);
                return JSON.stringify({
                    courses: payload,
                    system_note: `Showing the first ${COURSE_LIMIT} of ${filtered.length} results. Please specify a semester (e.g., Semester 4) or a category (e.g., PC, PE, OE) to see a focused list.`
                });
            }
            return JSON.stringify(payload);
        }
        case 'get_course_details': {
            const course = COURSES_DATA.find(c => c.course_code === args.course_code);
            if (!course) return JSON.stringify({ error: `Course ${args.course_code} not found.` });

            // Native Evaluation of Constants
            const courseSem = Number(course.semester);
            let parity_evaluation = undefined;
            let is_lab = false;

            if (course.contact_periods) {
                const parts = course.contact_periods.split('-');
                if (parts.length === 3 && Number(parts[2]) > 0) is_lab = true;
            }

            const isCourseEven = courseSem % 2 === 0;

            if (args.student_current_semester) {
                const currentSem = Number(args.student_current_semester);
                const isCurrentEven = currentSem % 2 === 0;

                if (isCurrentEven !== isCourseEven) {
                    if (courseSem <= 2) {
                        parity_evaluation = `SYSTEM VERIFIED: Parity Mismatch (Sem ${currentSem} vs Sem ${courseSem}), HOWEVER this is a FIRST-YEAR COURSE (Sem <= 2). First-Year courses are offered in ALL semesters. Registration is PERMITTED. You MUST explain this specific ZHCET ordinance to the user as a "Special Exception". Ignore odd/even rules for this specific course.`;
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
            // ── Optimised: return only the relevant sub-section when the query
            // targets a specific topic, saving tokens and reducing latency.
            const q = (toolCall._userQuestion || '').toLowerCase();
            if (q.includes('minor')) {
                const sub = REGISTRATION_RULES?.special_registrations?.minor_degree;
                if (sub) {
                    console.log('[get_registration_rules] Returning minor_degree sub-section only.');
                    return JSON.stringify({ minor_degree: sub });
                }
            }
            if (q.includes('promot')) {
                const sub = REGISTRATION_RULES?.promotion_and_continuation_criteria;
                if (sub) {
                    console.log('[get_registration_rules] Returning promotion_and_continuation_criteria sub-section only.');
                    return JSON.stringify({ promotion_and_continuation_criteria: sub });
                }
            }
            // Task 3: MOOCS / NPTEL / online courses sub-section
            if (q.includes('online') || q.includes('mooc') || q.includes('nptel')) {
                const sub = REGISTRATION_RULES?.online_courses;
                if (sub) {
                    console.log('[get_registration_rules] Returning online_courses sub-section only.');
                    return JSON.stringify({ online_courses: sub });
                } else {
                    console.log('[get_registration_rules] online_courses missing, returning full rules.');
                    return JSON.stringify(REGISTRATION_RULES);
                }
            }
            // Default: return full rules document
            return JSON.stringify(REGISTRATION_RULES);
        }
        case 'search_general_guidelines': {
            // ── RRF Hybrid Retrieval: Semantic (HNSW) + Lexical (BM25) ────────
            const RRF_K = 60; // RRF constant
            const RRF_TOP_N = 5; // Final results to return

            // 1. Semantic search via HNSW vector store
            const store = await getVectorStore();
            const semanticK = VECTOR_K_PER_QUERY; // default 24
            const semanticResults = await store.similaritySearch(args.query, semanticK);
            console.log(`[RRF] Semantic search returned ${semanticResults.length} results for: "${args.query}"`);

            // 2. BM25 lexical search using the pre-built index
            const lexIndex = getLexicalIndex();
            const queryTokens = tokenize(args.query);
            const lexicalScored = lexIndex.docs
                .map(doc => ({ doc, score: bm25Score(queryTokens, doc, lexIndex) }))
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, LEXICAL_K_PER_QUERY); // default 40
            console.log(`[RRF] BM25 lexical search returned ${lexicalScored.length} results.`);

            // 3. RRF Fusion — merge both ranked lists
            const rrfScores = new Map(); // key → { score, doc }

            for (let rank = 0; rank < semanticResults.length; rank++) {
                const doc = semanticResults[rank];
                const key = uniqueResultKey(doc);
                const existing = rrfScores.get(key) || { score: 0, doc };
                existing.score += 1 / (RRF_K + rank + 1);
                rrfScores.set(key, existing);
            }

            for (let rank = 0; rank < lexicalScored.length; rank++) {
                const doc = lexicalScored[rank].doc;
                const key = doc.key || uniqueResultKey(doc);
                const existing = rrfScores.get(key) || { score: 0, doc };
                existing.score += 1 / (RRF_K + rank + 1);
                rrfScores.set(key, existing);
            }

            // 4. Sort by fused RRF score and take top N
            const rrfRanked = Array.from(rrfScores.values())
                .sort((a, b) => b.score - a.score)
                .slice(0, RRF_TOP_N);

            if (rrfRanked.length === 0) {
                return JSON.stringify({
                    note: 'System Note: No relevant documents found in the knowledge base for this query. Try rephrasing the query with different keywords, or inform the user that this information is not available.'
                });
            }

            console.log(`[RRF] Top ${rrfRanked.length} fused results (scores: ${rrfRanked.map(r => r.score.toFixed(4)).join(', ')})`);

            // 5. Optional LLM reranking on top of RRF output
            if (ENABLE_LLM_RERANK && rrfRanked.length > 3) {
                console.log(`[LLM Rerank] Reranking ${rrfRanked.length} RRF chunks for query: "${args.query}"`);
                try {
                    const candidatesText = rrfRanked
                        .map((r, i) => `[${i + 1}] ${r.doc.pageContent.slice(0, 400)}`)
                        .join('\n\n');

                    const rerankPrompt = `You are a relevance judge. Given the user's query and a list of candidate text snippets, return ONLY a JSON array of the 3 most relevant snippet numbers (1-indexed integers), ordered from most to least relevant. No explanation.\n\nQuery: "${args.query}"\n\nCandidates:\n${candidatesText}\n\nReply with ONLY a JSON array, e.g.: [3, 1, 5]`;

                    const rerankResp = await groq.chat.completions.create({
                        model: FALLBACK_MODEL,
                        messages: [{ role: 'user', content: rerankPrompt }],
                        temperature: 0,
                        max_tokens: 64,
                    });

                    const rerankText = (rerankResp.choices[0]?.message?.content || '').trim();
                    const arrMatch = rerankText.match(/\[([\d,\s]+)\]/);
                    if (arrMatch) {
                        const indices = JSON.parse(arrMatch[0]);
                        const reranked = indices
                            .map(i => rrfRanked[i - 1])
                            .filter(Boolean)
                            .slice(0, 3);
                        if (reranked.length > 0) {
                            console.log(`[LLM Rerank] Selected indices: ${indices.join(', ')} → ${reranked.length} snippets returned.`);
                            return JSON.stringify(reranked.map(r => r.doc.pageContent));
                        }
                    }
                    console.warn('[LLM Rerank] Could not parse rerank response, falling back to RRF top results.');
                } catch (rerankErr) {
                    console.warn(`[LLM Rerank] Rerank failed (${rerankErr.message}), falling back to RRF top results.`);
                }
            }

            return JSON.stringify(rrfRanked.map(r => r.doc.pageContent));
        }
        case 'get_active_timetable': {
            const activeTimetable = TimetableManager.getActiveTimetable({
                branch: args.branch,
                semester: args.semester
            });
            if (!activeTimetable) return JSON.stringify({ requested_day: args.day || 'ALL', message: "No active timetable found." });

            // Server-side day filtering — narrow entries to the requested day
            if (args.day) {
                const dayFilter = args.day.trim().toLowerCase();
                if (Array.isArray(activeTimetable)) {
                    const filtered = activeTimetable.map(tt => ({
                        ...tt,
                        entries: (tt.entries || []).filter(e =>
                            (e.day || '').toLowerCase() === dayFilter
                        )
                    }));
                    const hasEntries = filtered.some(tt => tt.entries.length > 0);
                    if (!hasEntries) {
                        return JSON.stringify({
                            requested_day: args.day,
                            message: `No classes scheduled for ${args.day}.`,
                            timetables: filtered
                        });
                    }
                    // Task 3: Explicit day anchor so the LLM never confuses which day this data is for
                    return JSON.stringify({ requested_day: args.day, timetables: filtered });
                }
            }

            return JSON.stringify({ requested_day: 'ALL', timetables: activeTimetable });
        }
        case 'validate_registration_card': {
            return JSON.stringify(validateRegistrationCard(toolCall._sessionId));
        }
        default:
            // This should never be reached due to the white-list gate above,
            // but kept as a safety net.
            return JSON.stringify({ error: `Error: Tool "${name}" does not exist. Please use search_general_guidelines to find this information instead.` });
    }
}

// --- Registration Card OCR & Validation ---

async function extractRegistrationCardData(filePath, mimeType) {
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const resolvedMimeType = mimeType || 'image/jpeg';

    // ── Step 1: Groq Vision — Simple OCR (extract raw text) ─────────────
    console.log('🔍 Step 1: Groq Vision OCR...');

    const ocrPrompt = `Extract ALL text visible in this document/image exactly as it appears. Include every course code, course title, credit value, student name, enrollment number, branch, semester, year, and any other text. Preserve the layout structure as much as possible. Do not interpret or summarize — just extract the raw text.`;

    const groqVisionResult = await groq.chat.completions.create({
        model: GROQ_VISION_MODEL,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: ocrPrompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${resolvedMimeType};base64,${base64Data}`
                        }
                    }
                ]
            }
        ],
        temperature: 0,
        max_tokens: 2048
    });

    const rawOcrText = (groqVisionResult.choices[0]?.message?.content || '').trim();
    console.log(`📝 OCR extracted ${rawOcrText.length} characters`);

    if (!rawOcrText || rawOcrText.length < 20) {
        throw new Error('Could not extract meaningful text from the uploaded file. Please try a clearer image or PDF.');
    }

    // ── Step 2: Groq LLM — Parse raw text into structured JSON ────────
    console.log('🧠 Step 2: Groq structured parsing...');

    const parsingPrompt = `You are a data extraction expert. Below is raw OCR text extracted from a ZHCET (Zakir Husain College of Engineering & Technology) registration card or academic result.

Parse this text and return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
    "student_name": "Full Name or null if not found",
    "enrollment_no": "Enrollment/Faculty number or null",
    "branch": "Branch/Department name (e.g., COMPUTER ENGINEERING, ARTIFICIAL INTELLIGENCE)",
    "semester": <semester number as integer, e.g., 3>,
    "year_of_study": "<e.g., 2nd Year, 3rd Year, or null>",
    "semester_type": "<Odd or Even based on semester number>",
    "academic_year": "<e.g., 2024-25 or null>",
    "courses": [
        {
            "course_code": "e.g., COC2142",
            "course_title": "Full course title",
            "credits": <number>,
            "contact_periods": "L-T-P format if visible, else null",
            "category": "PC/PE/OE/BS/ESA/HM/AU/PSI if visible, else null"
        }
    ],
    "total_credits": <total if visible, else null>,
    "additional_info": "Any other relevant info found in the text"
}

RULES:
- Extract EVERY course from the text
- Course codes follow patterns like COC2142, AIC3072, ELA2412, AMS2612
- Credits are numbers like 2, 3, 4, or 1.5
- semester_type: Odd for semesters 1,3,5,7 and Even for 2,4,6,8
- Return ONLY the JSON object, nothing else

RAW OCR TEXT:
${rawOcrText}`;

    const groqResult = await groq.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: 'You are a precise data extraction system. Return only valid JSON.' },
            { role: 'user', content: parsingPrompt }
        ],
        temperature: 0,
        max_tokens: 2048
    });

    const responseText = (groqResult.choices[0]?.message?.content || '').trim();

    // ── Fix 1.1 — Self-Healing JSON parse (2-pass with error-fed re-prompt) ──
    const tryParseJson = (text) => {
        let jsonText = text.trim();
        const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonText = fenceMatch[1].trim();
        return JSON.parse(jsonText); // throws if not valid JSON
    };

    // Pass 1 — try what we got
    // Hoist the error message so it is accessible outside the catch block
    let firstErrMessage = 'JSON parse error';
    try {
        return tryParseJson(responseText);
    } catch (firstErr) {
        firstErrMessage = firstErr.message;
        console.warn(`[Self-Heal] OCR: First JSON parse attempt failed: ${firstErrMessage}`);
    }

    // Pass 2 — feed the error back to the LLM for self-correction
    console.log('[Self-Heal] OCR: Retrying with error-augmented correction prompt...');
    const correctionPrompt = `Your previous response could not be parsed as JSON.
Parse error: ${firstErrMessage}

Your previous response was:
---
${responseText}
---

Return ONLY the corrected, valid JSON object. No markdown, no explanation, no code fences.`;

    const retryResult = await groq.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: 'You are a precise data extraction system. Return only valid JSON.' },
            { role: 'user', content: correctionPrompt }
        ],
        temperature: 0,
        max_tokens: 2048
    });

    const retryText = (retryResult.choices[0]?.message?.content || '').trim();
    try {
        return tryParseJson(retryText);
    } catch (secondErr) {
        console.error('[Self-Heal] OCR: Both JSON parse attempts failed.', retryText);
        throw new Error(
            'Could not parse the registration card data after two attempts. ' +
            'Please try uploading a clearer image.'
        );
    }
}

function validateRegistrationCard(sessionId) {
    if (!Sessions.has(sessionId)) {
        return { error: 'Session not found.' };
    }

    const sessionData = Sessions.get(sessionId);
    const cardData = sessionData.uploadedCard;

    if (!cardData) {
        return { error: 'No registration card has been uploaded in this chat session. Please upload an image of your registration card first.' };
    }

    const extracted = cardData;
    const branch = extracted.branch;
    const semester = Number(extracted.semester);
    const semesterType = semester % 2 === 0 ? 'Even' : 'Odd';

    // Find all official courses for this branch + semester
    const officialCourses = COURSES_DATA.filter(c => {
        const matchBranch = c.branch === branch ||
            (semester <= 2 && c.branch.includes('First Year'));
        return matchBranch && Number(c.semester) === semester;
    });

    // Build a lookup map for official courses
    const officialByCode = new Map();
    for (const c of officialCourses) {
        if (c.course_code) {
            officialByCode.set(c.course_code, c);
        }
    }

    // Also build a reverse lookup across ALL courses for codes not in this branch/sem
    const allCoursesByCode = new Map();
    for (const c of COURSES_DATA) {
        if (c.course_code) {
            allCoursesByCode.set(c.course_code, c);
        }
    }

    const validationResults = {
        student_info: {
            name: extracted.student_name,
            enrollment_no: extracted.enrollment_no,
            branch: branch,
            semester: semester,
            semester_type: semesterType,
            year_of_study: extracted.year_of_study,
            academic_year: extracted.academic_year
        },
        correct_courses: [],
        incorrect_courses: [],
        extra_courses: [],
        missing_courses: [],
        total_extracted_credits: 0,
        total_expected_credits: 0,
        summary: ''
    };

    const matchedOfficialCodes = new Set();

    // Validate each extracted course
    for (const extractedCourse of (extracted.courses || [])) {
        const code = extractedCourse.course_code;
        const extractedCredits = Number(extractedCourse.credits);
        validationResults.total_extracted_credits += extractedCredits || 0;

        // Check if this course code exists in official curriculum for this branch+sem
        if (officialByCode.has(code)) {
            const official = officialByCode.get(code);
            matchedOfficialCodes.add(code);

            const issues = [];

            // Check credits
            if (extractedCredits !== Number(official.credits)) {
                issues.push(`Credits mismatch: card says ${extractedCredits}, official is ${official.credits}`);
            }

            // Check course title similarity (fuzzy)
            const officialTitle = (official.course_title || '').toLowerCase().trim();
            const extractedTitle = (extractedCourse.course_title || '').toLowerCase().trim();
            if (officialTitle && extractedTitle && !officialTitle.includes(extractedTitle.slice(0, 10)) && !extractedTitle.includes(officialTitle.slice(0, 10))) {
                issues.push(`Title may differ: card says "${extractedCourse.course_title}", official is "${official.course_title}"`);
            }

            if (issues.length > 0) {
                validationResults.incorrect_courses.push({
                    course_code: code,
                    extracted_title: extractedCourse.course_title,
                    official_title: official.course_title,
                    extracted_credits: extractedCredits,
                    official_credits: official.credits,
                    category: official.course_category,
                    issues: issues
                });
            } else {
                validationResults.correct_courses.push({
                    course_code: code,
                    course_title: official.course_title,
                    credits: official.credits,
                    category: official.course_category,
                    contact_periods: official.contact_periods
                });
            }
        } else if (allCoursesByCode.has(code)) {
            // Course exists but NOT for this branch/semester
            const actual = allCoursesByCode.get(code);
            const courseSem = Number(actual.semester);
            const courseSemType = courseSem % 2 === 0 ? 'Even' : 'Odd';

            const issues = [`This course belongs to ${actual.branch}, Semester ${actual.semester} (${courseSemType}), not ${branch}, Semester ${semester}`];

            // Check parity
            if ((semester % 2) !== (courseSem % 2) && courseSem > 2) {
                issues.push(`Semester parity mismatch: student is in ${semesterType} semester, course is from ${courseSemType} semester`);
            }

            validationResults.extra_courses.push({
                course_code: code,
                extracted_title: extractedCourse.course_title,
                actual_branch: actual.branch,
                actual_semester: actual.semester,
                credits: actual.credits,
                issues: issues
            });
        } else {
            // Course code not found at all
            validationResults.extra_courses.push({
                course_code: code,
                extracted_title: extractedCourse.course_title,
                extracted_credits: extractedCredits,
                issues: [`Course code "${code}" was not found in the ZHCET course database`]
            });
        }
    }

    // Find missing courses (in official curriculum but not on the card)
    for (const [code, official] of officialByCode) {
        if (!matchedOfficialCodes.has(code)) {
            // Skip electives (null course codes) from missing list
            if (!code || code === 'Elective/TBD') continue;
            validationResults.missing_courses.push({
                course_code: code,
                course_title: official.course_title,
                credits: official.credits,
                category: official.course_category
            });
        }
    }

    // Calculate expected credits
    validationResults.total_expected_credits = officialCourses.reduce((sum, c) => sum + Number(c.credits || 0), 0);

    // Build summary
    const totalCorrect = validationResults.correct_courses.length;
    const totalIncorrect = validationResults.incorrect_courses.length;
    const totalExtra = validationResults.extra_courses.length;
    const totalMissing = validationResults.missing_courses.length;
    const totalOnCard = (extracted.courses || []).length;

    let verdict = 'VALID';
    if (totalIncorrect > 0 || totalExtra > 0 || totalMissing > 0) {
        verdict = 'ISSUES FOUND';
    }

    validationResults.summary = `Semester ${semester} (${semesterType}) | ${totalOnCard} courses on card | ${totalCorrect} correct, ${totalIncorrect} incorrect, ${totalExtra} extra, ${totalMissing} missing | Credits: ${validationResults.total_extracted_credits} on card vs ${validationResults.total_expected_credits} expected | Verdict: ${verdict}`;

    return validationResults;
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

// ── Intelligent Router ──────────────────────────────────────────────────────
/**
 * Calls ROUTER_MODEL (lightweight 8B) to classify the user's query into:
 *   [LOGIC]  → Tier 1 (GPT-OSS-120B)  — ordinances, honours, promotion, CGPA
 *   [DATA]   → Tier 3 (Qwen3-32B)     — timetables, course lists, room numbers
 *   [BASIC]  → Tier 2 (Llama-70B)     — greetings, general college info
 *
 * Returns one of the string literals 'LOGIC' | 'DATA' | 'BASIC'.
 * Silently defaults to 'BASIC' on any router error.
 */
async function classifyQueryIntent(question) {
    const routerPrompt =
        `Classify the user's query into one of three specific categories:

[BASIC]: Greetings, library timings, college location, general college history, or casual talk.
[DATA]: Requests for timetables, class schedules, room numbers, lists of courses, or teacher names.
[LOGIC]: Questions about credits, honours eligibility, promotion rules, backlogs, registration modes (A/B/C), or CGPA thresholds.

Return ONLY the category label: [BASIC], [DATA], or [LOGIC].

Query: "${question}"`;

    try {
        const routerResp = await groq.chat.completions.create({
            model: ROUTER_MODEL,
            messages: [{ role: 'user', content: routerPrompt }],
            temperature: 0,
            max_tokens: 12,
        });
        const raw = (routerResp.choices[0]?.message?.content || '').toUpperCase();
        if (raw.includes('[LOGIC]') || raw.includes('LOGIC'))  return 'LOGIC';
        if (raw.includes('[DATA]')  || raw.includes('DATA'))   return 'DATA';
        return 'BASIC';
    } catch (routerErr) {
        console.warn(`[Router] Classification failed (${routerErr.message}). Defaulting to BASIC.`);
        return 'BASIC';
    }
}


async function getChatResponse(sessionId, question) {
    // ── Observability timers & diagnostics ───────────────────────────────────
    const startTime     = performance.now();
    let intentCategory  = 'UNKNOWN';   // set after router call
    let activeModel     = TIER2_MODEL; // updated by router + failover
    let retryCount      = 1;           // incremented on each failover hop
    const loopDeadline  = Date.now() + 90_000; // 90-second hard timeout — extra headroom for multi-tool Logic queries

    // 1. Get or Create Session
    if (!Sessions.has(sessionId)) {
        Sessions.set(sessionId, { messages: [] });
    }
    const sessionData = Sessions.get(sessionId);
    // Stamp last-access time for the eviction policy
    sessionData.lastAccessed = Date.now();

    // Backward compatibility for old format
    const history = Array.isArray(sessionData.messages) ? sessionData.messages :
        Array.isArray(sessionData) ? sessionData : [];

    // ── Task 2: Dynamic Date & Day Injection ─────────────────────────────────
    // Generate real-time date context instead of hard-coding.
    const now = new Date();
    const todayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const tomorrowDate = new Date(now);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowName = tomorrowDate.toLocaleDateString('en-US', { weekday: 'long' });
    const dateContext = `Current Date: ${now.toDateString()}. Today is ${todayName}. Tomorrow is ${tomorrowName}.`;

    const systemPrompt = `You are **ZHCET Buddy** 🎓, a highly accurate academic advisor for **Zakir Husain College of Engineering & Technology (ZHCET), Aligarh Muslim University**.

### STRICT RULES:
1. **Never Hallucinate:** Use the provided tools to retrieve real data. Do not guess course codes, credits, or registration policies. Strictly adhere to the defined toolset. You ONLY have the tools listed in the code. If you need credit or graduation info, you MUST use search_general_guidelines or get_registration_rules. If a tool is not in your definition, it does not exist.
2. **Missing Category:** Only use the 'No [Category] courses offered' message for the student's CURRENT semester registration. If the query is about a backlog or a course from a different semester, ignore this fallback and explain why the course might not be visible (e.g., parity rules or search failure).
3. **Registration Queries ("Mode A/B/C", backlogs, attendance, promotion):** ALWAYS call \`get_registration_rules\` to verify the policy. ALWAYS call \`get_course_details\` if the user asks about a specific course.
   **CRITICAL EXCEPTION:** First-year courses (Semester 1 and 2) like Applied Physics, Applied Maths, etc., are offered in BOTH Odd and Even semesters. If a student asks about a backlog from Semester 1 or 2, you MUST inform them that registration is permitted regardless of current semester parity. Do not ask for a course code if the user provides the course name; use search_general_guidelines to retrieve the code.
   **Odd/Even Semester Parity (CRITICAL):** When assessing if a student can take a course, you MUST check the \`parity_evaluation\` field returned by \`get_course_details\`. If it says "Registration is PERMITTED", do NOT invent rules forbidding it. If it says "Registration is STRICTLY FORBIDDEN", do not allow it. Follow the \`parity_evaluation\` verbatim.
4. **General Info:** If the user asks about library, placements, scholarships, etc., use \`search_general_guidelines\`.
5. **Interactive Flow:** If a user asks "What courses are in my semester?", ask them for their Branch and Semester instead of assuming.
6. **Final Semester:** Translate "final semester" to semester 8 for B.Tech, or 4 for M.Tech/MCA.
7. **First Year Sections:** If they ask for 1st or 2nd semester courses, ask for their section group (A1A/A1B/A1C vs A1D/A1E/A1F) if they haven't provided it, because first-year courses swap between groups.
8. **LTP Formatting:** 'L-T-P' means Lecture-Tutorial-Practical. A Practical (P) > 0 means it has a lab component. If P=0 (e.g., 3-1-0), it is a Theory course, NOT a lab.
9. **Registration Card Upload:** If a student uploads a registration card image, the system will automatically extract its data. You should then call \`validate_registration_card\` to verify the extracted courses. Present the validation results in a clear, structured report with:
   - ✅ Correct courses (code, title, credits all match)
   - ❌ Incorrect courses (wrong credits, wrong course code, or course not found)
   - ⚠️ Missing courses (expected in the curriculum but absent from the card)
   - 📋 Extra courses (on the card but not in the official curriculum for that branch+semester)
   - Summary: semester type (odd/even), total credits, overall verdict
10. **Fact Check Totals & Thresholds:** You must strictly distinguish between CGPA requirements — they are NOT interchangeable:
    - **7.5 CGPA** → Branch Change eligibility (seat-dependent). Use this ONLY when a student asks about changing their branch.
    - **8.5 CGPA + Zero Backlogs** → First Division (Honours). BOTH conditions are mandatory. A CGPA ≥ 8.5 earns Honours ONLY if the student has NEVER had a backlog or failure. A CGPA between 6.5 and 8.5 earns First Division (without Honours).
    - **Never suggest 7.5 for graduation honours.** If a student asks "What CGPA do I need for Honours?", the answer is 8.5 AND first-attempt in all courses.
    - The total credit requirement for B.Tech is 180. If you find yourself about to say a different number, stop — the correct value is 180.
11. **Credit Limits:** The absolute maximum credit limit for any semester is 40 credits. This is a hard rule found in zhcet_registration_rules.json. Never suggest a lower 'typical' limit like 24 or 26. If a student asks to register for more than 40, tell them it is strictly forbidden by the ordinances. When a student asks about finishing early, correctly reference the 180-credit total requirement and suggest they can register for up to 40 credits per semester to accelerate, provided they meet the promotion criteria.
12. **No Invented Conditions:** Do not invent academic conditions for registration limits (like CGPA or attendance) unless they are explicitly stated in zhcet_registration_rules.json. If the document only mentions a flat 40-credit limit, stick to that.
13. **Branch Change Context Gate:** The 7.5 CGPA threshold applies ONLY to branch change requests. Do not mention it in any other context. If a student asks about branch changes, reference the 7.5 CGPA requirement and inform them it is also subject to seat availability in the desired branch.
14. **Honours Backlog Disqualification (Hard Rule):** If a user asks about Honours AND mentions a backlog, failure, supplementary exam, re-appear, or repeating any course — you MUST immediately inform them they are permanently ineligible for Honours. Do NOT suggest exceptions, workarounds, or offer false hope. Do NOT say "it depends" or "check with the university". The rule is absolute: any backlog = no Honours, regardless of final CGPA.

### Output Policy:
- Provide ONLY the final student-facing answer. You are prohibited from using introductory phrases about your internal process or tools.
- NEVER say: "I will check", "Let me look that up", "I need to verify", "After checking", "According to the rules", "Based on my search", "I found that", "Let me search", "According to my hard-coded rules", "I am checking the constants", "As per my instructions", or any similar phrase.
- If you use a tool, act as if the information is part of your inherent knowledge. Present results directly.
- Start every response with the actual answer, never with a preamble about what you are about to do.
- **Firmness on Hard Rules:** When a rule is absolute (e.g., Honours disqualification due to backlogs), be clear and direct. Do NOT soften the message with phrases like "you might still have a chance" or "it's worth checking" — if the ordinance has no exception, your answer must have none either. Being genuinely helpful means being accurate, not encouraging.

### Communication Style:
- If a user names a common course (e.g., 'Applied Physics') but doesn't provide the code, proactively use search_general_guidelines to find the code and then call get_course_details. Never ask the user for information that is likely present in your knowledge base.
- **Rule 15 (Single-Turn Synthesis — CRITICAL):** You must retrieve ALL facts in your very first turn. If data is split across rules and general information, call both \`get_registration_rules\` AND \`search_general_guidelines\` simultaneously as a parallel tool call. Do NOT wait for one result before calling the other. Do NOT provide a partial answer and promise to look up the rest. Get everything at once, then synthesize.
- **Rule 16 (Ordinance Priority):** When providing totals (like Minor credits or Graduation credits), always prioritize the range specified in the Ordinances (e.g., 24–30) over a manual sum of courses found in the database. Explicitly state the ordinance range first.
- **Rule 17 (Zero-Gate Course ID — CRITICAL):** If a user provides a course code (e.g., COC3112), you MUST immediately call \`get_course_details\` with only the \`course_code\` parameter and provide the course name and category. Do NOT ask for the student's semester first. Only ask for the semester AFTER providing the name if you need it to check registration eligibility or parity.
- Friendly, warm tone.

### Date Context:
- ${dateContext}
- **Timetable Day Mapping (CRITICAL):** When a user asks about 'today', 'tomorrow', or a named day, you MUST first derive the exact weekday name using the current date above (e.g. if today is Thursday, tomorrow is Friday). Then call \`get_active_timetable\` with the \`day\` parameter set to that exact weekday string (e.g. \`day: "Friday"\`). Never call \`get_active_timetable\` without the \`day\` parameter when the user is asking about a specific day.

### Timetable Integrity (NON-NEGOTIABLE):
- **Forbid Invented Data:** You are strictly forbidden from adding 'Professor Names' or 'Room Numbers' if they are not explicitly present in the JSON returned by \`get_active_timetable\`. Never assume or invent staff names, room numbers, or building names. Only include columns for which the tool returned actual data.
- **Rule 18 (The Empty Day Rule — CRITICAL):** If \`get_active_timetable\` returns no entries for a specific day, you MUST NOT generate a Markdown table. Your only response for that day should be: "There are no classes scheduled for [Day]." Never provide a 'sample', 'typical', or 'example' schedule for an empty day. **Day-Change Reset:** If the user changes the day they are asking about (e.g., from 'tomorrow' to 'today'), treat it as a completely fresh query and IGNORE all previous timetable entries in the conversation history. Only use the data returned by the latest tool call or pre-fetched injection.
- **Timetable Citations (MANDATORY):** When providing a timetable, you MUST explicitly state the day at the top of your response (e.g. "Here is your schedule for **Friday**:"). Always verify the \`requested_day\` field in the tool response matches the day the user asked about.
- **Rule 20 (History Isolation — CRITICAL):** Every user query must be answered using ONLY the most recent tool output or pre-fetched system injection for that specific day. You are strictly forbidden from reusing a Markdown table from a previous turn (e.g., Saturday's schedule) for a different day (e.g., Friday), even if the course codes are the same. If the data for the new day is different, you MUST generate a new table from the fresh data. Old timetable data in conversation history is stale and must be ignored.

### Format style:
- Ensure that all course and timetable data is returned in clean Markdown tables.
- Format course returns as nice Markdown tables with columns: Code, Title, Category, Credits, LTP.
- If returning a timetable schedule, only include columns that have actual data from the tool response (e.g. Time, Course Code, Title). Do NOT add Professor or Room columns if the data is absent.
- You may dynamically append interactive options to the very end of your final response using EXACTLY this format if helpful: <<OPTIONS: Option 1 | Option 2>>`;


    // ── Fix 3.1 — Summarize-on-the-fly context pruning ───────────────────────
    // If the conversation is longer than the window, compress the oldest messages
    // into a pinned intent-summary block so the LLM never forgets branch/semester.
    let contextMessages;
    if (history.length <= MAX_HISTORY_MESSAGES) {
        contextMessages = [...history];
    } else {
        const toSummarize = history.slice(0, history.length - MAX_HISTORY_MESSAGES);
        const recent = history.slice(-MAX_HISTORY_MESSAGES);
        const alreadySummarized = recent.some(m => m._isSummary);

        if (alreadySummarized) {
            contextMessages = recent;
        } else {
            console.log(`[Context Pruning] Summarizing ${toSummarize.length} old messages...`);
            try {
                const sumResult = await groq.chat.completions.create({
                    model: MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a context distillation assistant. Extract and preserve the ACTIVE USER PROFILE (branch, semester, section). These MUST be at the top of your summary if known.'
                        },
                        {
                            role: 'user',
                            content: 'Summarize the key academic context from this conversation:\n\n' +
                                toSummarize.map(m => `${m.role.toUpperCase()}: ${m.content || ''}`).join('\n')
                        }
                    ],
                    temperature: 0,
                    max_tokens: 256,
                });
                const summary = sumResult.choices[0]?.message?.content || '';
                console.log(`[Context Pruning] Summary: ${summary}`);
                contextMessages = [
                    { role: 'system', content: `[ACTIVE USER PROFILE]:\n${summary}`, _isSummary: true },
                    ...recent
                ];
            } catch (sumErr) {
                // Summarization failed — fall back to a hard slice (safe degradation)
                console.warn(`[Context Pruning] Summarization failed: ${sumErr.message}. Falling back to hard slice.`);
                contextMessages = recent;
            }
        }
    }

    // Convert generic local history formats if necessary, ensuring proper roles
    // ── Task 3: Inject CONSTANTS_SUMMARY as a separate, non-prunable system message
    const groqMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: CONSTANTS_SUMMARY },
        ...contextMessages
            .filter(m => !m._isSummary || m.role === 'system') // keep summary as system message
            .map(m => ({
                role: m.role || 'user',
                content: m.content || '',
                ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
                ...(m.tool_call_id ? { tool_call_id: m.tool_call_id, name: m.name } : {})
            })),
        { role: 'user', content: question }
    ];

    // ── Step A: Intelligent Router — classify query intent ───────────────────
    intentCategory = await classifyQueryIntent(question);

    // Select preferred model based on intent; set activeModel for the loop
    // ── Task 4: Intent-aware failover order ─────────────────────────────────
    // DATA queries skip the heavy 120B model (slow + unnecessary for structured
    // data retrieval). LOGIC queries skip Qwen (weaker on ordinance reasoning).
    let FAILOVER_ORDER;
    switch (intentCategory) {
        case 'LOGIC':
            activeModel   = TIER1_MODEL;
            // Logic chain: 120B → 70B → 8B (skip Qwen)
            FAILOVER_ORDER = [TIER1_MODEL, TIER2_MODEL, ROUTER_MODEL];
            break;
        case 'DATA':
            activeModel   = TIER3_MODEL;
            // Data chain: Qwen → 70B → 8B (skip 120B — overkill for data)
            FAILOVER_ORDER = [TIER3_MODEL, TIER2_MODEL, ROUTER_MODEL];
            break;
        case 'BASIC':
        default:
            activeModel   = TIER3_MODEL;
            // General chain: Qwen (500k TPD) → 70B → 8B — avoids 429s on 70B's 100k TPD cap
            FAILOVER_ORDER = [TIER3_MODEL, TIER2_MODEL, ROUTER_MODEL];
            break;
    }
    console.log(`[Router] Intent: ${intentCategory} → activeModel: ${activeModel} | failover: [${FAILOVER_ORDER.join(', ')}]`);

    let currentResponse = null;
    let iterations = 0;
    const MAX_TOOL_ITERATIONS = 6;

    // ── Task 1: Proactive Logic Injection ────────────────────────────────────
    // For LOGIC questions, pre-fetch the relevant rules and inject them directly
    // into the system message so the 120B model already has the answer in its
    // context on its very first LLM call — no tool-call round-trip needed.
    if (intentCategory === 'LOGIC') {
        try {
            const rulesCall = {
                function: { name: 'get_registration_rules', arguments: '{}' },
                _userQuestion: question,
                _sessionId:    sessionId,
                id:            'proactive_inject_rules',
            };
            let guidelinesQuery = question;
            const summaryMsg = contextMessages.find(m => m._isSummary);
            if (summaryMsg) {
                const text = summaryMsg.content;
                let contextStr = '';
                const branchMatch = text.match(/branch:\s*([^\n,]+)/i);
                if (branchMatch) contextStr += branchMatch[1].trim() + " ";
                const semMatch = text.match(/semester:\s*(\d+)/i);
                if (semMatch) contextStr += `Sem ${semMatch[1]} `;
                
                if (contextStr) {
                    guidelinesQuery = `[${contextStr.trim()}] ${question}`;
                } else {
                    // Fallback to prepending a short substring of the summary
                    const cleanText = text.replace('[ACTIVE USER PROFILE]:', '').replace(/\n/g, ' ').trim();
                    guidelinesQuery = `[${cleanText.slice(0, 50)}] ${question}`;
                }
            }

            const guidelinesCall = {
                function: { name: 'search_general_guidelines', arguments: JSON.stringify({ query: guidelinesQuery }) },
                _userQuestion: question,
                _sessionId:    sessionId,
                id:            'proactive_inject_guidelines',
            };

            const [rulesJson, guidelinesJson] = await Promise.all([
                executeTool(rulesCall),
                executeTool(guidelinesCall)
            ]);

            const injectionNote =
                `\n\n---\n**[SYSTEM: Pre-fetched Registration Rules for this LOGIC query]**\n` +
                `The following data is already available — you do NOT need to call get_registration_rules again.\n\`\`\`json\n${rulesJson}\n\`\`\`\n\n` +
                `**[SYSTEM: Pre-fetched General Guidelines for this LOGIC query]**\n` +
                `The following data is already available — you do NOT need to call search_general_guidelines again.\n\`\`\`json\n${guidelinesJson}\n\`\`\`\n---`;
            // Append to the system message (first entry in groqMessages)
            if (groqMessages[0]?.role === 'system') {
                groqMessages[0].content += injectionNote;
            }
            console.log(`[Proactive Inject] Pre-loaded rules and guidelines into system context (~${rulesJson.length + guidelinesJson.length} chars).`);
        } catch (injectErr) {
            // Non-fatal — model will call the tool itself as a fallback
            console.warn(`[Proactive Inject] Failed to pre-fetch data: ${injectErr.message}. Model will tool-call instead.`);
        }
    }

    // ── Task 4: Proactive Day-Aware Injection for DATA Queries ───────────────
    // If the query mentions a day, pre-fetch timetable + library timings so the
    // LLM already has the answer in its context on the first call.
    if (intentCategory === 'DATA') {
        const qLower = question.toLowerCase();
        const dayKeywords = ['today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const hasDayRef = dayKeywords.some(k => qLower.includes(k));

        if (hasDayRef) {
            try {
                // Derive the target day name
                let targetDay = todayName; // default to today
                if (qLower.includes('tomorrow')) targetDay = tomorrowName;
                for (const d of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) {
                    if (qLower.includes(d)) { targetDay = d.charAt(0).toUpperCase() + d.slice(1); break; }
                }

                // Extract user profile (branch, semester) from conversation summary
                let extractedBranch = undefined;
                let extractedSemester = undefined;
                const summaryMsg = contextMessages.find(m => m._isSummary);
                if (summaryMsg) {
                    const text = summaryMsg.content;
                    const branchMatch = text.match(/branch:\s*([^\n,]+)/i);
                    if (branchMatch) extractedBranch = branchMatch[1].trim();
                    const semMatch = text.match(/semester:\s*(\d+)/i);
                    if (semMatch) extractedSemester = Number(semMatch[1]);
                }
                // Also try to extract from the current question or recent history
                if (!extractedBranch) {
                    for (const m of contextMessages.slice().reverse()) {
                        if (!m.content) continue;
                        const bm = m.content.match(/(?:branch|department)[:\s]+([A-Za-z\s&]+(?:engineering|intelligence|technology))/i);
                        if (bm) { extractedBranch = bm[1].trim(); break; }
                    }
                }
                if (!extractedSemester) {
                    for (const m of contextMessages.slice().reverse()) {
                        if (!m.content) continue;
                        const sm = m.content.match(/(?:semester|sem)[:\s]*(\d+)/i);
                        if (sm) { extractedSemester = Number(sm[1]); break; }
                    }
                }

                // Build timetable args with profile if available
                const timetableArgs = { day: targetDay };
                if (extractedBranch) timetableArgs.branch = extractedBranch;
                if (extractedSemester) timetableArgs.semester = extractedSemester;
                console.log(`[Day-Aware Inject] Profile: branch=${extractedBranch || 'unknown'}, semester=${extractedSemester || 'unknown'}, day=${targetDay}`);

                const [timetableJson, libraryJson] = await Promise.all([
                    executeTool({
                        function: { name: 'get_active_timetable', arguments: JSON.stringify(timetableArgs) },
                        _sessionId: sessionId, _userQuestion: question, id: 'proactive_inject_timetable'
                    }),
                    executeTool({
                        function: { name: 'search_general_guidelines', arguments: JSON.stringify({ query: `library timings ${targetDay}` }) },
                        _sessionId: sessionId, _userQuestion: question, id: 'proactive_inject_library'
                    })
                ]);

                const dayInjection =
                    `\n\n---\n**[SYSTEM: Pre-fetched Day-Aware Data for ${targetDay}]**\n` +
                    `⚠️ IMPORTANT: This data is for **${targetDay} ONLY**. Do NOT reuse timetable data from any previous turn.\n` +
                    `Target Day: ${targetDay}\n` +
                    `The following timetable data is already available — you do NOT need to call get_active_timetable again.\n\`\`\`json\n${timetableJson}\n\`\`\`\n\n` +
                    `The following library/general info is already available — you do NOT need to call search_general_guidelines again.\n\`\`\`json\n${libraryJson}\n\`\`\`\n---`;

                if (groqMessages[0]?.role === 'system') {
                    groqMessages[0].content += dayInjection;
                }
                console.log(`[Day-Aware Inject] Pre-loaded timetable + library data for ${targetDay} (~${timetableJson.length + libraryJson.length} chars).`);
            } catch (injectErr) {
                // Non-fatal — model will call the tools itself as a fallback
                console.warn(`[Day-Aware Inject] Failed to pre-fetch data: ${injectErr.message}. Model will tool-call instead.`);
            }
        }
    }

    /**
     * Strip model-specific extra fields (e.g. `reasoning` from gpt-oss-120b)
     * before sending history to a different model that rejects them with a 400.
     * Only the fields Groq's chat completion API accepts are kept.
     */
    function sanitiseMessages(msgs) {
        return msgs.map(m => {
            // Allowed keys per Groq spec
            const clean = {
                role:    m.role,
                content: m.content ?? null,
            };
            if (m.tool_calls)   clean.tool_calls   = m.tool_calls;
            if (m.tool_call_id) clean.tool_call_id = m.tool_call_id;
            if (m.name)         clean.name         = m.name;
            // `reasoning`, `refusal`, and any other extras are intentionally omitted
            return clean;
        });
    }

    while (iterations < MAX_TOOL_ITERATIONS && Date.now() < loopDeadline) {
        iterations++;
        console.log(`[LLM] Iteration ${iterations} — model: ${activeModel}`);

        let llmCallSucceeded = false;
        try {
            currentResponse = await groq.chat.completions.create({
                model:       activeModel,
                messages:    sanitiseMessages(groqMessages),
                temperature: 0.1,
                max_tokens:  2048,
                tools:       TOOLS,
                tool_choice: 'auto',
            });
            llmCallSucceeded = true;
            console.log(`[LLM] Model "${activeModel}" responded on attempt ${retryCount}.`);
        } catch (llmErr) {
            // ── Cascading Failover: 429 Rate-Limit or 5xx server error ─────────
            // 413 = request too large (Qwen free-tier TPM/context cap) — treat as retryable
            const isRateLimit  = llmErr?.status === 429 || llmErr?.status === 413;
            const isServerErr  = llmErr?.status >= 500 && llmErr?.status < 600;

            if (isRateLimit || isServerErr) {
                // Walk FAILOVER_ORDER to find the next model after activeModel
                const currentIdx = FAILOVER_ORDER.indexOf(activeModel);
                const nextModel  = FAILOVER_ORDER[currentIdx + 1];

                if (nextModel) {
                    const reason = isRateLimit ? 'rate limit (429)' : `server error (${llmErr.status})`;
                    console.warn(`[Failover] "${activeModel}" hit ${reason}. Switching to "${nextModel}" (attempt ${retryCount + 1}).`);
                    activeModel = nextModel;
                    retryCount++;
                    continue; // retry the while loop with the new model
                }
                // Chain exhausted — fall through and throw
            }

            // ── 400 tool_use_failed Self-Heal ─────────────────────────────────
            const isToolUseFailed =
                llmErr?.status === 400 &&
                (llmErr?.error?.error?.code === 'tool_use_failed' ||
                    llmErr?.message?.includes('tool_use_failed'));

            if (isToolUseFailed) {
                console.warn(`[Self-Heal] tool_use_failed on iteration ${iterations}. Retrying without tools...`);
                try {
                    currentResponse = await groq.chat.completions.create({
                        model:       activeModel,
                        messages:    sanitiseMessages(groqMessages),
                        temperature: 0.1,
                        max_tokens:  2048,
                        // No tools — forces plain text response
                    });
                    const recoveryMsg = currentResponse.choices[0].message;
                    groqMessages.push(recoveryMsg);
                    console.log('[Self-Heal] Recovery succeeded — plain-text response obtained.');
                    break;
                } catch (recoveryErr) {
                    console.error(`[Self-Heal] Recovery also failed: ${recoveryErr.message}`);
                    throw recoveryErr;
                }
            }

            // Non-retryable — re-throw
            throw llmErr;
        }

        if (!llmCallSucceeded) break;

        const msg = currentResponse.choices[0].message;
        groqMessages.push(msg); // Append LLM's raw response (which may just be a tool call)

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            // LLM decided to call tools
            for (const toolCall of msg.tool_calls) {
                // Attach sessionId for tools that need session context
                toolCall._sessionId    = sessionId;
                toolCall._userQuestion = question;   // used by get_registration_rules for targeted sub-section lookup

                // ── Fix 1.2 — Self-Healing Tool Loop ─────────────────────────
                // Wrap executeTool so a crash is converted into a structured JSON
                // error message that the LLM can handle gracefully, rather than
                // bubbling up and killing the entire request.
                let toolResult;
                try {
                    toolResult = await executeTool(toolCall);

                    // Logic Gate: check for soft errors inside the result
                    try {
                        const parsed = JSON.parse(toolResult);
                        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
                            console.warn(
                                `[Logic Gate] Tool "${toolCall.function.name}" returned soft error: ${parsed.error}`
                            );
                        }
                    } catch (_) { /* result wasn't JSON — that's fine */ }

                } catch (toolErr) {
                    console.error(
                        `[Self-Heal] Tool "${toolCall.function.name}" threw an exception: ${toolErr.message}`
                    );
                    // Feed the error back to the LLM so it can recover
                    toolResult = JSON.stringify({
                        error: `Tool execution failed: ${toolErr.message}`,
                        recovery_suggestion: 'Try reformulating the query or ask the user for more information.'
                    });
                }

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

    const finalContent = currentResponse.choices[0]?.message?.content ||
        "I've retrieved the data, but I encountered a timeout while synthesizing. Please ask about the 'CGPA requirement' and 'Credit requirement' as separate questions.";
    const { cleanText, options } = parseOptions(finalContent);

    // Save final interactions to session history
    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: cleanText });

    // Update store
    if (!Sessions.has(sessionId)) {
        Sessions.set(sessionId, { messages: history, lastAccessed: Date.now() });
    } else {
        const sd = Sessions.get(sessionId);
        sd.messages = history;
        sd.lastAccessed = Date.now();
    }
    saveSessions();

    // ── Observability: build diagnostic return object ────────────────────────
    const debug = {
        model:    activeModel,
        intent:   intentCategory,
        latency:  Math.round(performance.now() - startTime),
        attempts: retryCount,
    };
    console.log(`[Debug] intent=${debug.intent} | model=${debug.model} | latency=${debug.latency}ms | attempts=${debug.attempts}`);

    return { text: cleanText, options, debug };
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

// Upload registration card endpoint (chat-specific)
app.post('/api/chat/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
        if (!allowedTypes.includes(req.file.mimetype)) {
            // Clean up temp file
            try { fs.unlinkSync(req.file.path); } catch (_) { }
            return res.status(400).json({ error: 'Only image files (JPEG, PNG, WebP) and PDFs are supported. Please upload a photo, scan, or PDF of your registration card.' });
        }

        const sessionId = req.body.sessionId ? sanitizeSessionId(req.body.sessionId) : null;
        const finalSessionId = sessionId || `session_${Date.now()}`;

        console.log(`📄 Processing registration card upload for session: ${finalSessionId}`);

        // Extract data using Gemini Vision
        const extractedData = await extractRegistrationCardData(req.file.path, req.file.mimetype);

        // Clean up temp file
        try { fs.unlinkSync(req.file.path); } catch (_) { }

        // Store extracted data in session
        if (!Sessions.has(finalSessionId)) {
            Sessions.set(finalSessionId, { messages: [] });
        }
        const sessionData = Sessions.get(finalSessionId);
        sessionData.uploadedCard = extractedData;
        saveSessions();

        console.log(`✅ Extracted ${(extractedData.courses || []).length} courses from registration card`);

        // Build a summary for the user
        const courseSummary = (extractedData.courses || []).map(c =>
            `• ${c.course_code}: ${c.course_title} (${c.credits} credits)`
        ).join('\n');

        const extractionSummary = [
            `**Student:** ${extractedData.student_name || 'Not detected'}`,
            `**Enrollment:** ${extractedData.enrollment_no || 'Not detected'}`,
            `**Branch:** ${extractedData.branch || 'Not detected'}`,
            `**Semester:** ${extractedData.semester || 'Not detected'} (${extractedData.semester_type || 'N/A'})`,
            `**Year:** ${extractedData.year_of_study || 'Not detected'}`,
            '',
            `**Courses Found (${(extractedData.courses || []).length}):**`,
            courseSummary
        ].join('\n');

        // Auto-trigger validation via chat
        const validationPrompt = `[SYSTEM: A registration card image has been uploaded and processed. The extracted data has been stored in this session. Here is what was extracted:\n\n${extractionSummary}\n\nPlease call the validate_registration_card tool to verify this data against the official ZHCET curriculum, then present the validation report to the student.]`;

        const { text, options } = await getChatResponse(finalSessionId, validationPrompt);

        res.json({
            success: true,
            sessionId: finalSessionId,
            extractedData,
            extractionSummary,
            validationResponse: text,
            options
        });
    } catch (error) {
        // Clean up temp file on error
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (_) { }
        }
        console.error('Error processing registration card:', error);
        res.status(500).json({ error: error.message || 'Failed to process registration card. Please try again with a clearer image.' });
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
        const finalSessionId = safeSessionId || `session_${Date.now()}`;

        const { text, options, debug } = await getChatResponse(finalSessionId, message.trim());
        res.json({ response: text, options, sessionId: finalSessionId, debug });
    } catch (error) {
        // ── Task 5: Detailed error logging — surface the exact line that failed
        const logLine = `[${new Date().toISOString()}] [/api/chat ERROR]\n${error.stack || error.message || error}\n\n`;
        try { fs.appendFileSync('./server.log', logLine); } catch (_) {}
        console.error('[/api/chat] Detailed Error:', error.stack || error.message || error);
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
    // Pre-warm the lexical index
    getLexicalIndex();
});
