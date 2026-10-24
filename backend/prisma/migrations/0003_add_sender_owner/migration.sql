ALTER TABLE "Sender" ADD COLUMN "userId" TEXT;

CREATE INDEX "Sender_userId_idx" ON "Sender"("userId");

ALTER TABLE "Sender" ADD CONSTRAINT "Sender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
