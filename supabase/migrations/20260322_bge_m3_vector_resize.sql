-- BGE-M3 outputs 1024-dim. Existing 1536-dim embeddings are stale and must be
-- cleared before resizing. Re-embed manually via /api/brain/reembed after this.

-- 1. Drop IVF-FLAT indexes on all embedding columns (knowledge tables + goals)

DROP INDEX IF EXISTS memories_embedding_idx;
DROP INDEX IF EXISTS decisions_embedding_idx;
DROP INDEX IF EXISTS projects_embedding_idx;
DROP INDEX IF EXISTS people_embedding_idx;
DROP INDEX IF EXISTS ideas_embedding_idx;
DROP INDEX IF EXISTS meetings_embedding_idx;
DROP INDEX IF EXISTS documents_embedding_idx;
DROP INDEX IF EXISTS goals_embedding_idx;

-- 2. Clear stale 1536-dim embeddings — pgvector cannot cast between dimensions

UPDATE memories SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE decisions SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE projects SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE people SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE ideas SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE meetings SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE documents SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE goals SET embedding = NULL WHERE embedding IS NOT NULL;

-- 3. ALTER each embedding column from vector(1536) → vector(1024)

ALTER TABLE memories ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE decisions ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE projects ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE people ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE ideas ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE meetings ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE documents ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE goals ALTER COLUMN embedding TYPE vector(1024);

-- 4. Recreate IVF-FLAT indexes on vector(1024) columns

CREATE INDEX memories_embedding_idx ON memories USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX decisions_embedding_idx ON decisions USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX projects_embedding_idx ON projects USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX people_embedding_idx ON people USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ideas_embedding_idx ON ideas USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX meetings_embedding_idx ON meetings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX documents_embedding_idx ON documents USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX goals_embedding_idx ON goals USING ivfflat (embedding vector_cosine_ops);
