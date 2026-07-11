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
    status VARCHAR(20) DEFAULT 'OPEN' NOT NULL, -- 'OPEN', 'COMPLETED', 'AUTO_CLOSED', 'CANCELLED'
    order_type VARCHAR(10) NOT NULL, -- 'BUY', 'SELL'
    mode VARCHAR(50) NOT NULL, -- 'Manual (Market)', 'Manual (Limit)', 'Automatic (Stop Loss)', 'Automatic (Force Closed)'
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
