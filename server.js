
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

function extractSemester(text = '') {
    const patterns = [
        /(?:semester|sem)\s*[-:]?\s*(\d{1,2})\b/i,
        /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:semester|sem)\b/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const sem = Number(match[1]);
        if (Number.isInteger(sem) && sem >= 1) return sem;
    }
    return null;
}

function extractBranch(text = '') {
    const normalized = ` ${normalizeLookup(text)} `;
    for (const [alias, canonical] of orderedBranchAliases) {
        if (!alias) continue;
        if (normalized.includes(` ${alias} `)) return canonical;
    }
    return null;
}

function extractSection(text = '') {
    const upper = text.toUpperCase();
    // Match A1A, A1B, A1C or combined references
    if (/\bA1[ABC]\b/.test(upper) || /\bA1ABC\b/.test(upper) || /\bSECTION\s*(A1A|A1B|A1C)\b/i.test(text)) {
        return 'A1ABC';
    }
    // Match A1D, A1E, A1F or combined references
    if (/\bA1[DEF]\b/.test(upper) || /\bA1DEF\b/.test(upper) || /\bSECTION\s*(A1D|A1E|A1F)\b/i.test(text)) {
        return 'A1DEF';
    }
    return null;
}

function extractCategoryFilters(text = '') {
    const lower = text.toLowerCase();
    const codes = new Set();

    if (/\b(pc|programme core|program core|core course|core courses)\b/i.test(lower)) {
        codes.add('PC');
    }
    if (/\b(pe|programme elective|program elective)\b/i.test(lower)) {
        codes.add('PE');
    }
    if (/\b(oe|open elective)\b/i.test(lower)) {
        codes.add('OE');
    }
    if (/\b(au|audit course|audit)\b/i.test(lower)) {
        codes.add('AU');
    }
    if (/electives?\s+only|only\s+electives?/i.test(lower)) {
        codes.add('PE');
        codes.add('OE');
    }

    return Array.from(codes);
}

function isGeneralInfoQuery(text = '') {
    return /\b(rules?|ordinances?|attendance|promotion|scholarship|library|admission|eligibility|placement|result|degree requirement|academic session)\b/i
        .test(text);
}

function wantsFullSemesterList(text = '') {
    return /\b(list|show|all)\b.*\bcourses?\b|\bcourse structure\b/i.test(text);
}

function hasCourseCodeQuery(text = '') {
    return /\b[A-Z]{2,4}\d{3,4}\b/.test(String(text).toUpperCase());
}

function normalizeCategoryFilters(categories) {
    const allowed = new Set(['PC', 'PE', 'OE', 'AU', 'BS', 'ESA', 'HM', 'PSI']);
    const normalized = [];
    if (!Array.isArray(categories)) return normalized;

    for (const category of categories) {
        const code = String(category || '').toUpperCase().trim();
        if (allowed.has(code) && !normalized.includes(code)) {
            normalized.push(code);
        }
    }

    return normalized;
}

function normalizeIntent(intent, combinedText) {
    const normalized = String(intent || '').toLowerCase().trim();
    if (['course_list', 'course_detail', 'registration_rule', 'general_info', 'comparison', 'schedule_check'].includes(normalized)) {
        return normalized;
    }
    if (isGeneralInfoQuery(combinedText)) return 'general_info';
    if (wantsFullSemesterList(combinedText)) return 'course_list';
    if (hasCourseCodeQuery(combinedText) || /\b(credits?|ltp|marks?|course code)\b/i.test(combinedText)) {
        return 'course_detail';
    }
    return 'other';
}

