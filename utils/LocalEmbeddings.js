import { pipeline } from '@xenova/transformers';

class LocalEmbeddings {
    constructor() {
        this.model = process.env.EMBEDDING_MODEL || 'Xenova/bge-base-en-v1.5';
        this.fallbackModel = 'Xenova/all-mpnet-base-v2';
        this.pipeline = null;
    }

    async ensurePipeline() {
        if (!this.pipeline) {
            console.log('Loading embedding model...');
            try {
                this.pipeline = await pipeline('feature-extraction', this.model);
                console.log(`Embedding model loaded: ${this.model}`);
            } catch (error) {
                console.warn(`Failed to load embedding model "${this.model}". Falling back to "${this.fallbackModel}".`);
                this.model = this.fallbackModel;
                this.pipeline = await pipeline('feature-extraction', this.model);
                console.log(`Embedding model loaded: ${this.model}`);
            }
        }
    }

    async embedDocuments(documents) {
        await this.ensurePipeline();
        const embeddings = [];
        for (const doc of documents) {
            const output = await this.pipeline(doc, { pooling: 'mean', normalize: true });
            embeddings.push(Array.from(output.data));
        }
        return embeddings;
    }

    async embedQuery(text) {
        await this.ensurePipeline();
        const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }
}


export { LocalEmbeddings };
