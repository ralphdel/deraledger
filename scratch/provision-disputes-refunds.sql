-- ====================================================================
-- Deraledger Dispute Management & Refund Request Protection Schema
-- ====================================================================

-- 1. Create Payment Disputes table
CREATE TABLE IF NOT EXISTS public.payment_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id VARCHAR(50) UNIQUE NOT NULL,
    invoice_number VARCHAR(100) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    payment_rail VARCHAR(50) NOT NULL, -- BANK_TRANSFER, CARD, BREET_CRYPTO, WALLET
    category VARCHAR(255) NOT NULL,
    amount NUMERIC(20, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'REQUESTED', -- REQUESTED, REVIEWING, APPROVED, COMPLETED, REJECTED, FRAUD_REVIEW
    risk_score INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    evidence_url TEXT,
    payment_reference VARCHAR(255),
    tx_hash TEXT,
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS for Payment Disputes
ALTER TABLE public.payment_disputes ENABLE ROW LEVEL SECURITY;

-- Disputes Policies
CREATE POLICY "Public anonymous insert disputes" 
ON public.payment_disputes 
FOR INSERT 
TO public 
WITH CHECK (true);

CREATE POLICY "Merchants view own disputes" 
ON public.payment_disputes 
FOR SELECT 
TO authenticated 
USING (
    merchant_id IN (
        SELECT id FROM public.merchants WHERE user_id = auth.uid()
        UNION
        SELECT merchant_id FROM public.merchant_team WHERE user_id = auth.uid()
    )
);

CREATE POLICY "SuperAdmins manage all disputes" 
ON public.payment_disputes 
FOR ALL 
TO authenticated 
USING (
    (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::boolean = true OR
    (auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true
);


-- 2. Create Refund Requests table (Section 12.1 of PRD)
CREATE TABLE IF NOT EXISTS public.refund_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_reference VARCHAR(50) UNIQUE NOT NULL,
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
    payment_reference VARCHAR(255) NOT NULL,
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    payment_rail VARCHAR(50) NOT NULL,
    refund_type VARCHAR(50) NOT NULL,
    amount NUMERIC(20, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
    reason TEXT NOT NULL,
    internal_note TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'REQUESTED', -- REQUESTED, REVIEWING, APPROVED, PROCESSING, COMPLETED, OFFSET_APPLIED, REJECTED, FRAUD_REVIEW
    risk_score INTEGER NOT NULL DEFAULT 0,
    requires_manual_review BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS for Refund Requests
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

-- Refund Requests Policies
CREATE POLICY "Merchants manage own refund requests" 
ON public.refund_requests 
FOR ALL 
TO authenticated 
USING (
    merchant_id IN (
        SELECT id FROM public.merchants WHERE user_id = auth.uid()
        UNION
        SELECT merchant_id FROM public.merchant_team WHERE user_id = auth.uid()
    )
);

CREATE POLICY "SuperAdmins manage all refund requests" 
ON public.refund_requests 
FOR ALL 
TO authenticated 
USING (
    (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::boolean = true OR
    (auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true
);


-- 3. Create Refund Offsets table (Section 12.2 of PRD)
CREATE TABLE IF NOT EXISTS public.refund_offsets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_request_id UUID REFERENCES public.refund_requests(id) ON DELETE CASCADE NOT NULL,
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE NOT NULL,
    offset_amount NUMERIC(20, 2) NOT NULL,
    settlement_cycle VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS for Refund Offsets
ALTER TABLE public.refund_offsets ENABLE ROW LEVEL SECURITY;

-- Offsets Policies
CREATE POLICY "Merchants view own offsets" 
ON public.refund_offsets 
FOR SELECT 
TO authenticated 
USING (
    merchant_id IN (
        SELECT id FROM public.merchants WHERE user_id = auth.uid()
        UNION
        SELECT merchant_id FROM public.merchant_team WHERE user_id = auth.uid()
    )
);

CREATE POLICY "SuperAdmins manage all offsets" 
ON public.refund_offsets 
FOR ALL 
TO authenticated 
USING (
    (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::boolean = true OR
    (auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true
);


-- 4. Create Crypto Refund Reviews table (Section 12.3 of PRD)
CREATE TABLE IF NOT EXISTS public.crypto_refund_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_request_id UUID REFERENCES public.refund_requests(id) ON DELETE CASCADE NOT NULL,
    wallet_address VARCHAR(255) NOT NULL,
    network VARCHAR(50) NOT NULL,
    tx_hash VARCHAR(255) NOT NULL,
    compliance_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    reviewed_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS for Crypto Refund Reviews
ALTER TABLE public.crypto_refund_reviews ENABLE ROW LEVEL SECURITY;

-- Crypto Reviews Policies
CREATE POLICY "Merchants view own crypto reviews" 
ON public.crypto_refund_reviews 
FOR SELECT 
TO authenticated 
USING (
    refund_request_id IN (
        SELECT id FROM public.refund_requests WHERE merchant_id IN (
            SELECT id FROM public.merchants WHERE user_id = auth.uid()
            UNION
            SELECT merchant_id FROM public.merchant_team WHERE user_id = auth.uid()
        )
    )
);

CREATE POLICY "SuperAdmins manage all crypto reviews" 
ON public.crypto_refund_reviews 
FOR ALL 
TO authenticated 
USING (
    (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::boolean = true OR
    (auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true
);