function extractFirstJsonObject(text = '') {
    if (!text) return null;

    const fenced = text.match(/```json\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        try {
            return JSON.parse(fenced[1]);
        } catch (_) { }
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;

    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch (_) {
        return null;
    }
}

function parseQueryPlan(question, structuredRewrite) {
    const rewrittenQuery = String(structuredRewrite?.rewritten_query || '').trim() || question;
    const combined = `${question || ''} ${rewrittenQuery}`.trim();

    const rewriteSemester = Number(structuredRewrite?.semester);
    const normalizedSemester = Number.isInteger(rewriteSemester) && rewriteSemester >= 1
        ? rewriteSemester
        : null;

    // Only use categories the user explicitly mentioned in their question;
    // the LLM query planner often hallucinates categories for general queries.
    const categories = extractCategoryFilters(question || '');

    return {
        rewrittenQuery,
        branch: extractBranch(structuredRewrite?.branch || '') || extractBranch(combined),
        semester: normalizedSemester || extractSemester(combined),
        categories,
        section: extractSection(combined),
        intent: normalizeIntent(structuredRewrite?.intent, combined),
        confidence: typeof structuredRewrite?.confidence === 'number'
            ? Math.max(0, Math.min(1, structuredRewrite.confidence))
            : null,
        generalInfo: isGeneralInfoQuery(combined),
        fullSemesterList: wantsFullSemesterList(combined),
    };
}

function buildQueryVariants(question, queryPlan) {
    const variants = new Set();
    const original = String(question || '').trim();
    const rewritten = String(queryPlan.rewrittenQuery || '').trim();

    if (original) variants.add(original);
    if (rewritten) variants.add(rewritten);

    const constraints = [];
    if (queryPlan.branch) constraints.push(queryPlan.branch);
    if (queryPlan.semester) constraints.push(`Semester ${queryPlan.semester}`);
    if (queryPlan.categories.length > 0) constraints.push(queryPlan.categories.join(' '));
    if (constraints.length > 0) {
        variants.add(`${rewritten || original} ${constraints.join(' ')}`.trim());
    }

    if (queryPlan.intent === 'course_list' && queryPlan.branch && queryPlan.semester) {
        variants.add(`${queryPlan.branch} Semester ${queryPlan.semester} full course list with course code credits ltp`);
    }

    if (queryPlan.intent === 'general_info') {
        variants.add(`${original} ordinances rules regulations ZHCET`);
    }

    return Array.from(variants).filter(Boolean).slice(0, 5);
}

function uniqueResultKey(doc) {
    const meta = doc.metadata || {};
    if (meta.type === 'course_group') {
        return `group:${meta.branch}:${meta.semester}`;
    }
    if (meta.type === 'course') {
        return `course:${meta.branch}:${meta.semester}:${meta.course_code}:${meta.course_title}`;
    }
    return `general:${doc.pageContent.slice(0, 120)}`;
}

function metadataPassesHardFilter(meta, queryPlan) {
    if (queryPlan.intent === 'general_info') {
        return meta.type === 'general_info';
    }

    if (queryPlan.branch && meta.branch !== queryPlan.branch) {
        // Semesters 1-2 are shared under "All Branches (First Year)"
        const isFirstYearQuery = queryPlan.semester && queryPlan.semester <= 2;
        if (!(isFirstYearQuery && meta.branch === 'All Branches (First Year)')) return false;
    }
    if (queryPlan.semester && Number(meta.semester) !== queryPlan.semester) return false;

    // Section filter for first-year courses
    if (queryPlan.section && meta.section && meta.section !== queryPlan.section) return false;

    if (queryPlan.categories.length > 0) {
        if (meta.type !== 'course') return false;
        if (!queryPlan.categories.includes(meta.course_category)) return false;
    }

    if ((queryPlan.branch || queryPlan.semester) && meta.type === 'general_info') return false;
    return true;
}

function metadataPassesSoftFilter(meta, queryPlan) {
    if (queryPlan.intent === 'general_info') {
        return meta.type === 'general_info';
    }

    if (queryPlan.branch && meta.branch && meta.branch !== queryPlan.branch) {
        // Semesters 1-2 are shared under "All Branches (First Year)"
        const isFirstYearQuery = queryPlan.semester && queryPlan.semester <= 2;
        if (!(isFirstYearQuery && meta.branch === 'All Branches (First Year)')) return false;
    }
    if (queryPlan.semester && meta.semester && Number(meta.semester) !== queryPlan.semester) return false;
    // Section filter for first-year courses
    if (queryPlan.section && meta.section && meta.section !== queryPlan.section) return false;
    if (queryPlan.categories.length > 0 && meta.type === 'course' && !queryPlan.categories.includes(meta.course_category)) {
        return false;
    }

    return true;
}

async function retrieveVectorCandidates(store, queryVariants, queryPlan) {
    const combined = new Map();

    for (const variant of queryVariants) {
        const results = await store.similaritySearchWithScore(variant, VECTOR_K_PER_QUERY);
        for (let i = 0; i < results.length; i++) {
            const [doc, distance] = results[i];
            const key = uniqueResultKey(doc);
            const existing = combined.get(key);

            if (!existing || distance < existing.distance) {
                combined.set(key, {
                    key,
                    doc,
                    distance,
                    bestRank: i,
                    vectorScore: 0,
                });
            } else {
                existing.bestRank = Math.min(existing.bestRank, i);
            }
        }
    }

    let candidates = Array.from(combined.values());
    const softFiltered = candidates.filter(c => metadataPassesSoftFilter(c.doc.metadata || {}, queryPlan));
    if (softFiltered.length > 0) {
        candidates = softFiltered;
    }

    if (candidates.length === 0) return [];

    const distances = candidates.map(c => c.distance);
    const minDist = Math.min(...distances);
    const maxDist = Math.max(...distances);

    for (const candidate of candidates) {
        const distanceScore = maxDist === minDist ? 1 : 1 - (candidate.distance - minDist) / (maxDist - minDist);
        const rankScore = 1 / (candidate.bestRank + 1);
        candidate.vectorScore = (0.8 * distanceScore) + (0.2 * rankScore);
    }

    return candidates;
}

function retrieveLexicalCandidates(queryVariants, queryPlan) {
    const index = getLexicalIndex();
    const combined = new Map();

    for (const variant of queryVariants) {
        const queryTokens = tokenize(variant);
        if (queryTokens.length === 0) continue;

        const scored = [];
        for (const doc of index.docs) {
            if (!metadataPassesSoftFilter(doc.metadata || {}, queryPlan)) continue;
            const score = bm25Score(queryTokens, doc, index);
            if (score <= 0) continue;
            scored.push({ doc, score });
        }

        scored.sort((a, b) => b.score - a.score);
        for (let i = 0; i < Math.min(scored.length, LEXICAL_K_PER_QUERY); i++) {
            const item = scored[i];
            const existing = combined.get(item.doc.key);
            if (!existing || item.score > existing.rawLexicalScore) {
                combined.set(item.doc.key, {
                    key: item.doc.key,
                    doc: {
                        pageContent: item.doc.pageContent,
                        metadata: item.doc.metadata,
                    },
                    rawLexicalScore: item.score,
                    bestRank: i,
                    lexicalScore: 0,
                });
            } else {
                existing.bestRank = Math.min(existing.bestRank, i);
            }
        }
    }

    const candidates = Array.from(combined.values());
    if (candidates.length === 0) return [];

    const rawScores = candidates.map(c => c.rawLexicalScore);
    const minScore = Math.min(...rawScores);
    const maxScore = Math.max(...rawScores);

    for (const candidate of candidates) {
        const scoreNorm = maxScore === minScore ? 1 : (candidate.rawLexicalScore - minScore) / (maxScore - minScore);
        const rankScore = 1 / (candidate.bestRank + 1);
        candidate.lexicalScore = (0.8 * scoreNorm) + (0.2 * rankScore);
    }

    return candidates;
}

function computeMetadataBonus(meta, queryPlan) {
    let bonus = 0;
    if (queryPlan.branch && meta.branch === queryPlan.branch) bonus += 1;
    if (queryPlan.semester && Number(meta.semester) === queryPlan.semester) bonus += 1;
    if (queryPlan.categories.length > 0 && meta.type === 'course' && queryPlan.categories.includes(meta.course_category)) {
        bonus += 1;
    }
    return Math.min(1, bonus / 3);
}

function computeTypeBonus(meta, queryPlan) {
    if (queryPlan.intent === 'general_info' && meta.type === 'general_info') return 1;
    if (queryPlan.fullSemesterList && meta.type === 'course_group') return 1;
    if (queryPlan.categories.length > 0 && meta.type === 'course') return 1;
    return 0;
}

function mergeAndRerankCandidates(vectorCandidates, lexicalCandidates, queryPlan) {
    const merged = new Map();

    for (const candidate of vectorCandidates) {
        merged.set(candidate.key, {
            key: candidate.key,
            doc: candidate.doc,
            vectorScore: candidate.vectorScore,
            lexicalScore: 0,
        });
    }

    for (const candidate of lexicalCandidates) {
        const existing = merged.get(candidate.key);
        if (existing) {
            existing.lexicalScore = candidate.lexicalScore;
        } else {
            merged.set(candidate.key, {
                key: candidate.key,
                doc: candidate.doc,
                vectorScore: 0,
                lexicalScore: candidate.lexicalScore,
            });
        }
    }

    let candidates = Array.from(merged.values())
        .filter(c => metadataPassesHardFilter(c.doc.metadata || {}, queryPlan));

    if (candidates.length === 0) {
        candidates = Array.from(merged.values())
            .filter(c => metadataPassesSoftFilter(c.doc.metadata || {}, queryPlan));
    }

    for (const candidate of candidates) {
        const meta = candidate.doc.metadata || {};
        const metadataBonus = computeMetadataBonus(meta, queryPlan);
        const typeBonus = computeTypeBonus(meta, queryPlan);
        candidate.rerankScore =
            (0.50 * candidate.vectorScore) +
            (0.35 * candidate.lexicalScore) +
            (0.10 * metadataBonus) +
            (0.05 * typeBonus);
    }

    candidates.sort((a, b) => b.rerankScore - a.rerankScore);

    if (queryPlan.fullSemesterList && queryPlan.branch && queryPlan.semester && queryPlan.categories.length === 0) {
        const exactGroup = candidates.find(c => {
            const meta = c.doc.metadata || {};
            return meta.type === 'course_group'
                && meta.branch === queryPlan.branch
                && Number(meta.semester) === queryPlan.semester;
        });
        if (exactGroup) {
            candidates = [exactGroup, ...candidates.filter(c => c.key !== exactGroup.key)];
        }
    }

    return candidates;
}

async function maybeLlmRerankCandidates(question, queryPlan, candidates) {
    if (!ENABLE_LLM_RERANK || candidates.length < 2) {
        return candidates;
    }

    try {
        const top = candidates.slice(0, Math.min(LLM_RERANK_LIMIT, candidates.length));
        const items = top.map((candidate, index) => {
            const meta = candidate.doc.metadata || {};
            return {
                id: index + 1,
                type: meta.type,
                branch: meta.branch || null,
                semester: meta.semester || null,
                course_code: meta.course_code || null,
                course_title: meta.course_title || null,
                preview: candidate.doc.pageContent.slice(0, 220),
            };
        });

        const response = await groq.chat.completions.create({
            model: MODEL,
            temperature: 0.0,
            max_tokens: 300,
            messages: [
                {
                    role: 'system',
                    content: 'You are a retrieval reranker. Return ONLY JSON object: {"ranked_ids":[...]}.'
                },
                {
                    role: 'user',
                    content: `Question: ${question}\nQuery plan: ${JSON.stringify(queryPlan)}\nCandidates: ${JSON.stringify(items)}`
                }
            ],
        });

        const parsed = extractFirstJsonObject(response.choices[0].message.content || '');
        const rerankerUsage = response.usage || {};
        console.log(`🔢 Reranker tokens — prompt: ${rerankerUsage.prompt_tokens || 0}, completion: ${rerankerUsage.completion_tokens || 0}, total: ${rerankerUsage.total_tokens || 0}`);
        const rankedIds = Array.isArray(parsed?.ranked_ids)
            ? parsed.ranked_ids.map(id => Number(id)).filter(id => Number.isInteger(id))
            : [];

        if (rankedIds.length === 0) return candidates;

        const byId = new Map(top.map((candidate, idx) => [idx + 1, candidate]));
        const rerankedTop = [];
        for (const id of rankedIds) {
            const candidate = byId.get(id);
            if (candidate && !rerankedTop.includes(candidate)) {
                rerankedTop.push(candidate);
            }
        }

        const remainingTop = top.filter(c => !rerankedTop.includes(c));
        return [...rerankedTop, ...remainingTop, ...candidates.slice(top.length)];
    } catch (error) {
        console.error('LLM reranker failed, using deterministic reranking:', error.message);
        return candidates;
    }
}

async function selectRelevantResults(store, question, queryPlan) {
    const queryVariants = buildQueryVariants(question, queryPlan);
    const [vectorCandidates, lexicalCandidates] = await Promise.all([
        retrieveVectorCandidates(store, queryVariants, queryPlan),
        Promise.resolve(retrieveLexicalCandidates(queryVariants, queryPlan)),
    ]);

    let candidates = mergeAndRerankCandidates(vectorCandidates, lexicalCandidates, queryPlan);
    candidates = await maybeLlmRerankCandidates(question, queryPlan, candidates);

    return {
        queryVariants,
        candidates: candidates.slice(0, 16),
        vectorCount: vectorCandidates.length,
        lexicalCount: lexicalCandidates.length,
    };
}

// --- Chat Logic ---
async function transformQuery(currentContext, question) {
    const branchOptions = Object.values(BRANCHES).join(', ');
    const prompt = `You are a state tracker and intent extractor for a university chatbot.
Update the user's context based on their NEW QUESTION.

CURRENT USER CONTEXT:
${JSON.stringify(currentContext, null, 2)}

NEW QUESTION: "${question}"

RULES:
1. If the new question mentions a branch, semester, or section, update the context.
2. If the new question relies on previous context (e.g. "What about semester 6?"), KEEP the old branch but update the semester.
3. categories must be an EMPTY array [] unless the user explicitly asks for a specific course type in the CURRENT question. Do NOT carry over categories from the old context if the user changes the branch or semester.
4. Expand abbreviations (CE/ECE/EE/ME/AI).
5. Output ONLY valid JSON using this schema:
{
  "rewritten_query": "string (the user's question expanded with current context)",
  "intent": "course_list|course_detail|registration_rule|general_info|comparison|schedule_check|other",
  "branch": "string|null (must be one of: ${branchOptions})",
  "semester": "number|null",
  "section": "string|null",
  "categories": ["PC|PE|OE|AU|BS|ESA|HM|PSI"]
}`;

    const response = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.0,
        response_format: { type: "json_object" },
    });
    const stateUsage = response.usage || {};
    console.log(`🔢 State tracker tokens — prompt: ${stateUsage.prompt_tokens || 0}, completion: ${stateUsage.completion_tokens || 0}, total: ${stateUsage.total_tokens || 0}`);

    const raw = response.choices[0].message.content || '';
    const parsed = extractFirstJsonObject(raw);
    if (!parsed) throw new Error('Could not parse state JSON');
    return parsed;
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
    // 1. Get or Create Session with state context
    if (!Sessions.has(sessionId)) {
        Sessions.set(sessionId, {
            context: { branch: null, semester: null, section: null, categories: [], intent: 'other' },
            messages: []
        });
    }
    const sessionData = Sessions.get(sessionId);
    const history = sessionData.messages;
    let currentContext = sessionData.context;

    // 2. Build structured query plan (state-tracking rewrite + intent + metadata)
    let structuredRewrite = {
        rewritten_query: question,
        intent: 'other',
        branch: null,
        semester: null,
        section: null,
        categories: [],
        confidence: null,
    };
    try {
        structuredRewrite = await transformQuery(currentContext, question);
        // Update the active context state
        sessionData.context = {
            branch: structuredRewrite.branch || currentContext.branch,
            semester: structuredRewrite.semester ?? currentContext.semester,
            section: structuredRewrite.section || currentContext.section,
            categories: (structuredRewrite.categories && structuredRewrite.categories.length > 0)
                ? structuredRewrite.categories : currentContext.categories,
            intent: structuredRewrite.intent || currentContext.intent
        };
        currentContext = sessionData.context;
    } catch (error) {
        console.error('State tracking failed, using heuristic fallback:', error.message);
    }
    const queryPlan = parseQueryPlan(question, structuredRewrite);
    console.log('🧭 Query plan:', queryPlan);

    // ==========================================
    // NEW: INVALID SEMESTER VALIDATION
    // ==========================================
    if (queryPlan.semester && queryPlan.semester > 8) {
        console.log(`⚠️ Invalid semester ${queryPlan.semester} requested`);
        const invalidSemText = `B.Tech programs at ZHCET have **8 semesters** (Semester 1 through Semester 8). Semester ${queryPlan.semester} does not exist. 😊\n\nWould you like to explore one of the valid semesters?\n\n<<OPTIONS: Semester 1 | Semester 2 | Semester 3 | Semester 4 | Semester 5 | Semester 6 | Semester 7 | Semester 8>>`;
        const { cleanText, options } = parseOptions(invalidSemText);

        history.push({ role: 'user', content: question });
        history.push({ role: 'assistant', content: cleanText });
        Sessions.delete(sessionId);
        Sessions.set(sessionId, sessionData);
        saveSessions();

        return { text: cleanText, options };
    }

    // ==========================================
    // NEW: FIRST-YEAR SECTION CLARIFICATION
    // ==========================================
    if (queryPlan.semester && queryPlan.semester <= 2 && !queryPlan.section) {
        // Check chat history for section mentions
        const historyText = history.map(m => m.content).join(' ');
        const historySection = extractSection(historyText);
        if (historySection) {
            queryPlan.section = historySection;
        } else {
            console.log('🏫 First-year query without section — asking for clarification');
            const sectionText = `For **Semester ${queryPlan.semester}**, the course structure differs based on your section. 📋\n\nPlease select your section group so I can show you the correct courses:\n\n- **Sections A1A, A1B, A1C** — one set of courses\n- **Sections A1D, A1E, A1F** — a different set (swapped between semesters)\n\n<<OPTIONS: Section A1A/A1B/A1C | Section A1D/A1E/A1F>>`;
            const { cleanText, options } = parseOptions(sectionText);

            history.push({ role: 'user', content: question });
            history.push({ role: 'assistant', content: cleanText });
            Sessions.delete(sessionId);
            Sessions.set(sessionId, sessionData);
            saveSessions();

            return { text: cleanText, options };
        }
    }

    // NEW: REGISTRATION RULES ROUTER
    // ==========================================
    if (queryPlan.intent === 'registration_rule') {
        console.log('📚 Routing to hardcoded Registration Rules logic');

        // Define the highly constrained registration assistant prompt
        const regMessages = [
            {
                role: 'system',
                content: `You are the **ZHCET Course Registration Assistant** 🎓. Your primary job is to help students navigate the official academic ordinances and registration rules.

### STRICT OPERATING RULES (NON-NEGOTIABLE):
1. **ONLY Use the Provided JSON Rules:** You must base your answers strictly on the \`ZHCET_REGISTRATION_RULES\` provided below. 
2. **Never Guess or Hallucinate:** Do not invent policies, deadlines, or credit limits. If the answer is not in the JSON rules, say: "I don't have the official policy on that specific scenario. Please consult the Dean's Office."
3. **Always Verify Intent:** Registration is complex. If a user asks a general question like "How do I register?", you MUST ask them to clarify their situation before answering.

### INTERACTIVE CLARIFICATION FLOW:
If the user's situation is ambiguous, do not answer immediately. Instead, reply with a short clarifying question and use the exact \`<<OPTIONS: ...>>\` format to guide them.
Example: "Are you registering for a regular semester, or repeating a backlog?" <<OPTIONS: Regular Semester | Repeating Backlog | Improving Grade>>

### ATTENDANCE DECISION TREE (follow EXACTLY for attendance queries):
When a student provides their attendance percentage, compare it step by step:
1. If attendance **>= 75%** → Student meets the requirement. No issue.
2. If attendance **>= 65% AND < 75%** → This is the **condonation range**. Student may apply for condonation.
3. If attendance **< 65%** → Student is **detained** and awarded grade 'F'.
⚠️ CRITICAL: Double-check your numerical comparison. 68% is >= 65%, so it falls in condonation range, NOT detained.

### OUTPUT FORMATTING:
- Be concise, professional, and empathetic. 
- Use bullet points for multiple conditions.
- Highlight important conditions (like max limits or minimum CGPA) in **bold**.

### CONTEXT (ZHCET_REGISTRATION_RULES):
${JSON.stringify(REGISTRATION_RULES, null, 2)}`
            },
            ...history.slice(-MAX_HISTORY_MESSAGES),
            { role: 'user', content: question }
        ];

        const regResponse = await groq.chat.completions.create({
            model: MODEL,
            messages: regMessages,
            temperature: 0.0,
            max_tokens: 1024,
        });
        const regUsage = regResponse.usage || {};
        console.log(`🔢 Registration tokens — prompt: ${regUsage.prompt_tokens || 0}, completion: ${regUsage.completion_tokens || 0}, total: ${regUsage.total_tokens || 0}`);

        const rawMessage = regResponse.choices[0].message.content;
        const { cleanText, options } = parseOptions(rawMessage);

        history.push({ role: 'user', content: question });
        history.push({ role: 'assistant', content: cleanText });
        Sessions.delete(sessionId);
        Sessions.set(sessionId, sessionData);
        saveSessions();

        return { text: cleanText, options };
    }
    // ==========================================
    // If NOT a registration query, proceed with the existing hybrid retrieval code below...

    // 3. Hybrid retrieval (vector + lexical) + reranking
    const store = await getVectorStore();
    const retrieval = await selectRelevantResults(store, question, queryPlan);
    const relevantResults = retrieval.candidates;
    console.log(
        `📊 Hybrid retrieval: ${relevantResults.length} selected (vector=${retrieval.vectorCount}, lexical=${retrieval.lexicalCount}, variants=${retrieval.queryVariants.length})`
    );

    // 4. Format context with clear delimiters for better LLM parsing
    const contextChunks = [];
    let contextLength = 0;
    for (const candidate of relevantResults) {
        const doc = candidate.doc;
        const meta = doc.metadata || {};
        if (queryPlan.categories.length > 0 && meta.type === 'course_group') {
            continue;
        }
        let chunk;
        if (meta.type === 'course_group') {
            chunk = `=== SEMESTER COURSE GROUP ===\nBranch: ${meta.branch}\nSemester: ${meta.semester}\nTotal Courses: ${meta.course_count}\n\n${doc.pageContent}\n=== END GROUP ===`;
        } else if (meta.type === 'course') {
            chunk = `=== INDIVIDUAL COURSE ===\nBranch: ${meta.branch}\nSemester: ${meta.semester}\nCode: ${meta.course_code}\nTitle: ${meta.course_title}\nCategory: ${meta.course_category_full} (${meta.course_category})\nCredits: ${meta.credits}\nContact Periods (LTP): ${meta.contact_periods}\nMarks: ${meta.marks}\n=== END COURSE ===`;
        } else {
            chunk = `=== GENERAL INFORMATION ===\n${doc.pageContent}\n=== END INFO ===`;
        }

        if (contextLength + chunk.length > MAX_CONTEXT_CHARS && contextChunks.length > 0) {
            break;
        }
        contextChunks.push(chunk);
        contextLength += chunk.length;
    }

    const context = contextChunks.join("\n\n");

    // Fetch dynamic timetable if it exists and user intent matches
    const activeTimetable = TimetableManager.getActiveTimetable();
    let timetableInjection = "";

    if (activeTimetable && (queryPlan.intent === 'schedule_check' || question.toLowerCase().includes('time') || question.toLowerCase().includes('clash') || question.toLowerCase().includes('schedule'))) {
        timetableInjection = `\n### ACTIVE SEMESTER TIMETABLE (PRIORITIZE THIS):\n${JSON.stringify(activeTimetable, null, 2)}\n\n*INSTRUCTION: Use the above timetable to answer scheduling questions. If a user asks if two courses clash, check if their days and start/end times overlap.*\n`;
    }

    // 5. Generate Response — inject currentContext instead of full message history
    const messages = [
        {
            role: 'system',
            content: `You are **ZHCET Buddy** 🎓, a highly accurate academic advisor for **Zakir Husain College of Engineering & Technology (ZHCET), Aligarh Muslim University**.

CURRENT USER STATE:
${JSON.stringify(currentContext, null, 2)}
${timetableInjection}
### STRICT ACCURACY RULES & MISSING DATA GUARDRAIL (NON-NEGOTIABLE):
1. **Source Dependency:** Use ONLY the retrieved context below to answer. Do not rely on prior knowledge. NEVER fabricate or hallucinate course codes, names, or credits.
2. **Complete Context:** Include ALL courses from the retrieved context for the requested branch/semester.
3. **Missing Category (CRITICAL):** If the user asks for a specific category (e.g., "Programme Electives", "Open Electives", "PE", "OE") BUT the retrieved context does not explicitly list any courses matching that category, YOU MUST reply EXACTLY with: "There are no [Category Name] courses offered for this specific branch and semester." Do not include partial matches or audit courses.
4. **General Missing Data:** If no specific category was requested, but you still cannot answer the query using the context, reply EXACTLY with: "I cannot find this exact information in the official curriculum."
5. **Count Discrepancy:** NEVER say "there are only X courses" unless the context explicitly confirms the total count.

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
        ...history.slice(-2),
        { role: 'user', content: question }
    ];

    const response = await groq.chat.completions.create({
        model: MODEL,
        messages: messages,
        temperature: 0.0,
        max_tokens: 2048,
    });
    const responseUsage = response.usage || {};
    console.log(`🔢 Response tokens — prompt: ${responseUsage.prompt_tokens || 0}, completion: ${responseUsage.completion_tokens || 0}, total: ${responseUsage.total_tokens || 0}`);

    const rawMessage = response.choices[0].message.content;
    const { cleanText, options } = parseOptions(rawMessage);

    // 6. Update History with ORIGINAL user message (not rewritten)
    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: cleanText });
    // Refresh insertion order so session list reflects most recently active chats.
    Sessions.delete(sessionId);
    Sessions.set(sessionId, sessionData);
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
        const finalSessionId = safeSessionId || `session_${Date.now()}`;

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
