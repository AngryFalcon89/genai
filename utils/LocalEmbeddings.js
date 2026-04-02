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
        for (let i = 0; i < documents.length; i++) {
            try {
                const output = await this.pipeline(documents[i], { pooling: 'mean', normalize: true });
                embeddings.push(Array.from(output.data));
            } catch (err) {
                console.error(
                    `[Self-Heal] Embedding failed for doc[${i}] ` +
                    `(len=${documents[i]?.length ?? 0}): ${err.message}`
                );
                // Push a zero-vector to keep index alignment with the document list.
                // Dimension defaults to 768 (bge-base-en-v1.5 / mpnet) or from first
                // successful embedding if available.
                const dim = embeddings[0]?.length ?? 768;
                embeddings.push(new Array(dim).fill(0));
            }
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
