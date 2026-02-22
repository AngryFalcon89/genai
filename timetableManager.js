import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';

const TIMETABLE_FILE = './active_timetable.json';

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
            const prompt = `You are an expert data extractor. Read the attached university timetable.
Extract the class schedule into a structured JSON object.
OUTPUT ONLY VALID JSON. Do not include markdown formatting like \`\`\`json.

The JSON object must have this shape:
{
    "extracted_course": "string — e.g. B.Tech, M.Tech, BE, empty if not found",
    "extracted_branch": "string — e.g. Civil Engineering, CE, CSE, empty if not found",
    "extracted_semester": "string — e.g. 5, V, 1, 3, empty if not found",
    "entries": [
        {
            "course_code": "string (e.g., COC4012)",
            "course_title": "string",
            "day": "string (e.g., Monday)",
            "start_time": "string (e.g., 09:00 AM)",
            "end_time": "string (e.g., 10:00 AM)",
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
            let entries, extractedCourse, extractedBranch, extractedSemester;
            if (Array.isArray(parsed)) {
                entries = parsed;
                extractedCourse = ''; extractedBranch = ''; extractedSemester = '';
            } else {
                entries = parsed.entries || [];
                // allow for older name format fallback just in case
                const fallbackName = parsed.extracted_name || '';
                extractedCourse = parsed.extracted_course || '';
                extractedBranch = parsed.extracted_branch || fallbackName;
                extractedSemester = parsed.extracted_semester || '';
            }

            // Decide on metadata: prefer user-provided, then extracted
            const finalCourse = fallbackCourse || extractedCourse || '';
            const finalBranch = fallbackBranch || extractedBranch || 'Untitled Timetable';
            const finalSemester = fallbackSemester || extractedSemester || '';

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
