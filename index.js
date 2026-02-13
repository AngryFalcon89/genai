
import * as dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { MarkdownTextSplitter } from '@langchain/textsplitters';
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { LocalEmbeddings } from './utils/LocalEmbeddings.js';

const VECTOR_STORE_PATH = './vector_store';

// Specific files to index
const TARGET_FILES = ['document.md'];

/**
 * Extract the nearest parent heading(s) for a chunk based on its position.
 * This gives each chunk a "section" metadata field for better context.
 */
function extractSectionFromContent(text) {
    const lines = text.split('\n');
    const headings = [];
    for (const line of lines) {
        const match = line.match(/^(#{1,3})\s+(.+)/);
        if (match) {
            headings.push(match[2].trim());
        }
    }
    return headings.length > 0 ? headings[0] : 'General Information';
}

/**
 * Pre-process the document to add section context to each major block.
 * We prepend the parent heading chain so each chunk knows where it belongs.
 */
function addSectionContext(text) {
    const lines = text.split('\n');
    let currentH1 = '';
    let currentH2 = '';
    let currentH3 = '';
    const result = [];

    for (const line of lines) {
        const h1Match = line.match(/^#\s+(.+)/);
        const h2Match = line.match(/^##\s+(.+)/);
        const h3Match = line.match(/^###\s+(.+)/);

        if (h1Match) {
            currentH1 = h1Match[1].trim();
            currentH2 = '';
            currentH3 = '';
        } else if (h2Match) {
            currentH2 = h2Match[1].trim();
            currentH3 = '';
        } else if (h3Match) {
            currentH3 = h3Match[1].trim();
        }

        result.push(line);
    }

    return text;
}

async function indexMarkdownDocs() {
    console.log("🧹 Clearing old vector store...");
    if (fs.existsSync(VECTOR_STORE_PATH)) {
        fs.rmSync(VECTOR_STORE_PATH, { recursive: true, force: true });
        console.log("   Old store removed.");
    }

    console.log("🔍 Loading Markdown files...");
    const allDocs = [];

    for (const file of TARGET_FILES) {
        if (!fs.existsSync(file)) {
            console.warn(`   ⚠️ File not found: ${file} (Skipping)`);
            continue;
        }

        console.log(`\n📄 Processing: ${file}...`);
        try {
            const text = fs.readFileSync(file, 'utf-8');

            // Split by major sections first (## headings) to preserve structure
            const sections = splitByHeadings(text, file);
            allDocs.push(...sections);

            console.log(`   Loaded ${text.length} characters across ${sections.length} sections.`);
        } catch (err) {
            console.error(`   ❌ Failed to read ${file}:`, err.message);
        }
    }

    if (allDocs.length === 0) {
        console.log("No documents to index.");
        return;
    }

    // Step 2: Split text further if sections are too large
    console.log(`\n✂️ Chunking ${allDocs.length} sections...`);
    const textSplitter = new MarkdownTextSplitter({
        chunkSize: 2000,
        chunkOverlap: 300,
    });

    const chunkedDocs = await textSplitter.splitDocuments(allDocs);
    console.log(`   Created ${chunkedDocs.length} chunks.`);

    // Enrich chunks with section metadata
    for (const chunk of chunkedDocs) {
        if (!chunk.metadata.section) {
            chunk.metadata.section = extractSectionFromContent(chunk.pageContent);
        }
    }

    // Step 3: Embed and Index
    console.log('\n🧠 Initializing local embedding model...');
    const embeddings = new LocalEmbeddings();

    console.log('Creating HNSWLib index (this may take a moment)...');
    const vectorStore = await HNSWLib.fromDocuments(chunkedDocs, embeddings);

    console.log(`Saving index to ${VECTOR_STORE_PATH}...`);
    await vectorStore.save(VECTOR_STORE_PATH);

    console.log(`\n🎉 Done! Database updated with ${chunkedDocs.length} chunks from Markdown content.`);
}

/**
 * Split the document by ## headings to create logical sections.
 * Each section gets the parent heading chain as metadata.
 */
function splitByHeadings(text, source) {
    const lines = text.split('\n');
    const sections = [];
    let currentH1 = '';
    let currentH2 = '';
    let currentContent = [];
    let currentSection = 'General Information';

    function flushSection() {
        const content = currentContent.join('\n').trim();
        if (content.length > 0) {
            const sectionPath = [currentH1, currentH2].filter(Boolean).join(' > ');
            sections.push({
                pageContent: content,
                metadata: {
                    source,
                    section: sectionPath || currentSection,
                }
            });
        }
        currentContent = [];
    }

    for (const line of lines) {
        const h1Match = line.match(/^#\s+(.+)/);
        const h2Match = line.match(/^##\s+(.+)/);

        if (h1Match) {
            flushSection();
            currentH1 = h1Match[1].trim();
            currentH2 = '';
            currentSection = currentH1;
            currentContent.push(line);
        } else if (h2Match) {
            flushSection();
            currentH2 = h2Match[1].trim();
            currentSection = currentH2;
            currentContent.push(line);
        } else {
            currentContent.push(line);
        }
    }

    flushSection(); // Flush last section
    return sections;
}

indexMarkdownDocs();