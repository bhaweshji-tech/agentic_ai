-- Virtual Stock Trading Simulator Database Schema

-- 1. User Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    virtual_balance NUMERIC(10,2) DEFAULT 5000.00 NOT NULL,
    is_blocked BOOLEAN DEFAULT FALSE NOT NULL,
    last_login_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Stock Ticks (1-second updates and downsampled averages)
CREATE TABLE IF NOT EXISTS stock_ticks (
    id BIGSERIAL PRIMARY KEY,
    stock_name VARCHAR(10) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    granularity VARCHAR(15) DEFAULT 'second' NOT NULL
);

-- Index on stock_name and created_at to speed up chart trends queries
CREATE INDEX IF NOT EXISTS idx_stock_ticks_name_time ON stock_ticks (stock_name, created_at);
-- Index on granularity to speed up downsampling and cleanup queries
CREATE INDEX IF NOT EXISTS idx_stock_ticks_granularity ON stock_ticks (granularity);

-- 3. Orders
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    stock_name VARCHAR(10) NOT NULL,
    qty INT NOT NULL,
    execution_price NUMERIC(10,2) NOT NULL,
    stop_loss NUMERIC(10,2),
    target_price NUMERIC(10,2),
    status VARCHAR(20) DEFAULT 'OPEN' NOT NULL, -- 'OPEN', 'COMPLETED', 'AUTO_CLOSED', 'CANCELLED'
    order_type VARCHAR(10) NOT NULL, -- 'BUY', 'SELL'
    mode VARCHAR(50) NOT NULL, -- 'Manual (Market)', 'Manual (Limit)', 'Automatic (Stop Loss)', 'Automatic (Target Price)', 'Automatic (Force Closed)'
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- 4. Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    action_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs (user_id);

-- 5. pg_cron Background Database downsampling (Supabase PG Integration)
-- To execute these, make sure pg_cron is enabled in your Supabase DB.
-- Run: CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Hourly Cleanup Schedule: Group 1-second ticks older than 1 hour into 1-minute averages and delete raw ticks.
SELECT cron.schedule('hourly-downsampling', '0 * * * *', $$
    INSERT INTO stock_ticks (stock_name, price, granularity, created_at)
    SELECT 
        stock_name,
        ROUND(AVG(price), 2) as price,
        'minute' as granularity,
        date_trunc('minute', created_at) as created_at
    FROM stock_ticks
    WHERE granularity = 'second' AND created_at < NOW() - INTERVAL '1 hour'
    GROUP BY stock_name, date_trunc('minute', created_at)
    ON CONFLICT DO NOTHING;

    DELETE FROM stock_ticks
    WHERE granularity = 'second' AND created_at < NOW() - INTERVAL '1 hour';
$$);

-- 6-Hour Cleanup Schedule: Group 1-minute ticks older than 6 hours into 5-minute averages and delete raw minutes.
SELECT cron.schedule('six-hourly-downsampling', '0 */6 * * *', $$
    INSERT INTO stock_ticks (stock_name, price, granularity, created_at)
    SELECT 
        stock_name,
        ROUND(AVG(price), 2) as price,
        '5minute' as granularity,
        to_timestamp(floor(extract(epoch from created_at) / 300) * 300) as created_at
    FROM stock_ticks
    WHERE granularity = 'minute' AND created_at < NOW() - INTERVAL '6 hours'
    GROUP BY stock_name, floor(extract(epoch from created_at) / 300)
    ON CONFLICT DO NOTHING;

    DELETE FROM stock_ticks
    WHERE granularity = 'minute' AND created_at < NOW() - INTERVAL '6 hours';
$$);

-- Constraint Enforcement: Ensure the database stays strictly under the 30,000-row budget.
SELECT cron.schedule('database-row-limit-check', '*/30 * * * *', $$
    DELETE FROM stock_ticks
    WHERE id IN (
        SELECT id FROM stock_ticks
        ORDER BY created_at ASC
        LIMIT (SELECT GREATEST(0, COUNT(*) - 25000) FROM stock_ticks)
    );
$$);

