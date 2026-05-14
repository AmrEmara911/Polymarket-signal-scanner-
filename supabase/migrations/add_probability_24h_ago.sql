-- Add probability_24h_ago column to markets table
ALTER TABLE markets
ADD COLUMN IF NOT EXISTS probability_24h_ago NUMERIC;

-- Backfill existing rows with their current probability so we have
-- a baseline (this will result in 0 movement until next ingestion)
UPDATE markets
SET probability_24h_ago = probability
WHERE probability_24h_ago IS NULL;

-- Verify the column exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'markets' AND column_name = 'probability_24h_ago';
