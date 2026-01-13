import * as dotenv from 'dotenv';
dotenv.config();

import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Pinecone } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';



async function indexDocument() {
    //Step 1: import and use PDFLoader to load and index a PDF document

    const PDF_PATH = './ordinance.pdf';
    const pdfLoader = new PDFLoader(PDF_PATH);
    const rawDocs = await pdfLoader.load();
    console.log("PDF document loaded successfully.");
    
    //Step 2: PDF chunking is performed

    const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
    });
    const chunkedDocs = await textSplitter.splitDocuments(rawDocs);
    console.log("PDF document chunked successfully.");

    //Step 3: Initializing the Embedding model

    const embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GEMINI_API_KEY,
        model: 'text-embedding-004',
    });
    console.log("Embedding model initialized successfully.");

    //Step 4: Initializing Pinecone client and getting the index

    const pinecone = new Pinecone();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);
    console.log("Pinecone client initialized successfully.");

    //Step 5: Creating Pinecone vector store from the documents

    await PineconeStore.fromDocuments(chunkedDocs, embeddings, {
        pineconeIndex,
        maxConcurrency: 5,
    });
    console.log("Document indexed successfully in Pinecone.");
}
indexDocument();