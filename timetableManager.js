import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';

const TIMETABLE_FILE = './active_timetable.json';
const COURSES_JSON = './zhcet_courses.json';

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

export const TimetableManager = {
    async processAndSaveTimetable(filePath, mimeType, fallbackCourse = '', fallbackBranch = '', fallbackSemester = '') {
        try {
            if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing in .env");

            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

            console.log("📤 Uploading timetable to Gemini...");
            const uploadResponse = await fileManager.uploadFile(filePath, {
                mimeType: mimeType,
                displayName: "Semester Timetable",
            });

            console.log("🧠 Processing timetable with Gemini...");
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const prompt = `You are an expert data extractor for ZHCET (Zakir Husain College of Engineering & Technology) university timetables.
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

            const result = await model.generateContent([
                { fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } },
                { text: prompt }
            ]);

            let jsonText = result.response.text().trim();
            jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

            const parsed = JSON.parse(jsonText);

            // Handle both old flat-array response and new object response
            let entries, extractedCourse, extractedBranch, extractedSemester, extractedYear, semesterParity;
            if (Array.isArray(parsed)) {
                entries = parsed;
                extractedCourse = ''; extractedBranch = ''; extractedSemester = ''; extractedYear = ''; semesterParity = '';
            } else {
                entries = parsed.entries || [];
                const fallbackName = parsed.extracted_name || '';
                extractedCourse = parsed.extracted_course || '';
                extractedBranch = parsed.extracted_branch || fallbackName;
                extractedSemester = parsed.extracted_semester || '';
                extractedYear = parsed.extracted_year || '';
                semesterParity = parsed.semester_parity || '';
            }

            // Smart semester resolution logic
            let finalSemesterNum = extractedSemester.trim();
            if (!finalSemesterNum && extractedYear && semesterParity) {
                let yrMatch = extractedYear.match(/\d+/);
                if (yrMatch) {
                    let yr = parseInt(yrMatch[0], 10);
                    let isEven = semesterParity.toLowerCase().includes('even');
                    if (yr > 0) {
                        finalSemesterNum = ((yr - 1) * 2 + (isEven ? 2 : 1)).toString();
                    }
                }
            }

            const finalCourse = fallbackCourse || extractedCourse || '';
            const finalBranch = fallbackBranch || extractedBranch || 'Untitled Timetable';
            const finalSemester = fallbackSemester || finalSemesterNum || '';

            // Auto-fill missing course titles and snap times to standard slots
            entries = autoFillCourseTitles(entries);
            entries = snapTimesToStandardSlots(entries);

            // Load existing timetables or start fresh
            const allTimetables = this.getAllTimetables();
            const newTimetable = {
                id: Date.now().toString(36),
                course: finalCourse,
                branch: finalBranch,
                semester: finalSemester,
                entries: entries,
                uploadedAt: new Date().toISOString(),
            };
            allTimetables.push(newTimetable);

            fs.writeFileSync(TIMETABLE_FILE, JSON.stringify(allTimetables, null, 2));
            console.log(`💾 Timetable "${finalBranch}" saved locally (${entries.length} entries).`);

            // Cleanup
            await fileManager.deleteFile(uploadResponse.file.name);
            fs.unlinkSync(filePath);

            return newTimetable;
        } catch (error) {
            console.error("❌ Failed to process timetable:", error);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            throw new Error("Could not parse timetable document.");
        }
    },

    getAllTimetables() {
        if (fs.existsSync(TIMETABLE_FILE)) {
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
        }
        return [];
    },

    getActiveTimetable() {
        const all = this.getAllTimetables();
        if (all.length === 0) return null;
        return all.flatMap(t => t.entries);
    },

    updateTimetableMetadata(id, { course, branch, semester }) {
        const all = this.getAllTimetables();
        const tt = all.find(t => t.id === id);
        if (!tt) return null;
        if (course !== undefined) tt.course = course;
        if (branch !== undefined) tt.branch = branch;
        if (semester !== undefined) tt.semester = semester;
        fs.writeFileSync(TIMETABLE_FILE, JSON.stringify(all, null, 2));
        return tt;
    },

    updateTimetableEntries(id, newEntries) {
        const all = this.getAllTimetables();
        const tt = all.find(t => t.id === id);
        if (!tt) return null;
        tt.entries = newEntries;
        fs.writeFileSync(TIMETABLE_FILE, JSON.stringify(all, null, 2));
        return tt;
    },

    deleteTimetable(id) {
        const all = this.getAllTimetables();
        const filtered = all.filter(t => t.id !== id);
        if (filtered.length === all.length) return false;
        fs.writeFileSync(TIMETABLE_FILE, JSON.stringify(filtered, null, 2));
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
