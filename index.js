
import * as dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { Document } from '@langchain/core/documents';
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { LocalEmbeddings } from './utils/LocalEmbeddings.js';

const VECTOR_STORE_PATH = './vector_store';
const COURSES_JSON = './zhcet_courses.json';
const GENERAL_INFO_MD = './zhcet_general_info.md';

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

    console.log(`\n🎉 Done! Vector store built with ${allDocs.length} documents (${courses.length} courses + general info).`);
}

indexDocuments();