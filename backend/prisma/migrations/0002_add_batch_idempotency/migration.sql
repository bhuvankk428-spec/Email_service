-- Idempotent schedule submissions: a retried request with the same
-- (userId, idempotencyKey) maps to the batch created by the first attempt.
ALTER TABLE "Batch" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Batch_userId_idempotencyKey_key" ON "Batch"("userId", "idempotencyKey");
