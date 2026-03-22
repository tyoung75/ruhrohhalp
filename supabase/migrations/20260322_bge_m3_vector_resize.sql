-- BGE-M3 outputs 1024-dim. Existing embeddings are stale
-- after this migration — re-embed manually via /api/brain/reembed

-- 1. Drop IVF-FLAT indexes on all 7 knowledge table embedding columns

DROP INDEX IF EXISTS memories_embedding_idx;
DROP INDEX IF EXISTS decisions_embedding_idx;
DROP INDEX IF EXISTS projects_embedding_idx;
DROP INDEX IF EXISTS people_embedding_idx;
DROP INDEX IF EXISTS ideas_embedding_idx;
DROP INDEX IF EXISTS meetings_embedding_idx;
DROP INDEX IF EXISTS documents_embedding_idx;

-- 2. ALTER each embedding column from vector(1536) → vector(1024)

ALTER TABLE memories ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE decisions ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE projects ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE people ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE ideas ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE meetings ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE documents ALTER COLUMN embedding TYPE vector(1024);

-- 3. Recreate IVF-FLAT indexes on vector(1024) columns

CREATE INDEX memories_embedding_idx ON memories USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX decisions_embedding_idx ON decisions USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX projects_embedding_idx ON projects USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX people_embedding_idx ON people USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ideas_embedding_idx ON ideas USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX meetings_embedding_idx ON meetings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX documents_embedding_idx ON documents USING ivfflat (embedding vector_cosine_ops);
