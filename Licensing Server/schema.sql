-- Decentra Licensing Server Database Schema

-- Licenses table
CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    license_key TEXT UNIQUE NOT NULL,
    license_id TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_company TEXT,
    tier TEXT NOT NULL,
    issued_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP,
    is_revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP,
    revocation_reason TEXT,
    max_installations INTEGER DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- License check-ins table (tracks active installations)
CREATE TABLE IF NOT EXISTS license_checkins (
    id SERIAL PRIMARY KEY,
    license_id TEXT NOT NULL,
    instance_fingerprint TEXT NOT NULL,
    instance_hostname TEXT,
    instance_platform TEXT,
    app_version TEXT,
    checked_in_at TIMESTAMP DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (license_id) REFERENCES licenses(license_id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_license_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_license_id ON licenses(license_id);
CREATE INDEX IF NOT EXISTS idx_licenses_tier ON licenses(tier);
CREATE INDEX IF NOT EXISTS idx_licenses_revoked ON licenses(is_revoked);
CREATE INDEX IF NOT EXISTS idx_checkins_license_id ON license_checkins(license_id);
CREATE INDEX IF NOT EXISTS idx_checkins_fingerprint ON license_checkins(instance_fingerprint);
CREATE INDEX IF NOT EXISTS idx_checkins_timestamp ON license_checkins(checked_in_at);
CREATE INDEX IF NOT EXISTS idx_checkins_license_fingerprint ON license_checkins(license_id, instance_fingerprint);

-- Create a view for active installations (within last 60 days)
CREATE OR REPLACE VIEW active_installations AS
SELECT DISTINCT ON (license_id, instance_fingerprint)
    license_id,
    instance_fingerprint,
    instance_hostname,
    instance_platform,
    app_version,
    checked_in_at as last_checkin,
    ip_address
FROM license_checkins
WHERE checked_in_at > NOW() - INTERVAL '60 days'
ORDER BY license_id, instance_fingerprint, checked_in_at DESC;

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_licenses_updated_at BEFORE UPDATE ON licenses
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert some example data for testing (optional)
-- Uncomment to add test data
/*
INSERT INTO licenses (
    license_key,
    license_id,
    customer_name,
    customer_email,
    customer_company,
    tier,
    issued_at,
    expires_at,
    max_installations
) VALUES (
    'test_license_key_placeholder',
    'LIC-20260209-TEST1',
    'Test Customer',
    'test@example.com',
    'Test Corp',
    'standard',
    NOW(),
    NOW() + INTERVAL '365 days',
    5
);
*/
