-- Migration: Add business_type column to merchants table
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS business_type TEXT;
