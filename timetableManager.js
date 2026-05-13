import fs from 'fs';
import Groq from 'groq-sdk';

const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
// Lazy Groq client — only instantiated on first use so that dotenv.config()
// in server.js has already populated process.env before this runs.
// (ESM static imports are hoisted and execute before any top-level statements,
//  so a top-level `new Groq()` would fire before dotenv is ready.)
let _groq = null;
function getGroq() {
    if (!_groq) {
        if (!process.env.GROQ_API_KEY) {
            throw new Error('GROQ_API_KEY is not set. Check your .env file.');
        }
        _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return _groq;
}

const TIMETABLE_FILE = './knowledge_base/active_timetable.json';
const TIMETABLE_FILE_TMP = './knowledge_base/active_timetable.json.tmp';
const COURSES_JSON = './knowledge_base/zhcet_courses.json';
const COURSES_JSON_TMP = './knowledge_base/zhcet_courses.json.tmp';

// Cache courses DB in memory so we don't re-read the file on every call
let _coursesDbCache = null;
function getCoursesDb() {
    if (_coursesDbCache) return _coursesDbCache;
    if (fs.existsSync(COURSES_JSON)) {
        try {
            _coursesDbCache = JSON.parse(fs.readFileSync(COURSES_JSON, 'utf8'));
        } catch (e) {
            console.error("Error loading zhcet_courses.json:", e);
            _coursesDbCache = [];
        }
    } else {
        _coursesDbCache = [];
    }
    return _coursesDbCache;
}

/** Invalidate the in-memory courses cache so the next read picks up disk changes. */
function invalidateCoursesCache() {
    _coursesDbCache = null;
}

/**
 * Normalize a branch name for fuzzy matching:
 * strips leading/trailing whitespace, uppercases, and collapses inner spaces.
 * E.g. "Computer Engineering" → "COMPUTER ENGINEERING"
 */
function normalizeBranch(name) {
    return (name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Atomically write the courses JSON to disk and invalidate the cache.
 */
function saveCoursesAtomically(coursesArray) {
    const payload = JSON.stringify(coursesArray, null, 2);
    fs.writeFileSync(COURSES_JSON_TMP, payload, 'utf8');
    const writtenBytes = fs.statSync(COURSES_JSON_TMP).size;
    const expectedBytes = Buffer.byteLength(payload, 'utf8');
    if (writtenBytes !== expectedBytes) {
        fs.unlinkSync(COURSES_JSON_TMP);
        throw new Error(
            `[PE Sync] Atomic write integrity check failed: ` +
            `expected ${expectedBytes} bytes, got ${writtenBytes}.`
        );
    }
    fs.renameSync(COURSES_JSON_TMP, COURSES_JSON);
    invalidateCoursesCache();
    console.log(`   ✅ zhcet_courses.json updated atomically.`);
}

/**
 * Dynamic categories whose course codes are NOT fixed in the curriculum and
 * must be resolved from the active timetable each semester.
 * These are treated as "PE-like" slots that can be populated.
 */
const DYNAMIC_CATEGORIES = new Set(['PE', 'OE', 'AU', 'HM']);

/**
 * Scan a timetable's entries and fill null-code PE / OE / HM / AU placeholders
 * in zhcet_courses.json for the matching branch+semester.
 *
 * Strategy:
 *  1. Collect all course codes present in the timetable entries.
 *  2. Find which of those codes are already known (non-null) in zhcet_courses.json.
 *  3. The remaining "unknown" codes are elective/dynamic courses.
 *  4. For each dynamic placeholder (null course_code) in zhcet_courses.json that
 *     matches the timetable's branch+semester, assign the next unknown code in
 *     the category order (PE first, then OE, HM, AU), and stamp source_timetable_id.
 *  5. Update searchable_text to include the real code and title.
 *
 * @param {object} timetable - The saved timetable object (with id, branch, semester, entries)
 */
function syncPECoursesFromTimetable(timetable) {
    console.log(`🔗 [PE Sync] Syncing dynamic courses from timetable "${timetable.id}" (${timetable.branch} Sem ${timetable.semester})...`);

    const courses = getCoursesDb();
    const semNum = parseInt(timetable.semester, 10);
    const normTimetableBranch = normalizeBranch(timetable.branch);

    // ── Step 1: Collect unique course codes from timetable entries ────────────
    const timetableCodes = new Set(
        (timetable.entries || [])
            .map(e => (e.course_code || '').trim())
            .filter(c => c.length > 0)
    );

    if (timetableCodes.size === 0) {
        console.log('   ⚠️  No course codes in timetable entries — skipping PE sync.');
        return;
    }

    // ── Step 2: Identify which codes are already static in courses.json ───────
    // A code is "static" if it exists with a non-null course_code in any entry.
    const staticCodes = new Set(
        courses
            .filter(c => c.course_code !== null && c.course_code !== undefined)
            .map(c => c.course_code)
    );

    // ── Step 3: Unknown codes = timetable codes not in the static set ─────────
    // These are the elective/dynamic courses picked for this semester.
    const unknownCodes = [...timetableCodes].filter(code => !staticCodes.has(code));

    if (unknownCodes.length === 0) {
        console.log('   ℹ️  All timetable course codes are already in the static curriculum — no PE placeholders to fill.');
        return;
    }
    console.log(`   🎯 Dynamic (elective) codes found in timetable: [${unknownCodes.join(', ')}]`);

    // Build a lookup: code → { title, professor } from first timetable entry for that code
    const codeInfo = {};
    for (const entry of (timetable.entries || [])) {
        const code = (entry.course_code || '').trim();
        if (!code || staticCodes.has(code)) continue;
        if (!codeInfo[code]) {
            codeInfo[code] = {
                title: (entry.course_title || '').trim() || null,
            };
        }
    }

    // ── Step 4: Match branch in courses.json ─────────────────────────────────
    // Find the canonical branch name stored in courses.json that fuzzy-matches
    // the timetable branch (e.g. "Computer Engineering" → "COMPUTER ENGINEERING").
    const matchingBranchName = [...new Set(courses.map(c => c.branch))]
        .find(b => normalizeBranch(b) === normTimetableBranch);

    if (!matchingBranchName) {
        console.log(`   ⚠️  Branch "${timetable.branch}" not found in zhcet_courses.json — skipping PE sync.`);
        return;
    }

    // ── Step 5: Find null-code dynamic placeholders for this branch+semester ──
    const placeholders = courses.filter(c =>
        c.branch === matchingBranchName &&
        parseInt(c.semester, 10) === semNum &&
        c.course_code === null &&
        DYNAMIC_CATEGORIES.has(c.course_category)
    );

    if (placeholders.length === 0) {
        console.log(`   ℹ️  No null-code dynamic placeholders found for ${matchingBranchName} Sem ${semNum}.`);
        return;
    }

    // Sort placeholders: PE first, then OE, HM, AU — to fill most-specific first.
    const categoryOrder = ['PE', 'OE', 'HM', 'AU'];
    placeholders.sort((a, b) => {
        const ai = categoryOrder.indexOf(a.course_category);
        const bi = categoryOrder.indexOf(b.course_category);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    // Assign unknown codes to placeholders round-robin
    let assignedCount = 0;
    const codeQueue = [...unknownCodes];

    for (const placeholder of placeholders) {
        // Skip placeholders already linked to another timetable
        if (placeholder.source_timetable_id && placeholder.source_timetable_id !== timetable.id) continue;
        // Skip if already filled by this timetable
        if (placeholder.source_timetable_id === timetable.id && placeholder.course_code !== null) continue;

        if (codeQueue.length === 0) break;

        const code = codeQueue.shift();
        const info = codeInfo[code] || {};
        const realTitle = info.title || placeholder.course_title; // keep generic title if no real one

        placeholder.course_code = code;
        if (info.title) placeholder.course_title = info.title;
        placeholder.source_timetable_id = timetable.id;
        // Update searchable_text
        placeholder.searchable_text =
            `In ${placeholder.program} ${placeholder.branch}, Semester ${placeholder.semester}, ` +
            `students take the course ${code}: ${placeholder.course_title}. ` +
            `This is a ${placeholder.course_category_full} (${placeholder.course_category}) ` +
            `category course worth ${placeholder.credits} credits.`;

        console.log(`   ✅ Filled placeholder "${placeholder.course_title}" ← ${code}`);
        assignedCount++;
    }

    if (assignedCount > 0) {
        saveCoursesAtomically(courses);
        console.log(`🔗 [PE Sync] ${assignedCount} dynamic course(s) linked from timetable "${timetable.id}".`);
    } else {
        console.log('   ℹ️  No placeholders were updated (all may already be filled or no matching category).');
    }
}

/**
 * Revert all courses in zhcet_courses.json that were filled by a specific
 * timetable back to their null/generic-placeholder state.
 *
 * @param {string} timetableId - The id of the timetable being deleted.
 * @param {object} [timetableMeta] - Optional { branch, semester } to scope the revert.
 */
function revertPECoursesForTimetable(timetableId, timetableMeta = {}) {
    console.log(`🧹 [PE Revert] Reverting dynamic courses linked to timetable "${timetableId}"...`);

    const courses = getCoursesDb();
    const linked = courses.filter(c => c.source_timetable_id === timetableId);

    if (linked.length === 0) {
        console.log('   ℹ️  No dynamic courses were linked to this timetable — nothing to revert.');
        return;
    }

    for (const course of linked) {
        console.log(`   ↩️  Reverting "${course.course_title}" (${course.course_code}) back to null`);
        course.course_code = null;
        delete course.source_timetable_id;
        // Restore contact_periods to null if it was null before (they always are for PE/OE)
        if (!course.contact_periods || course.contact_periods === 'null') {
            course.contact_periods = null;
        }
        // Restore searchable_text to generic form
        course.searchable_text =
            `In ${course.program} ${course.branch}, Semester ${course.semester}, ` +
            `students take the course ${course.course_title}. ` +
            `This is a ${course.course_category_full} (${course.course_category}) ` +
            `category course worth ${course.credits} credits.`;
    }

    saveCoursesAtomically(courses);
    console.log(`🧹 [PE Revert] ${linked.length} dynamic course(s) reverted for timetable "${timetableId}".`);
}

/**
 * Strip group/section suffixes from course codes.
 * E.g. "COC2922 G1" → "COC2922", "ELA2902 G2" → "ELA2902"
 */
function stripCodeSuffix(code) {
    return (code || '').replace(/\s+(G\d+|SEC\s*\w+)$/i, '').trim();
}

/**
 * Extract group suffix from a course code and return { code, group }.
 * E.g. "COC2922 G1" → { code: "COC2922", group: "G1" }
 *      "COC2922"    → { code: "COC2922", group: "" }
 */
function extractGroup(rawCode) {
    const match = (rawCode || '').match(/^(.+?)\s+(G\d+|GROUP\s*\d+|-\d+|SEC\s*\w+)$/i);
    if (match) {
        return { code: match[1].trim(), group: match[2].trim() };
    }
    return { code: (rawCode || '').trim(), group: '' };
}

/**
 * Auto-fill missing course_title fields in entries using zhcet_courses.json.
 * Also normalizes course_code by stripping group suffix into a separate `group` field.
 */
function autoFillCourseTitles(entries) {
    const coursesDb = getCoursesDb();

    return entries.map(entry => {
        // Extract group suffix if not already split out
        if (entry.course_code && entry.group === undefined) {
            const { code, group } = extractGroup(entry.course_code);
            if (group) {
                entry.course_code = code;
                entry.group = group;
            } else {
                entry.group = '';
            }
        }

        // Auto-fill missing course title
        if (coursesDb.length > 0 && entry.course_code && (!entry.course_title || entry.course_title.trim() === '')) {
            const rawCode = entry.course_code.trim();
            const strippedCode = stripCodeSuffix(rawCode);
            const found = coursesDb.find(c => c.course_code === rawCode) ||
                coursesDb.find(c => c.course_code === strippedCode);
            if (found && found.course_title) {
                entry.course_title = found.course_title;
            }
        }
        return entry;
    });
}

/**
 * Standard ZHCET period boundaries in minutes from midnight.
 * All days use the same 50-minute periods.
 */
const STANDARD_BOUNDARIES = [
    480,  // 08:00 AM
    530,  // 08:50 AM
    580,  // 09:40 AM
    630,  // 10:30 AM
    680,  // 11:20 AM
    730,  // 12:10 PM
    780,  // 01:00 PM (lunch start)
    840,  // 02:00 PM (lab start)
    990,  // 04:30 PM (lab end)
    1020, // 05:00 PM (extended lab end)
];

function parseTimeToMinutes(timeStr) {
    const match = (timeStr || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + m;
}

function minutesToTimeStr(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function snapToNearest(mins) {
    let closest = STANDARD_BOUNDARIES[0];
    let minDiff = Math.abs(mins - closest);
    for (const b of STANDARD_BOUNDARIES) {
        const diff = Math.abs(mins - b);
        if (diff < minDiff) {
            minDiff = diff;
            closest = b;
        }
    }
    return closest;
}

/**
 * Post-process entries to snap start/end times to standard period boundaries.
 * Only snaps if the time is within 15 minutes of a standard boundary.
 */
function snapTimesToStandardSlots(entries) {
    const SNAP_THRESHOLD = 15; // minutes
    return entries.map(entry => {
        const startMins = parseTimeToMinutes(entry.start_time);
        const endMins = parseTimeToMinutes(entry.end_time);
        if (startMins === null || endMins === null) return entry;

        const snappedStart = snapToNearest(startMins);
        const snappedEnd = snapToNearest(endMins);

        // Only snap if the difference is within the threshold
        if (Math.abs(startMins - snappedStart) <= SNAP_THRESHOLD) {
            entry.start_time = minutesToTimeStr(snappedStart);
        }
        if (Math.abs(endMins - snappedEnd) <= SNAP_THRESHOLD) {
            entry.end_time = minutesToTimeStr(snappedEnd);
        }
        return entry;
    });
}

// ── Reusable timetable extraction prompt ──────────────────────────────────────
const TIMETABLE_PROMPT = `You are an expert data extractor for ZHCET (Zakir Husain College of Engineering & Technology) university timetables.
Extract the class schedule into a structured JSON object.
OUTPUT ONLY VALID JSON. Do not include markdown formatting like \`\`\`json.

IMPORTANT EXTRACTION RULES:

1. TIME SLOTS — Extract the start and end time for each class EXACTLY as shown in the uploaded timetable. Do NOT invent or assume times.
   If the timetable uses period numbers instead of exact times, use these standard ZHCET 50-minute period boundaries as reference:
     Period 1: 08:00 AM – 08:50 AM
     Period 2: 08:50 AM – 09:40 AM
     Period 3: 09:40 AM – 10:30 AM
     Period 4: 10:30 AM – 11:20 AM
     Period 5: 11:20 AM – 12:10 PM
     Period 6: 12:10 PM – 01:00 PM
     Lunch:    01:00 PM – 02:00 PM
     Lab Slot: 02:00 PM – 04:30 PM (or 02:00 PM – 05:00 PM)
   These apply to ALL days (Monday through Saturday). Only use these if the timetable doesn't show explicit times.

2. PROFESSOR: Extract the teacher/professor/instructor name for EACH class entry. Look for names prefixed with Dr., Prof., Mr., Mrs., etc. If no professor is listed for a particular slot, use an empty string.

3. COURSE TITLE: Extract the full course name. If only a course code is visible with no title, use an empty string.

4. GROUPS: If lab entries show group identifiers (G1, G2, Group 1, Group 2, -1, -2), include them as part of the course_code (e.g. "COC2922 G1"). Multiple labs at the same time with different groups should be separate entries.

5. Each row of the timetable is a day. Each column is a period. Extract ALL entries for ALL days visible in the timetable.

The JSON object must have this shape:
{
    "extracted_course": "string — e.g. B.Tech, M.Tech, BE, empty if not found",
    "extracted_branch": "string — e.g. Civil Engineering, CE, CSE, empty if not found",
    "extracted_semester": "string — e.g. 5, V, 1, 3, empty if not found",
    "extracted_year": "string — e.g. 2, 3, 4, 1, empty if not found",
    "semester_parity": "string — e.g. Odd, Even, empty if not found",
    "entries": [
        {
            "course_code": "string (e.g., COC4012 or COC2922 G1)",
            "course_title": "string",
            "professor": "string",
            "day": "string (e.g., Monday)",
            "start_time": "string (e.g., 08:50 AM) — use 12-hour format with AM/PM",
            "end_time": "string (e.g., 09:40 AM) — use 12-hour format with AM/PM",
            "room": "string",
            "type": "string (Lecture, Lab, Tutorial)"
        }
    ]
}`;

// ── Decomposed pipeline steps ─────────────────────────────────────────────────

/**
 * Step 1 — Read the local file and convert to base64 for Groq Vision.
 * Logic Gate: verifies the file exists and is non-empty before returning.
 */
async function step1_readFileAsBase64(filePath, mimeType) {
    console.log("📤 [Step 1] Reading timetable file for Groq Vision...");
    if (!fs.existsSync(filePath)) {
        throw new Error(`[Step 1] File not found: ${filePath}`);
    }
    const fileBuffer = fs.readFileSync(filePath);
    if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error('[Step 1] Uploaded file is empty. Cannot proceed.');
    }
    const base64Data = fileBuffer.toString('base64');
    console.log(`   ✅ File read OK — ${(fileBuffer.length / 1024).toFixed(1)} KB`);
    return { base64Data, mimeType: mimeType || 'image/jpeg' };
}

/**
 * Step 2 — Send the image to Groq Vision for structured JSON extraction.
 * Self-Healing: if the first response isn't valid JSON, a second attempt is
 * made with the parse error injected into the prompt for self-correction.
 */
async function step2_extractTimetableJson(base64Data, mimeType) {
    console.log("🧠 [Step 2] Extracting timetable data with Groq Vision...");

    const attemptExtract = async (extraInstruction = '') => {
        const promptText = TIMETABLE_PROMPT +
            (extraInstruction ? `\n\nCORRECTION REQUIRED: ${extraInstruction}` : '');

        const result = await getGroq().chat.completions.create({
            model: GROQ_VISION_MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: promptText },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${base64Data}`
                            }
                        }
                    ]
                }
            ],
            temperature: 0,
            max_tokens: 4096
        });

        const raw = (result.choices[0]?.message?.content || '').trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
        return { raw, parsed: JSON.parse(raw) }; // throws if not valid JSON
    };

    // First attempt
    let firstErr;
    try {
        const { parsed } = await attemptExtract();
        console.log('   ✅ JSON extraction OK on first attempt.');
        return parsed;
    } catch (err) {
        firstErr = err;
        console.warn(`[Self-Heal] [Step 2] First Groq response was not valid JSON: ${err.message}`);
    }

    // Second attempt — feed the parse error back to the model
    console.log('[Self-Heal] [Step 2] Retrying with error-augmented correction prompt...');
    try {
        const { parsed } = await attemptExtract(
            `Your previous response could not be parsed as JSON. ` +
            `Error: "${firstErr?.message ?? 'JSON parse error'}". ` +
            `Output ONLY the valid JSON object — no prose, no markdown fences, no extra text.`
        );
        console.log('   ✅ JSON extraction OK on second attempt.');
        return parsed;
    } catch (secondErr) {
        throw new Error(
            `[Step 2] Could not parse timetable document after two attempts. ` +
            `Last error: ${secondErr.message}`
        );
    }
}

/**
 * Step 3 — Resolve final metadata (branch, semester, course) from the extracted
 * data and any admin-supplied fallbacks.
 * Logic Gate: requires at least one entry to be present.
 */
function step3_resolveMetadata(parsed, fallbackCourse, fallbackBranch, fallbackSemester) {
    console.log('📋 [Step 3] Resolving timetable metadata...');

    let entries, extractedCourse, extractedBranch, extractedSemester, extractedYear, semesterParity;

    if (Array.isArray(parsed)) {
        entries = parsed;
        extractedCourse = ''; extractedBranch = ''; extractedSemester = '';
        extractedYear = ''; semesterParity = '';
    } else {
        entries = parsed.entries || [];
        extractedCourse = parsed.extracted_course || '';
        extractedBranch = parsed.extracted_branch || parsed.extracted_name || '';
        extractedSemester = parsed.extracted_semester || '';
        extractedYear = parsed.extracted_year || '';
        semesterParity = parsed.semester_parity || '';
    }

    // ── Logic Gate: must have at least one entry ─────────────────────────────
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('[Step 3] No timetable entries found in extracted data. Check the uploaded file.');
    }

    // Smart semester resolution
    let finalSemesterNum = extractedSemester.trim();
    if (!finalSemesterNum && extractedYear && semesterParity) {
        const yrMatch = extractedYear.match(/\d+/);
        if (yrMatch) {
            const yr = parseInt(yrMatch[0], 10);
            const isEven = semesterParity.toLowerCase().includes('even');
            if (yr > 0) finalSemesterNum = ((yr - 1) * 2 + (isEven ? 2 : 1)).toString();
        }
    }

    const result = {
        finalCourse: fallbackCourse || extractedCourse || '',
        finalBranch: fallbackBranch || extractedBranch || 'Untitled Timetable',
        finalSemester: fallbackSemester || finalSemesterNum || '',
        entries,
    };
    console.log(`   ✅ Branch: "${result.finalBranch}" | Semester: "${result.finalSemester}" | ${entries.length} raw entries`);
    return result;
}

/**
 * Step 4 — Enrich entries: auto-fill missing course titles and snap times to
 * standard ZHCET period boundaries.
 */
function step4_enrichEntries(entries) {
    console.log('✨ [Step 4] Enriching entries (title fill + time snap)...');
    const enriched = snapTimesToStandardSlots(autoFillCourseTitles(entries));
    console.log(`   ✅ ${enriched.length} entries enriched.`);
    return enriched;
}

/**
 * Step 5 — Save the updated timetable list atomically.
 * Strict Write: writes to a .tmp file, verifies integrity, then renames.
 * Logic Gate: refuses to proceed if the written byte count doesn't match.
 */
function step5_saveAtomically(allTimetables) {
    console.log('💾 [Step 5] Saving timetable atomically...');
    const payload = JSON.stringify(allTimetables, null, 2);

    fs.writeFileSync(TIMETABLE_FILE_TMP, payload, 'utf8');

    // ── Integrity check ───────────────────────────────────────────────────────
    const writtenBytes = fs.statSync(TIMETABLE_FILE_TMP).size;
    const expectedBytes = Buffer.byteLength(payload, 'utf8');
    if (writtenBytes !== expectedBytes) {
        fs.unlinkSync(TIMETABLE_FILE_TMP);
        throw new Error(
            `[Step 5] Atomic write integrity check failed: ` +
            `expected ${expectedBytes} bytes, got ${writtenBytes}.`
        );
    }

    // Rename is atomic on POSIX (Linux/macOS)
    fs.renameSync(TIMETABLE_FILE_TMP, TIMETABLE_FILE);
    console.log(`   ✅ Timetable saved to ${TIMETABLE_FILE}.`);
}

// ── TimetableManager (public API) ─────────────────────────────────────────────
export const TimetableManager = {
    /**
     * Main orchestration pipeline — thin wrapper that chains the 5 steps.
     * Source files are only cleaned up after a confirmed atomic save.
     */
    async processAndSaveTimetable(filePath, mimeType, fallbackCourse = '', fallbackBranch = '', fallbackSemester = '') {
        try {
            // Step 1 — Read file as base64 (replaces Gemini File API upload)
            const { base64Data, mimeType: resolvedMime } = await step1_readFileAsBase64(filePath, mimeType);

            // Step 2 — Extract JSON via Groq Vision (with self-healing retry)
            const parsed = await step2_extractTimetableJson(base64Data, resolvedMime);

            // Step 3 — Resolve metadata (with logic gate)
            const { entries, finalCourse, finalBranch, finalSemester } =
                step3_resolveMetadata(parsed, fallbackCourse, fallbackBranch, fallbackSemester);

            // Step 4 — Enrich
            const enrichedEntries = step4_enrichEntries(entries);

            // Step 5 — Atomic save (with integrity check)
            const allTimetables = this.getAllTimetables();
            const newTimetable = {
                id: Date.now().toString(36),
                course: finalCourse,
                branch: finalBranch,
                semester: finalSemester,
                entries: enrichedEntries,
                uploadedAt: new Date().toISOString(),
            };
            allTimetables.push(newTimetable);
            step5_saveAtomically(allTimetables);

            // ── Step 6 — Sync dynamic (PE/OE/HM/AU) courses from this timetable ──
            // Non-fatal: a failure here must not undo the timetable save.
            try {
                syncPECoursesFromTimetable(newTimetable);
            } catch (syncErr) {
                console.error(`⚠️  [PE Sync] Non-fatal: failed to sync dynamic courses: ${syncErr.message}`);
            }

            // ── Clean up local temp file AFTER confirmed save ──────────────────────
            console.log('🧹 [Cleanup] Removing temp files after confirmed save...');
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

            console.log(`✅ Timetable "${finalBranch}" pipeline complete (${enrichedEntries.length} entries).`);
            return newTimetable;

        } catch (error) {
            console.error(`❌ Timetable pipeline failed: ${error.message}`);
            // Clean up the local upload on any error
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            if (fs.existsSync(TIMETABLE_FILE_TMP)) fs.unlinkSync(TIMETABLE_FILE_TMP);
            throw error; // surface the step-specific error message
        }
    },

    getAllTimetables() {
        if (fs.existsSync(TIMETABLE_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(TIMETABLE_FILE, 'utf8'));
                // Migrate: if it's a flat array of entries (old format), wrap it
                if (Array.isArray(data) && data.length > 0 && data[0].course_code) {
                    return [{ id: 'migrated', course: '', branch: 'Imported Timetable', semester: '', entries: data, uploadedAt: new Date().toISOString() }];
                }
                return Array.isArray(data) ? data.map(t => {
                    if (t.name !== undefined && t.course === undefined && t.branch === undefined && t.semester === undefined) {
                        t.branch = t.name;
                        t.course = '';
                        t.semester = '';
                        delete t.name;
                    }
                    // Auto-fill course titles on read for any entries still missing them
                    if (t.entries) {
                        t.entries = autoFillCourseTitles(t.entries);
                        t.entries = snapTimesToStandardSlots(t.entries);
                    }
                    return t;
                }) : [];
            } catch (e) {
                console.error('[TimetableManager] Failed to parse knowledge_base/active_timetable.json:', e.message);
                return [];
            }
        }
        return [];
    },

    getActiveTimetable({ branch, semester } = {}) {
        const all = this.getAllTimetables();
        if (all.length === 0) return null;

        const toSummary = t => ({
            course: t.course, branch: t.branch,
            semester: t.semester, entries: t.entries
        });

        // If filters provided, narrow down
        if (branch || semester) {
            const filtered = all.filter(t => {
                const branchMatch = !branch || t.branch?.toLowerCase().includes(branch.toLowerCase());
                const semMatch = !semester || String(t.semester) === String(semester);
                return branchMatch && semMatch;
            });
            if (filtered.length > 0) {
                return filtered.map(toSummary);
            }
            // No match — return null with available timetable summary
            return {
                message: `No timetable found for the requested filters (branch: ${branch || 'any'}, semester: ${semester || 'any'}).`,
                available: all.map(t => ({ course: t.course, branch: t.branch, semester: t.semester }))
            };
        }

        // No filter: return all with metadata
        return all.map(toSummary);
    },

    updateTimetableMetadata(id, { course, branch, semester }) {
        const all = this.getAllTimetables();
        const tt = all.find(t => t.id === id);
        if (!tt) return null;
        if (course !== undefined) tt.course = course;
        if (branch !== undefined) tt.branch = branch;
        if (semester !== undefined) tt.semester = semester;
        step5_saveAtomically(all);
        return tt;
    },

    updateTimetableEntries(id, newEntries) {
        const all = this.getAllTimetables();
        const tt = all.find(t => t.id === id);
        if (!tt) return null;
        tt.entries = newEntries;
        step5_saveAtomically(all);
        return tt;
    },

    /**
     * Manually re-trigger the PE/OE/HM/AU course sync for an existing timetable.
     * Useful for timetables that were uploaded before this feature was introduced.
     * @param {string} id - Timetable ID to re-sync.
     * @returns {{ synced: true, timetableId: string } | null}
     */
    resyncCoursesFromTimetable(id) {
        const all = this.getAllTimetables();
        const tt = all.find(t => t.id === id);
        if (!tt) return null;
        syncPECoursesFromTimetable(tt);
        return { synced: true, timetableId: id };
    },

    deleteTimetable(id) {
        const all = this.getAllTimetables();
        const timetable = all.find(t => t.id === id);
        const filtered = all.filter(t => t.id !== id);
        if (filtered.length === all.length) return false;
        step5_saveAtomically(filtered);
        // Revert any dynamic (PE/OE/HM/AU) courses that were linked to this timetable.
        // Non-fatal: a revert failure must not report a failed delete.
        if (timetable) {
            try {
                revertPECoursesForTimetable(id, { branch: timetable.branch, semester: timetable.semester });
            } catch (revertErr) {
                console.error(`⚠️  [PE Revert] Non-fatal: failed to revert dynamic courses: ${revertErr.message}`);
            }
        }
        return true;
    },

    deleteAllTimetables() {
        // Revert PE courses for every active timetable before removing the file.
        try {
            const all = this.getAllTimetables();
            for (const tt of all) {
                try {
                    revertPECoursesForTimetable(tt.id, { branch: tt.branch, semester: tt.semester });
                } catch (revertErr) {
                    console.error(`⚠️  [PE Revert] Non-fatal revert for timetable "${tt.id}": ${revertErr.message}`);
                }
            }
        } catch (e) {
            console.error(`⚠️  [PE Revert] Could not load timetables for bulk revert: ${e.message}`);
        }
        if (fs.existsSync(TIMETABLE_FILE)) {
            fs.unlinkSync(TIMETABLE_FILE);
            return true;
        }
        return false;
    }
};
