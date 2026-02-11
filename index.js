import * as dotenv from 'dotenv';
dotenv.config();

import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Pinecone } from '@pinecone-database/pinecone';
import { pipeline } from '@xenova/transformers';

async function indexDocument() {
    //Step 1: Load the PDF document
    const PDF_PATH = './ordinance.pdf';
    const pdfLoader = new PDFLoader(PDF_PATH);
    const rawDocs = await pdfLoader.load();
    console.log(`PDF loaded: ${rawDocs.length} pages.`);

    //Step 2: Chunk the PDF into smaller pieces
    const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
    });
    const chunkedDocs = await textSplitter.splitDocuments(rawDocs);
    console.log(`Chunked into ${chunkedDocs.length} pieces.`);

    //Step 3: Initialize the local embedding model (768 dims)
    console.log('Loading embedding model (first time may download ~100MB)...');
    const embedder = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
    console.log('Embedding model loaded.');

    //Step 4: Initialize Pinecone
    const pinecone = new Pinecone();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);
    console.log('Pinecone initialized.');

    // Clear existing vectors (old Google embeddings)
    console.log('Clearing old vectors from index...');
    await pineconeIndex.deleteAll();
    console.log('Old vectors cleared.');

    //Step 5: Embed and upsert in batches
    const BATCH_SIZE = 50;
    let totalUpserted = 0;

    for (let i = 0; i < chunkedDocs.length; i += BATCH_SIZE) {
        const batch = chunkedDocs.slice(i, i + BATCH_SIZE);

        // Generate embeddings for this batch
        const vectors = [];
        for (let j = 0; j < batch.length; j++) {
            const doc = batch[j];
            const output = await embedder(doc.pageContent, { pooling: 'mean', normalize: true });
            const embedding = Array.from(output.data);

            vectors.push({
                id: `doc-${i + j}`,
                values: embedding,
                metadata: {
                    text: doc.pageContent,
                    source: doc.metadata?.source || PDF_PATH,
                    page: doc.metadata?.loc?.pageNumber || 0,
                },
            });
        }

        // Upsert batch to Pinecone
        await pineconeIndex.upsert(vectors);
        totalUpserted += vectors.length;
        console.log(`Progress: ${totalUpserted}/${chunkedDocs.length} chunks indexed.`);
    }

    console.log(`\nDone! ${totalUpserted} chunks indexed successfully.`);
}

indexDocument();