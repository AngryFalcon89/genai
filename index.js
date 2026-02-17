
import * as dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { Document } from '@langchain/core/documents';
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { LocalEmbeddings } from './utils/LocalEmbeddings.js';

const VECTOR_STORE_PATH = './vector_store';
const COURSES_JSON = './zhcet_courses.json';
const GENERAL_INFO_MD = './zhcet_general_info.md';

/**
 * Build a rich, searchable text block for a group of courses
 * sharing the same branch and semester.
 */
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

/**
 * Build metadata for a grouped semester document.
 */
function buildGroupMetadata(coursesInGroup) {
    const first = coursesInGroup[0];
    return {
        source: 'zhcet_courses.json',
        type: 'course_group',
        program: first.program,
        branch: first.branch,
        semester: first.semester,
        course_count: coursesInGroup.length,
        course_codes: coursesInGroup
            .map(c => c.course_code || 'Elective/TBD')
            .join(', '),
        course_titles: coursesInGroup
            .map(c => c.course_title)
            .join(', '),
    };
}

async function indexDocuments() {
    // ── Step 1: Clear old vector store ──────────────────────────────────────
    console.log("🧹 Clearing old vector store...");
    if (fs.existsSync(VECTOR_STORE_PATH)) {
        fs.rmSync(VECTOR_STORE_PATH, { recursive: true, force: true });
        console.log("   Old store removed.");
    }

    const allDocs = [];

    // ── Step 2: Load structured course data from JSON ───────────────────────
    console.log("📄 Loading course data from zhcet_courses.json...");
    if (!fs.existsSync(COURSES_JSON)) {
        console.error(`❌ ${COURSES_JSON} not found. Run 'python3 parse_courses.py' first.`);
        process.exit(1);
    }

    const courses = JSON.parse(fs.readFileSync(COURSES_JSON, 'utf-8'));
    console.log(`   Found ${courses.length} course records.`);

    // ── Group courses by branch + semester ──────────────────────────────────
    const grouped = {};
    for (const course of courses) {
        const key = `${course.branch}__${course.semester}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(course);
    }

    console.log(`   Grouped into ${Object.keys(grouped).length} (branch + semester) chunks.`);

    // Create one Document per (branch + semester) group
    for (const [key, coursesInGroup] of Object.entries(grouped)) {
        allDocs.push(new Document({
            pageContent: buildGroupText(coursesInGroup),
            metadata: buildGroupMetadata(coursesInGroup),
        }));
    }

    // Also keep individual course documents for fine-grained single-course lookups
    for (const course of courses) {
        allDocs.push(new Document({
            pageContent: course.searchable_text,
            metadata: {
                source: 'zhcet_courses.json',
                type: 'course',
                program: course.program,
                branch: course.branch,
                semester: course.semester,
                course_category: course.course_category,
                course_category_full: course.course_category_full,
                course_code: course.course_code || 'Elective/TBD',
                course_title: course.course_title,
                credits: course.credits,
                contact_periods: course.contact_periods || 'N/A',
                marks: course.marks || 'N/A',
            },
        }));
    }

    // ── Step 3: Load general information markdown ───────────────────────────
    if (fs.existsSync(GENERAL_INFO_MD)) {
        console.log("📄 Loading general info from zhcet_general_info.md...");
        const generalText = fs.readFileSync(GENERAL_INFO_MD, 'utf-8');

        // Split general info into reasonable chunks by double newlines
        const sections = generalText.split(/\n{2,}/);
        let chunk = '';
        let chunkCount = 0;

        for (const section of sections) {
            const trimmed = section.trim();
            if (!trimmed) continue;

            // If adding this section would exceed ~2500 chars, flush
            if (chunk.length + trimmed.length > 2500 && chunk.length > 0) {
                allDocs.push(new Document({
                    pageContent: chunk.trim(),
                    metadata: {
                        source: 'zhcet_general_info.md',
                        type: 'general_info',
                    },
                }));
                chunkCount++;
                chunk = '';
            }
            chunk += trimmed + '\n\n';
        }

        // Flush remaining
        if (chunk.trim().length > 0) {
            allDocs.push(new Document({
                pageContent: chunk.trim(),
                metadata: {
                    source: 'zhcet_general_info.md',
                    type: 'general_info',
                },
            }));
            chunkCount++;
        }

        console.log(`   Created ${chunkCount} general info chunks.`);
    } else {
        console.warn("   ⚠️ zhcet_general_info.md not found — skipping general info.");
    }

    if (allDocs.length === 0) {
        console.log("No documents to index.");
        return;
    }

    // ── Step 4: Embed and save to vector store ──────────────────────────────
    console.log(`\n🧠 Initializing local embedding model...`);
    const embeddings = new LocalEmbeddings();

    console.log(`Creating HNSWLib index from ${allDocs.length} documents...`);
    const vectorStore = await HNSWLib.fromDocuments(allDocs, embeddings);

    console.log(`Saving index to ${VECTOR_STORE_PATH}...`);
    await vectorStore.save(VECTOR_STORE_PATH);

    console.log(`\n🎉 Done! Vector store built with ${allDocs.length} documents.`);
    console.log(`   • ${Object.keys(grouped).length} semester-group docs`);
    console.log(`   • ${courses.length} individual course docs`);
    console.log(`   • general info chunks`);
}

indexDocuments();