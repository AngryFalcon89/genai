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

    deleteTimetable(id) {
        const all = this.getAllTimetables();
        const filtered = all.filter(t => t.id !== id);
        if (filtered.length === all.length) return false;
        step5_saveAtomically(filtered);
        return true;
    },

    deleteAllTimetables() {
        if (fs.existsSync(TIMETABLE_FILE)) {
            fs.unlinkSync(TIMETABLE_FILE);
            return true;
        }
        return false;
    }
};
