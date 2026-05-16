-- Migration to add business address fields to merchants table
ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS business_country TEXT,
ADD COLUMN IF NOT EXISTS business_street TEXT,
ADD COLUMN IF NOT EXISTS business_city TEXT,
ADD COLUMN IF NOT EXISTS business_state TEXT;
