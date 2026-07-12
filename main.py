import os
import asyncio
import random
import jwt
from datetime import datetime, time, timedelta, timezone
from typing import List, Dict, Set, Optional
from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, String, Numeric, Boolean, DateTime, BigInteger, Integer, ForeignKey, Index, select, func, desc, and_
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from passlib.context import CryptContext

# 1. Configuration & App Setup
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-key-change-in-production-12345")
ALGORITHM = "HS256"
DATABASE_URL = os.getenv("DATABASE_URL")

# Automatic Database URL translation for async pg
# If DATABASE_URL is postgres:// or postgresql://, translate to postgresql+asyncpg://
if DATABASE_URL:
    if DATABASE_URL.startswith("postgresql://"):
        ASYNC_DB_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif DATABASE_URL.startswith("postgres://"):
        ASYNC_DB_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
    else:
        ASYNC_DB_URL = DATABASE_URL
else:
    # Local developer fallback: SQLite
    ASYNC_DB_URL = "sqlite+aiosqlite:///virtual_trading.db"

app = FastAPI(title="Virtual Stock Trading Simulator API")

# Allow CORS origins for both localhost and GitHub Pages deployment
allowed_origins = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
    "http://127.0.0.1:5500",
    "https://bhaweshji-tech.github.io"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 2. Database Model Definitions
Base = declarative_base()

class UserDB(Base):
    __tablename__ = "user_profiles"
    id = Column(String(36), primary key=True) # Stored as string to support both PostgreSQL UUID & SQLite
    email = Column(String(255), unique=True, nullable=False)
    virtual_balance = Column(Numeric(10, 2), default=5000.00, nullable=False)
    is_blocked = Column(Boolean, default=False, nullable=False)
    last_login_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)
    last_active_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)
    hashed_password = Column(String(255), nullable=True) # Nullable for native Supabase Auth users

class StockTickDB(Base):
    __tablename__ = "stock_ticks"
    id = Column(BigInteger, primary key=True, autoincrement=True)
    stock_name = Column(String(10), nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)
    granularity = Column(String(15), default="second", nullable=False)

    __table_args__ = (
        Index("idx_stock_ticks_name_time", "stock_name", "created_at"),
        Index("idx_stock_ticks_granularity", "granularity"),
    )

class OrderDB(Base):
    __tablename__ = "orders"
    id = Column(BigInteger, primary key=True, autoincrement=True)
    user_id = Column(String(36), ForeignKey("user_profiles.id", ondelete="CASCADE"), nullable=False)
    stock_name = Column(String(10), nullable=False)
    qty = Column(Integer, nullable=False)
    execution_price = Column(Numeric(10, 2), nullable=False)
    stop_loss = Column(Numeric(10, 2), nullable=True)
    target_price = Column(Numeric(10, 2), nullable=True)
    status = Column(String(20), default="OPEN", nullable=False) # 'OPEN', 'COMPLETED', 'AUTO_CLOSED', 'CANCELLED'
    order_type = Column(String(10), nullable=False) # 'BUY', 'SELL'
    mode = Column(String(50), nullable=False) # 'Manual (Market)', 'Manual (Limit)', 'Automatic (Stop Loss)', 'Automatic (Target Price)', 'Automatic (Force Closed)'
    created_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_orders_user", "user_id"),
        Index("idx_orders_status", "status"),
    )

class ActivityLogDB(Base):
    __tablename__ = "activity_logs"
    id = Column(BigInteger, primary key=True, autoincrement=True)
    user_id = Column(String(36), ForeignKey("user_profiles.id", ondelete="CASCADE"), nullable=False)
    action_text = Column(String(500), nullable=False)
    created_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_activity_logs_user", "user_id"),
    )

# Async engine setup
engine = create_async_engine(ASYNC_DB_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Sync table creation helper (run on startup)
async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# DB Dependency injection helper
async def get_db():
    async session = AsyncSessionLocal()
    try:
        yield session
    finally:
        await session.close()

# 3. Pydantic Models for API
class UserRegister(BaseModel):
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    email: str
    is_admin: bool
    user_id: str

class OrderCreate(BaseModel):
    stock_name: str
    qty: int = Field(..., gt=0)
    order_type: str # 'BUY', 'SELL'
    order_mode: str # 'MARKET', 'LIMIT'
    limit_price: Optional[float] = None
    stop_loss: Optional[float] = None
    target_price: Optional[float] = None

class UserSync(BaseModel):
    id: str
    email: str

# 4. In-Memory Mock Market Cache & Broadcast Manager
STOCKS = ["STOCK_A", "STOCK_B", "STOCK_C", "STOCK_D"]

# Global Simulation state
market_prices = {
    "STOCK_A": 100.00,
    "STOCK_B": 250.00,
    "STOCK_C": 500.00,
    "STOCK_D": 1200.00,
}

# Reference baseline for circuit breaker clips (+/- 5%)
market_opening_prices = {
    "STOCK_A": 100.00,
    "STOCK_B": 250.00,
    "STOCK_C": 500.00,
    "STOCK_D": 1200.00,
}

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {} # user_id -> socket

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        # If user already connected, drop previous socket
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].close(code=4000, reason="Logged in elsewhere")
            except:
                pass
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

    async def send_personal_message(self, message: dict, user_id: str):
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_json(message)

    async def broadcast(self, message: dict):
        for user_id, connection in list(self.active_connections.items()):
            try:
                await connection.send_json(message)
            except:
                self.disconnect(user_id)

    async def force_logout_user(self, user_id: str, reason: str = "Blocked by administrator"):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json({
                    "type": "FORCE_LOGOUT",
                    "reason": reason
                })
                await self.active_connections[user_id].close(code=4003, reason=reason)
            except:
                pass
            self.disconnect(user_id)

manager = ConnectionManager()

# Helper for User JWT Auth
def get_current_user(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def update_user_activity(token: str = Query(...), db: AsyncSession = Depends(get_db)) -> UserDB:
    payload = get_current_user(token)
    user_id = payload.get("id")
    
    result = await db.execute(select(UserDB).where(UserDB.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.is_blocked:
        raise HTTPException(status_code=403, detail="You have been blocked by the admin. Please contact admin.")
        
    # Check 2-hour idle session timeout
    now = datetime.now(timezone.utc)
    last_active = user.last_active_at.replace(tzinfo=timezone.utc) if user.last_active_at.tzinfo is None else user.last_active_at
    if now - last_active > timedelta(hours=2):
        raise HTTPException(status_code=401, detail="Session expired due to 2 hours of inactivity. Please log in again.")
        
    user.last_active_at = now
    
    # Check midnight reset fallback (if user's last login date is before today, reset balance)
    today_date = now.date()
    last_login_date = user.last_login_at.date()
    if last_login_date < today_date:
        user.virtual_balance = 5000.00
        user.last_login_at = now
        log = ActivityLogDB(user_id=user.id, action_text="Daily balance reset: balance set to exactly 5,000.00 INR.")
        db.add(log)
        
    await db.commit()
    return user

# 5. Core APIs (Auth, Profile, History, Orders)

async def prepopulate_historical_data():
    async with AsyncSessionLocal() as db:
        # Check if we already have ticks
        stmt = select(func.count(StockTickDB.id))
        res = await db.execute(stmt)
        count = res.scalar() or 0
        if count > 0:
            print("Database already contains stock tick history. Skipping pre-population.")
            # Load the current prices and opening prices
            today_midnight = datetime.combine(datetime.now().date(), time.min).replace(tzinfo=timezone.utc)
            for stock in STOCKS:
                # Latest price
                latest_stmt = select(StockTickDB.price).where(StockTickDB.stock_name == stock).order_by(StockTickDB.created_at.desc()).limit(1)
                latest_res = await db.execute(latest_stmt)
                latest_price = latest_res.scalar()
                if latest_price:
                    market_prices[stock] = float(latest_price)
                
                # Opening price (first tick of today after midnight)
                open_stmt = select(StockTickDB.price).where(
                    and_(StockTickDB.stock_name == stock, StockTickDB.created_at >= today_midnight)
                ).order_by(StockTickDB.created_at.asc()).limit(1)
                open_res = await db.execute(open_stmt)
                open_price = open_res.scalar()
                if open_price:
                    market_opening_prices[stock] = float(open_price)
                else:
                    market_opening_prices[stock] = market_prices[stock]
            return

        print("Pre-populating historical stock ticks starting from 1st July 2026...")
        start_time = datetime(2026, 7, 1, 0, 0, 0, tzinfo=timezone.utc)
        end_time = datetime.now(timezone.utc)
        
        # Initial prices
        prices = {
            "STOCK_A": 100.00,
            "STOCK_B": 250.00,
            "STOCK_C": 500.00,
            "STOCK_D": 1200.00,
        }
        
        # We divide the timeline into 3 segments:
        # 1. 5-minute ticks: from start_time to 6 hours ago
        # 2. 1-minute ticks: from 6 hours ago to 1 hour ago
        # 3. 10-second ticks: from 1 hour ago to now
        six_hours_ago = end_time - timedelta(hours=6)
        one_hour_ago = end_time - timedelta(hours=1)
        
        ticks_to_insert = []
        
        # Segment 1: 5-minute averages
        curr = start_time
        while curr < six_hours_ago:
            for stock in STOCKS:
                if random.random() < 0.70:
                    delta = random.uniform(-0.001, 0.001)
                    prices[stock] = round(prices[stock] * (1 + delta), 2)
                ticks_to_insert.append(StockTickDB(
                    stock_name=stock,
                    price=prices[stock],
                    granularity="5minute",
                    created_at=curr
                ))
            curr += timedelta(minutes=5)
            
        # Segment 2: 1-minute averages
        curr = six_hours_ago
        while curr < one_hour_ago:
            for stock in STOCKS:
                if random.random() < 0.70:
                    delta = random.uniform(-0.001, 0.001)
                    prices[stock] = round(prices[stock] * (1 + delta), 2)
                ticks_to_insert.append(StockTickDB(
                    stock_name=stock,
                    price=prices[stock],
                    granularity="minute",
                    created_at=curr
                ))
            curr += timedelta(minutes=1)
            
        # Segment 3: 10-second ticks (downsampled slightly to stay well within 30k limit)
        curr = one_hour_ago
        while curr < end_time:
            for stock in STOCKS:
                if random.random() < 0.70:
                    delta = random.uniform(-0.001, 0.001)
                    prices[stock] = round(prices[stock] * (1 + delta), 2)
                ticks_to_insert.append(StockTickDB(
                    stock_name=stock,
                    price=prices[stock],
                    granularity="second",
                    created_at=curr
                ))
            curr += timedelta(seconds=10)
            
        # Save to DB in chunks
        chunk_size = 1000
        for i in range(0, len(ticks_to_insert), chunk_size):
            chunk = ticks_to_insert[i:i+chunk_size]
            db.add_all(chunk)
            await db.commit()
            
        # Update current price caches
        for stock in STOCKS:
            market_prices[stock] = prices[stock]
            market_opening_prices[stock] = prices[stock]
            
        print(f"Successfully populated {len(ticks_to_insert)} historical ticks.")

@app.on_event("startup")
async def startup_event():
    await init_db()
    await prepopulate_historical_data()
    # Start loop background threads
    asyncio.create_task(price_generation_loop())
    asyncio.create_task(downsampling_loop())
    asyncio.create_task(midnight_reset_loop())

@app.post("/api/auth/register", response_model=Token)
async def register(user: UserRegister, db: AsyncSession = Depends(get_db)):
    # Check if exists
    result = await db.execute(select(UserDB).where(UserDB.email == user.email))
    existing_user = result.scalars().first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    import uuid
    user_id = str(uuid.uuid4())
    hashed_pwd = pwd_context.hash(user.password)
    
    new_user = UserDB(
        id=user_id,
        email=user.email,
        hashed_password=hashed_pwd,
        virtual_balance=5000.00
    )
    db.add(new_user)
    
    # Log Registration Action
    log = ActivityLogDB(user_id=user_id, action_text="Account registered and allocated 5,000.00 INR balance.")
    db.add(log)
    await db.commit()
    
    # Generate Token
    is_admin = (user.email == "bhaweshji@gmail.com")
    token_data = {"sub": user.email, "id": user_id, "is_admin": is_admin}
    token = jwt.encode(token_data, JWT_SECRET, algorithm=ALGORITHM)
    
    return {"access_token": token, "token_type": "bearer", "email": user.email, "is_admin": is_admin, "user_id": user_id}

@app.post("/api/auth/login", response_model=Token)
async def login(user: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserDB).where(UserDB.email == user.email))
    db_user = result.scalars().first()
    if not db_user:
        raise HTTPException(status_code=400, detail="Invalid email or password")
    
    if db_user.is_blocked:
        raise HTTPException(status_code=403, detail="You have been blocked by the admin. Please contact admin.")
    
    if not db_user.hashed_password or not pwd_context.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    
    # Update last login time
    db_user.last_login_at = datetime.now(timezone.utc)
    log = ActivityLogDB(user_id=db_user.id, action_text="Logged in to platform.")
    db.add(log)
    await db.commit()
    
    is_admin = (db_user.email == "bhaweshji@gmail.com")
    token_data = {"sub": db_user.email, "id": db_user.id, "is_admin": is_admin}
    token = jwt.encode(token_data, JWT_SECRET, algorithm=ALGORITHM)
    
    return {"access_token": token, "token_type": "bearer", "email": db_user.email, "is_admin": is_admin, "user_id": db_user.id}

@app.post("/api/auth/sync", response_model=Token)
async def sync_supabase_user(payload: UserSync, db: AsyncSession = Depends(get_db)):
    """Syncs a user registered/authenticated externally via Supabase Auth"""
    result = await db.execute(select(UserDB).where(UserDB.id == payload.id))
    db_user = result.scalars().first()
    
    if not db_user:
        # Check if email taken by mismatching ID
        email_check = await db.execute(select(UserDB).where(UserDB.email == payload.email))
        if email_check.scalars().first():
            raise HTTPException(status_code=400, detail="Email matches an existing sync error state")
            
        db_user = UserDB(
            id=payload.id,
            email=payload.email,
            virtual_balance=5000.00
        )
        db.add(db_user)
        log = ActivityLogDB(user_id=payload.id, action_text="Synced profile and allocated 5,000.00 INR virtual balance.")
        db.add(log)
        await db.commit()
    else:
        if db_user.is_blocked:
            raise HTTPException(status_code=403, detail="You have been blocked by the admin. Please contact admin.")
            
        db_user.last_login_at = datetime.now(timezone.utc)
        log = ActivityLogDB(user_id=db_user.id, action_text="Logged in via synced OAuth/Auth credentials.")
        db.add(log)
        await db.commit()
        
    is_admin = (db_user.email == "bhaweshji@gmail.com")
    token_data = {"sub": db_user.email, "id": db_user.id, "is_admin": is_admin}
    token = jwt.encode(token_data, JWT_SECRET, algorithm=ALGORITHM)
    
    return {"access_token": token, "token_type": "bearer", "email": db_user.email, "is_admin": is_admin, "user_id": db_user.id}

@app.get("/api/user/profile")
async def get_profile(user: UserDB = Depends(update_user_activity)):
    return {
        "id": user.id,
        "email": user.email,
        "virtual_balance": float(user.virtual_balance),
        "is_blocked": user.is_blocked,
        "last_login_at": user.last_login_at
    }

@app.get("/api/stocks/history")
async def get_stocks_history(
    stock_name: str,
    granularity: str = "second", # 'second', 'minute', '5minute'
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(StockTickDB).where(
        and_(
            StockTickDB.stock_name == stock_name,
            StockTickDB.granularity == granularity
        )
    )
    
    if start_time:
        query = query.where(StockTickDB.created_at >= start_time)
    if end_time:
        query = query.where(StockTickDB.created_at <= end_time)
        
    query = query.order_by(StockTickDB.created_at.asc())
    result = await db.execute(query)
    ticks = result.scalars().all()
    
    # Fallback to wider granularity automatically if query yields 0 results for secondary granularities
    if len(ticks) == 0 and granularity != "second":
        # Fallback query
        query_fallback = select(StockTickDB).where(
            and_(
                StockTickDB.stock_name == stock_name,
                StockTickDB.granularity == "second"
            )
        )
        if start_time:
            query_fallback = query_fallback.where(StockTickDB.created_at >= start_time)
        if end_time:
            query_fallback = query_fallback.where(StockTickDB.created_at <= end_time)
        query_fallback = query_fallback.order_by(StockTickDB.created_at.asc())
        result_fallback = await db.execute(query_fallback)
        ticks = result_fallback.scalars().all()
        
    return [
        {
            "price": float(tick.price),
            "created_at": tick.created_at
        }
        for tick in ticks
    ]

# Fetch current holdings helper
async def get_user_holdings(user_id: str, db: AsyncSession) -> Dict[str, int]:
    # holdings = sum(BUY qty of COMPLETED/AUTO_CLOSED) - sum(SELL qty of COMPLETED/AUTO_CLOSED)
    # Actually, in our simple order management:
    # BUY orders with status='COMPLETED' give user positive holdings.
    # When user SELLS, it reduces holdings.
    # Let's count BUYs:
    buy_result = await db.execute(
        select(func.sum(OrderDB.qty), OrderDB.stock_name)
        .where(and_(OrderDB.user_id == user_id, OrderDB.order_type == "BUY", OrderDB.status.in_(["COMPLETED", "AUTO_CLOSED"])))
        .group_by(OrderDB.stock_name)
    )
    buys = {row[1]: row[0] or 0 for row in buy_result.all()}
    
    # Let's count SELLs:
    sell_result = await db.execute(
        select(func.sum(OrderDB.qty), OrderDB.stock_name)
        .where(and_(OrderDB.user_id == user_id, OrderDB.order_type == "SELL", OrderDB.status.in_(["COMPLETED", "AUTO_CLOSED"])))
        .group_by(OrderDB.stock_name)
    )
    sells = {row[1]: row[0] or 0 for row in sell_result.all()}
    
    holdings = {}
    for stock in STOCKS:
        b_qty = buys.get(stock, 0)
        s_qty = sells.get(stock, 0)
        holdings[stock] = max(0, b_qty - s_qty)
        
    return holdings

@app.get("/api/orders/holdings")
async def get_holdings(user: UserDB = Depends(update_user_activity), db: AsyncSession = Depends(get_db)):
    holdings = await get_user_holdings(user.id, db)
    return holdings

@app.post("/api/orders/place")
async def place_order(order: OrderCreate, user: UserDB = Depends(update_user_activity), db: AsyncSession = Depends(get_db)):
    user_id = user.id
    
    stock_price = market_prices.get(order.stock_name)
    if not stock_price:
        raise HTTPException(status_code=400, detail="Invalid stock name")
        
    execution_price = stock_price
    
    # Validation based on Mode
    if order.order_mode == "LIMIT":
        if not order.limit_price or order.limit_price <= 0:
            raise HTTPException(status_code=400, detail="Invalid limit price specified")
        # Do not immediately execute at market price; write it with execution_price as limit_price, status='OPEN'
        execution_price = order.limit_price
        order_status = "OPEN"
    else:
        order_status = "COMPLETED"
        
    total_cost = order.qty * execution_price
    
    if order.order_type == "BUY":
        # Check cash balance
        if order_status == "COMPLETED" and float(user.virtual_balance) < total_cost:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Required: Rs. {total_cost:.2f}, Available: Rs. {float(user.virtual_balance):.2f}")
        
        # Deduct balance immediately if completed
        if order_status == "COMPLETED":
            user.virtual_balance = float(user.virtual_balance) - total_cost
            
        new_order = OrderDB(
            user_id=user_id,
            stock_name=order.stock_name,
            qty=order.qty,
            execution_price=execution_price,
            stop_loss=order.stop_loss,
            target_price=order.target_price,
            status=order_status,
            order_type="BUY",
            mode=f"Manual ({order.order_mode.capitalize()})"
        )
        db.add(new_order)
        
        # Save Log
        action = f"Placed manual {order.order_mode.lower()} BUY of {order.qty} {order.stock_name} shares at Rs. {execution_price:.2f}."
        if order.stop_loss:
            action += f" Stop Loss: Rs. {order.stop_loss:.2f}"
        if order.target_price:
            action += f" Target Price: Rs. {order.target_price:.2f}"
        log = ActivityLogDB(user_id=user_id, action_text=action)
        db.add(log)
        
    elif order.order_type == "SELL":
        # Check stock holding balances
        holdings = await get_user_holdings(user_id, db)
        current_holding = holdings.get(order.stock_name, 0)
        
        # Check pending limit sells to ensure they don't lock or double sell
        if current_holding < order.qty:
            raise HTTPException(status_code=400, detail=f"Insufficient share holdings to sell. Attempted: {order.qty}, Held: {current_holding}")
            
        # Credit balance immediately if completed
        if order_status == "COMPLETED":
            user.virtual_balance = float(user.virtual_balance) + total_cost
            
        new_order = OrderDB(
            user_id=user_id,
            stock_name=order.stock_name,
            qty=order.qty,
            execution_price=execution_price,
            stop_loss=order.stop_loss,
            target_price=order.target_price,
            status=order_status,
            order_type="SELL",
            mode=f"Manual ({order.order_mode.capitalize()})"
        )
        db.add(new_order)
        
        action = f"Placed manual {order.order_mode.lower()} SELL of {order.qty} {order.stock_name} shares at Rs. {execution_price:.2f}."
        log = ActivityLogDB(user_id=user_id, action_text=action)
        db.add(log)
        
    else:
        raise HTTPException(status_code=400, detail="Invalid order type")
        
    await db.commit()
    
    # Notify sockets of balance updates
    await manager.send_personal_message({
        "type": "PROFILE_UPDATE",
        "balance": float(user.virtual_balance)
    }, user_id)
    
    return {"status": "success", "order_id": new_order.id, "balance": float(user.virtual_balance)}

@app.get("/api/user/activity")
async def get_activity_logs(user: UserDB = Depends(update_user_activity), db: AsyncSession = Depends(get_db)):
    user_id = user.id
    
    # Retrieve last 100 activity logs
    stmt = select(ActivityLogDB).where(ActivityLogDB.user_id == user_id).order_by(desc(ActivityLogDB.created_at)).limit(100)
    result = await db.execute(stmt)
    logs = result.scalars().all()
    
    # Retrieve order history
    stmt_orders = select(OrderDB).where(OrderDB.user_id == user_id).order_by(desc(OrderDB.created_at)).limit(100)
    result_orders = await db.execute(stmt_orders)
    orders = result_orders.scalars().all()
    
    return {
        "logs": [
            {
                "id": log.id,
                "action": log.action_text,
                "created_at": log.created_at
            } for log in logs
        ],
        "orders": [
            {
                "id": o.id,
                "stock": o.stock_name,
                "qty": o.qty,
                "price": float(o.execution_price),
                "stop_loss": float(o.stop_loss) if o.stop_loss else None,
                "target_price": float(o.target_price) if o.target_price else None,
                "status": o.status,
                "type": o.order_type,
                "mode": o.mode,
                "created_at": o.created_at
            } for o in orders
        ]
    }

@app.get("/api/user/report")
async def get_report_data(user: UserDB = Depends(update_user_activity), db: AsyncSession = Depends(get_db)):
    user_id = user.id
    
    # Fetch all orders of the user today
    today_start = datetime.combine(datetime.now().date(), time.min)
    stmt = select(OrderDB).where(
        and_(
            OrderDB.user_id == user_id,
            OrderDB.created_at >= today_start
        )
    ).order_by(OrderDB.created_at.asc())
    
    result = await db.execute(stmt)
    orders = result.scalars().all()
    
    balance = float(user.virtual_balance)
    
    report_items = []
    manual_count = 0
    auto_count = 0
    
    for idx, o in enumerate(orders, 1):
        is_manual = "Manual" in o.mode
        if is_manual:
            manual_count += 1
        else:
            auto_count += 1
            
        report_items.append({
            "trade_num": idx,
            "stock_name": o.stock_name,
            "qty": o.qty,
            "price": float(o.execution_price),
            "total_price": float(o.qty * o.execution_price),
            "mode": "Manual" if is_manual else "Automatic",
            "type": o.order_type,
            "created_at": o.created_at.strftime("%Y-%m-%d %H:%M:%S")
        })
        
    profit = balance - 5000.00
    
    return {
        "trades": report_items,
        "summary": {
            "total_trades": len(orders),
            "manual_trades": manual_count,
            "automatic_trades": auto_count,
            "profit": profit,
            "current_balance": balance
        }
    }

async def verify_admin(token: str, db: AsyncSession) -> UserDB:
    user = await update_user_activity(token, db)
    if user.email != "bhaweshji@gmail.com":
        raise HTTPException(status_code=403, detail="Access denied. Administrators only.")
    return user

@app.get("/api/admin/users")
async def admin_get_users(token: str = Query(...), db: AsyncSession = Depends(get_db)):
    await verify_admin(token, db)
    
    stmt = select(UserDB).order_by(UserDB.email.asc())
    result = await db.execute(stmt)
    users = result.scalars().all()
    
    return [
        {
            "id": u.id,
            "email": u.email,
            "balance": float(u.virtual_balance),
            "is_blocked": u.is_blocked,
            "last_login": u.last_login_at
        } for u in users
    ]

@app.post("/api/admin/block")
async def admin_toggle_block(user_id: str, is_blocked: bool, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    await verify_admin(token, db)
    
    result = await db.execute(select(UserDB).where(UserDB.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.email == "bhaweshji@gmail.com":
        raise HTTPException(status_code=400, detail="Cannot block the main admin account")
        
    user.is_blocked = is_blocked
    
    # Log administrative action
    action = f"User profile {'BLOCKED' if is_blocked else 'UNBLOCKED'} by administrator."
    log = ActivityLogDB(user_id=user_id, action_text=action)
    db.add(log)
    await db.commit()
    
    if is_blocked:
        # Instantly kick WebSocket session
        await manager.force_logout_user(user_id, reason="You have been blocked by the admin. Please contact admin.")
        
    return {"status": "success", "user_id": user_id, "is_blocked": is_blocked}

# 7. WebSocket Server endpoint for real-time tickers
@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    is_public = (token == "public")
    user_id = None
    
    if not is_public:
        try:
            # Validate JWT token
            payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
            user_id = payload.get("id")
        except jwt.PyJWTError:
            await websocket.close(code=4001, reason="Invalid verification token")
            return
            
        # Check if user is blocked in DB
        async with AsyncSessionLocal() as session:
            res = await session.execute(select(UserDB).where(UserDB.id == user_id))
            user = res.scalars().first()
            if not user or user.is_blocked:
                await websocket.close(code=4003, reason="Blocked user connection rejected")
                return
            # Update active timestamp at connection time
            user.last_active_at = datetime.now(timezone.utc)
            await session.commit()

    conn_id = user_id if not is_public else f"public-{id(websocket)}"
    await manager.connect(conn_id, websocket)
    
    # Send current static opening prices immediately
    await websocket.send_json({
        "type": "INITIAL_PRICES",
        "prices": market_prices,
        "open_prices": market_opening_prices
    })
    
    try:
        while True:
            # Keep connection alive, listen for any client messages (like keepalives)
            data = await websocket.receive_text()
            
            # If authenticated, update user activity on ping/message to keep session alive
            if not is_public:
                async with AsyncSessionLocal() as session:
                    res = await session.execute(select(UserDB).where(UserDB.id == user_id))
                    user = res.scalars().first()
                    if user:
                        # Check block status dynamically
                        if user.is_blocked:
                            await manager.force_logout_user(user_id, "Blocked by administrator")
                            break
                        user.last_active_at = datetime.now(timezone.utc)
                        await session.commit()
            
            # Send simple ping-pong
            await websocket.send_json({"type": "PONG"})
    except WebSocketDisconnect:
        manager.disconnect(conn_id)

# 8. Asynchronous Background Core Loop Services

# Loop 1: Ticker generation and Stop Loss check
async def price_generation_loop():
    await asyncio.sleep(5) # Let database create tables
    while True:
        try:
            db = AsyncSessionLocal()
            
            # 1. Update prices (70% probability)
            ticks_to_save = []
            now_time = datetime.now(timezone.utc)
            
            for stock in STOCKS:
                current_price = market_prices[stock]
                opening_price = market_opening_prices[stock]
                
                # Check if we should update price
                if random.random() < 0.70:
                    delta_percent = random.uniform(-0.001, 0.001)
                    new_price = current_price + (current_price * delta_percent)
                    
                    # Circuit breaker clipping (+/- 5% limit of opening price)
                    min_boundary = opening_price * 0.95
                    max_boundary = opening_price * 1.05
                    
                    if new_price < min_boundary:
                        new_price = min_boundary
                    elif new_price > max_boundary:
                        new_price = max_boundary
                        
                    market_prices[stock] = round(new_price, 2)
                    
                    # Queue DB record
                    tick = StockTickDB(
                        stock_name=stock,
                        price=market_prices[stock],
                        granularity="second",
                        created_at=now_time
                    )
                    db.add(tick)
            
            # Broadcast the updated price ticks to all sockets
            await manager.broadcast({
                "type": "TICK",
                "prices": market_prices,
                "time": now_time.isoformat()
            })
            
            # 2. Match active LIMIT and STOP LOSS orders
            # Retrieve all user profiles for active balance adjustments
            # Look up all OPEN orders
            stmt_open = select(OrderDB).where(OrderDB.status == "OPEN")
            res_open = await db.execute(stmt_open)
            open_orders = res_open.scalars().all()
            
            # Process Limit Orders
            for o in open_orders:
                curr_price = market_prices.get(o.stock_name)
                # Check if user blocked
                user_res = await db.execute(select(UserDB).where(UserDB.id == o.user_id))
                user = user_res.scalars().first()
                if not user or user.is_blocked:
                    continue
                    
                total_cost = o.qty * o.execution_price
                
                if o.order_type == "BUY":
                    # For Limit BUY to trigger, market price must drop below or hit limit_price
                    if curr_price <= float(o.execution_price):
                        # Validate balance again at trigger
                        if float(user.virtual_balance) >= total_cost:
                            user.virtual_balance = float(user.virtual_balance) - total_cost
                            o.status = "COMPLETED"
                            o.execution_price = curr_price # Execute at actual market price (could be slippage improved)
                            
                            # Add log
                            log = ActivityLogDB(
                                user_id=o.user_id,
                                action_text=f"Limit BUY order {o.id} executed for {o.qty} {o.stock_name} shares at market Rs. {curr_price:.2f}."
                            )
                            db.add(log)
                            await manager.send_personal_message({
                                "type": "ORDER_EXECUTED",
                                "message": f"Your Limit BUY of {o.qty} {o.stock_name} shares executed at Rs. {curr_price:.2f}!",
                                "balance": float(user.virtual_balance)
                            }, o.user_id)
                        else:
                            # Cancel limit order due to lack of funds
                            o.status = "CANCELLED"
                            log = ActivityLogDB(
                                user_id=o.user_id,
                                action_text=f"Limit BUY order {o.id} cancelled due to insufficient funds at execution threshold."
                            )
                            db.add(log)
                            await manager.send_personal_message({
                                "type": "ORDER_FAILED",
                                "message": f"Limit BUY of {o.stock_name} failed: Insufficient funds at execution threshold."
                            }, o.user_id)
                elif o.order_type == "SELL":
                    # For Limit SELL to trigger, market price must rise to or above limit_price
                    if curr_price >= float(o.execution_price):
                        # Validate holdings again at trigger
                        holdings = await get_user_holdings(o.user_id, db)
                        held_shares = holdings.get(o.stock_name, 0)
                        if held_shares >= o.qty:
                            user.virtual_balance = float(user.virtual_balance) + total_cost
                            o.status = "COMPLETED"
                            o.execution_price = curr_price
                            
                            log = ActivityLogDB(
                                user_id=o.user_id,
                                action_text=f"Limit SELL order {o.id} executed for {o.qty} {o.stock_name} shares at market Rs. {curr_price:.2f}."
                            )
                            db.add(log)
                            await manager.send_personal_message({
                                "type": "ORDER_EXECUTED",
                                "message": f"Your Limit SELL of {o.qty} {o.stock_name} shares executed at Rs. {curr_price:.2f}!",
                                "balance": float(user.virtual_balance)
                            }, o.user_id)
                        else:
                            o.status = "CANCELLED"
                            log = ActivityLogDB(
                                user_id=o.user_id,
                                action_text=f"Limit SELL order {o.id} cancelled: Insufficient shares in holdings at execution threshold."
                            )
                            db.add(log)
                            
            # Process Stop Loss triggers (Iterate through COMPLETED buy positions)
            # Find all BUY positions (holdings) that have a stop_loss threshold active
            # For simplicity: we fetch all COMPLETED BUY orders where stop_loss is NOT null and status is 'COMPLETED'
            # (If status is AUTO_CLOSED, it means stop loss was already triggered and resolved)
            stmt_sl = select(OrderDB).where(
                and_(
                    OrderDB.order_type == "BUY",
                    OrderDB.status == "COMPLETED",
                    OrderDB.stop_loss.isnot(None)
                )
            )
            res_sl = await db.execute(stmt_sl)
            sl_candidates = res_sl.scalars().all()
            
            for o in sl_candidates:
                curr_price = market_prices.get(o.stock_name)
                # If price drops to or below stop_loss
                if curr_price <= float(o.stop_loss):
                    user_res = await db.execute(select(UserDB).where(UserDB.id == o.user_id))
                    user = user_res.scalars().first()
                    if not user:
                        continue
                        
                    # Check if they still hold shares of this stock (to avoid executing stop losses on positions already manually sold)
                    holdings = await get_user_holdings(o.user_id, db)
                    held_shares = holdings.get(o.stock_name, 0)
                    
                    # Quantity to trigger is min of held shares and order quantity
                    qty_to_sell = min(o.qty, held_shares)
                    
                    if qty_to_sell > 0:
                        # Auto execute counter sell trade
                        cash_gain = qty_to_sell * curr_price
                        user.virtual_balance = float(user.virtual_balance) + cash_gain
                        
                        # Set original order as closed
                        o.status = "AUTO_CLOSED"
                        
                        # Add auto counter order
                        counter_order = OrderDB(
                            user_id=o.user_id,
                            stock_name=o.stock_name,
                            qty=qty_to_sell,
                            execution_price=curr_price,
                            status="COMPLETED",
                            order_type="SELL",
                            mode="Automatic (Stop Loss)"
                        )
                        db.add(counter_order)
                        
                        log = ActivityLogDB(
                            user_id=o.user_id,
                            action_text=f"STOP LOSS triggered on order {o.id}. Auto-sold {qty_to_sell} {o.stock_name} shares at Rs. {curr_price:.2f}."
                        )
                        db.add(log)
                        
                        await manager.send_personal_message({
                            "type": "STOP_LOSS_TRIGGERED",
                            "message": f"STOP LOSS triggered! Automatically sold {qty_to_sell} {o.stock_name} shares at Rs. {curr_price:.2f}!",
                            "balance": float(user.virtual_balance)
                        }, o.user_id)
                    else:
                        # User already sold the shares, just deactivate stop loss monitor state
                        o.status = "AUTO_CLOSED"
            
            # Process Target Price triggers (Iterate through COMPLETED buy positions)
            stmt_tp = select(OrderDB).where(
                and_(
                    OrderDB.order_type == "BUY",
                    OrderDB.status == "COMPLETED",
                    OrderDB.target_price.isnot(None)
                )
            )
            res_tp = await db.execute(stmt_tp)
            tp_candidates = res_tp.scalars().all()
            
            for o in tp_candidates:
                curr_price = market_prices.get(o.stock_name)
                # If price rises to or above target_price
                if curr_price >= float(o.target_price):
                    user_res = await db.execute(select(UserDB).where(UserDB.id == o.user_id))
                    user = user_res.scalars().first()
                    if not user:
                        continue
                        
                    # Check if they still hold shares of this stock
                    holdings = await get_user_holdings(o.user_id, db)
                    held_shares = holdings.get(o.stock_name, 0)
                    
                    qty_to_sell = min(o.qty, held_shares)
                    
                    if qty_to_sell > 0:
                        # Auto execute counter sell trade
                        cash_gain = qty_to_sell * curr_price
                        user.virtual_balance = float(user.virtual_balance) + cash_gain
                        
                        o.status = "AUTO_CLOSED"
                        
                        # Add auto counter order
                        counter_order = OrderDB(
                            user_id=o.user_id,
                            stock_name=o.stock_name,
                            qty=qty_to_sell,
                            execution_price=curr_price,
                            status="COMPLETED",
                            order_type="SELL",
                            mode="Automatic (Target Price)"
                        )
                        db.add(counter_order)
                        
                        log = ActivityLogDB(
                            user_id=o.user_id,
                            action_text=f"TARGET PRICE triggered on order {o.id}. Auto-sold {qty_to_sell} {o.stock_name} shares at Rs. {curr_price:.2f}."
                        )
                        db.add(log)
                        
                        await manager.send_personal_message({
                            "type": "ORDER_EXECUTED",
                            "message": f"TARGET PRICE triggered! Automatically sold {qty_to_sell} {o.stock_name} shares at Rs. {curr_price:.2f}!",
                            "balance": float(user.virtual_balance)
                        }, o.user_id)
                    else:
                        o.status = "AUTO_CLOSED"
            
            await db.commit()
            await db.close()
            
        except Exception as e:
            print(f"Error in background price loop: {e}")
            
        await asyncio.sleep(1.0)

# Loop 2: Downsampling hourly and 6-hourly to keep DB under 30k rows
async def downsampling_loop():
    await asyncio.sleep(10)
    while True:
        try:
            # We run checks every 10 minutes to verify if the top of the hour or 6-hour interval is crossed.
            now = datetime.now(timezone.utc)
            
            # 1. Hourly aggregation check (Run at minute 0)
            # Find all records with granularity='second' from the past hour, calculate 1-minute averages, delete original, insert minutes
            # To avoid duplicate runs during the same minute, we track last processed hour
            # Check db count to prune
            db = AsyncSessionLocal()
            
            # Prune safety checks: Keep database size capped under 30,000 rows
            cnt_stmt = select(func.count(StockTickDB.id))
            cnt_res = await db.execute(cnt_stmt)
            total_rows = cnt_res.scalar() or 0
            
            if total_rows > 25000:
                # Delete oldest 5000 'second' records
                oldest_stmt = select(StockTickDB.id).where(StockTickDB.granularity == "second").order_by(StockTickDB.created_at.asc()).limit(5000)
                oldest_res = await db.execute(oldest_stmt)
                ids_to_del = [r for r in oldest_res.scalars().all()]
                if ids_to_del:
                    await db.execute(StockTickDB.__table__.delete().where(StockTickDB.id.in_(ids_to_del)))
                    await db.commit()
            
            # Hourly Consolidation:
            # Check if there are 'second' records older than 1 hour, aggregate them to minutes
            one_hour_ago = now - timedelta(hours=1)
            
            # Query oldest second ticks
            oldest_tick_stmt = select(StockTickDB.created_at).where(StockTickDB.granularity == "second").order_by(StockTickDB.created_at.asc()).limit(1)
            oldest_tick_res = await db.execute(oldest_tick_stmt)
            oldest_time = oldest_tick_res.scalar()
            
            # If we have seconds ticks older than 1 hour, downsample in hourly blocks
            if oldest_time and oldest_time < one_hour_ago:
                # We aggregate from oldest_time to one_hour_ago
                # Downsampling logic: group by stock_name and truncate time to minute
                # SQLite date/time manipulation vs Postgres compatibility:
                # We can load them into memory to execute safely regardless of DB engine
                stmt_sec = select(StockTickDB).where(
                    and_(
                        StockTickDB.granularity == "second",
                        StockTickDB.created_at < one_hour_ago
                    )
                ).order_by(StockTickDB.created_at.asc())
                
                sec_res = await db.execute(stmt_sec)
                sec_ticks = sec_res.scalars().all()
                
                if sec_ticks:
                    # Group in-memory
                    minute_buckets = {} # (stock, minute_dt) -> list of prices
                    for t in sec_ticks:
                        # Truncate created_at to minute boundary
                        min_dt = t.created_at.replace(second=0, microsecond=0)
                        key = (t.stock_name, min_dt)
                        if key not in minute_buckets:
                            minute_buckets[key] = []
                        minute_buckets[key].append(float(t.price))
                        
                    # Insert minute averages
                    for (stock, dt), prices in minute_buckets.items():
                        avg_price = sum(prices) / len(prices)
                        avg_tick = StockTickDB(
                            stock_name=stock,
                            price=round(avg_price, 2),
                            granularity="minute",
                            created_at=dt
                        )
                        db.add(avg_tick)
                        
                    # Delete consolidated second ticks
                    ids_to_clean = [t.id for t in sec_ticks]
                    # Chunk deletions to avoid SQL query size limits
                    chunk_size = 900
                    for i in range(0, len(ids_to_clean), chunk_size):
                        chunk = ids_to_clean[i:i+chunk_size]
                        await db.execute(StockTickDB.__table__.delete().where(StockTickDB.id.in_(chunk)))
                        
                    await db.commit()
                    
            # 6-Hour Consolidation:
            # Query minute ticks older than 6 hours and aggregate to 5-minute blocks
            six_hours_ago = now - timedelta(hours=6)
            oldest_min_stmt = select(StockTickDB.created_at).where(StockTickDB.granularity == "minute").order_by(StockTickDB.created_at.asc()).limit(1)
            oldest_min_res = await db.execute(oldest_min_stmt)
            oldest_min_time = oldest_min_res.scalar()
            
            if oldest_min_time and oldest_min_time < six_hours_ago:
                stmt_min = select(StockTickDB).where(
                    and_(
                        StockTickDB.granularity == "minute",
                        StockTickDB.created_at < six_hours_ago
                    )
                ).order_by(StockTickDB.created_at.asc())
                
                min_res = await db.execute(stmt_min)
                min_ticks = min_res.scalars().all()
                
                if min_ticks:
                    five_min_buckets = {} # (stock, 5min_dt) -> list of prices
                    for t in min_ticks:
                        # Truncate to 5-minute boundaries
                        min_val = (t.created_at.minute // 5) * 5
                        five_min_dt = t.created_at.replace(minute=min_val, second=0, microsecond=0)
                        key = (t.stock_name, five_min_dt)
                        if key not in five_min_buckets:
                            five_min_buckets[key] = []
                        five_min_buckets[key].append(float(t.price))
                        
                    for (stock, dt), prices in five_min_buckets.items():
                        avg_price = sum(prices) / len(prices)
                        avg_tick = StockTickDB(
                            stock_name=stock,
                            price=round(avg_price, 2),
                            granularity="5minute",
                            created_at=dt
                        )
                        db.add(avg_tick)
                        
                    ids_to_clean = [t.id for t in min_ticks]
                    chunk_size = 900
                    for i in range(0, len(ids_to_clean), chunk_size):
                        chunk = ids_to_clean[i:i+chunk_size]
                        await db.execute(StockTickDB.__table__.delete().where(StockTickDB.id.in_(chunk)))
                        
                    await db.commit()
            
            await db.close()
            
        except Exception as e:
            print(f"Error in downsampling loop: {e}")
            
        # Run loop check every 5 minutes
        await asyncio.sleep(300)

# Loop 3: Balance warning (11:30 PM+), Force close (11:55 PM), Reset (12:00 AM)
async def midnight_reset_loop():
    await asyncio.sleep(15)
    last_warning_time = None
    last_critical_time = None
    last_force_close_day = None
    last_reset_day = None
    
    while True:
        try:
            # We track time in local machine zone or custom server zone.
            # Let's read hour, minute, and day in current local timezone to align with user schedule.
            now = datetime.now()
            today_date = now.date()
            h, m = now.hour, now.minute
            
            # A. 11:30 PM to 11:45 PM -> Warning broadcast every 5 mins
            if h == 23 and 30 <= m < 45:
                # Trigger warning only once every 5 minutes
                time_key = f"{h}:{m - (m % 5)}"
                if last_warning_time != time_key:
                    mins_left = 60 - m
                    await manager.broadcast({
                        "type": "ALERT_WARNING",
                        "message": f"Daily Balance Reset Warning: The day is ending in {mins_left} minutes. All balances will reset to 5000.00 INR at midnight. Open trades will auto-close at 11:55 PM."
                    })
                    last_warning_time = time_key
            
            # B. 11:45 PM to 11:55 PM -> Critical alarms every 5 mins
            elif h == 23 and 45 <= m < 55:
                time_key = f"{h}:{m - (m % 5)}"
                if last_critical_time != time_key:
                    mins_left = 55 - m
                    await manager.broadcast({
                        "type": "ALERT_CRITICAL",
                        "message": f"CRITICAL LIMIT ALARM: All open stock positions will be FORCE-CLOSED in {mins_left} minutes!"
                    })
                    last_critical_time = time_key
                    
            # C. 11:55 PM -> Auto close all active positions
            elif h == 23 and m == 55 and last_force_close_day != today_date:
                db = AsyncSessionLocal()
                # Find all users
                users_res = await db.execute(select(UserDB))
                all_users = users_res.scalars().all()
                
                for u in all_users:
                    # Get user holdings
                    holdings = await get_user_holdings(u.id, db)
                    
                    for stock, qty in holdings.items():
                        if qty > 0:
                            current_price = market_prices[stock]
                            credit = qty * current_price
                            u.virtual_balance = float(u.virtual_balance) + credit
                            
                            # Log close order
                            close_order = OrderDB(
                                user_id=u.id,
                                stock_name=stock,
                                qty=qty,
                                execution_price=current_price,
                                status="COMPLETED",
                                order_type="SELL",
                                mode="Automatic (Force Closed)"
                            )
                            db.add(close_order)
                            
                            log = ActivityLogDB(
                                user_id=u.id,
                                action_text=f"Force closed {qty} shares of {stock} at Rs. {current_price:.2f} due to market closing limit."
                            )
                            db.add(log)
                            
                await db.commit()
                await db.close()
                
                await manager.broadcast({
                    "type": "ALERT_INFO",
                    "message": "Market Closed: All active stock holdings have been force-closed at prevailing market rates."
                })
                last_force_close_day = today_date
                
            # D. 12:00 AM Midnight -> Reset all virtual balances to 5000.00
            elif h == 0 and m == 0 and last_reset_day != today_date:
                db = AsyncSessionLocal()
                
                # Global update statement
                users_res = await db.execute(select(UserDB))
                all_users = users_res.scalars().all()
                for u in all_users:
                    u.virtual_balance = 5000.00
                    # Add reset log
                    log = ActivityLogDB(
                        user_id=u.id,
                        action_text="Daily balance reset: balance set to exactly 5,000.00 INR."
                    )
                    db.add(log)
                    
                # Reset circuit breaker baselines for new day
                for stock in STOCKS:
                    market_opening_prices[stock] = market_prices[stock]
                    
                await db.commit()
                await db.close()
                
                # Broadcast global update
                await manager.broadcast({
                    "type": "DAILY_RESET",
                    "balance": 5000.00,
                    "message": "Daily reset complete! Your balance is reset to exactly 5,000.00 INR."
                })
                last_reset_day = today_date
                
        except Exception as e:
            print(f"Error in midnight reset loop: {e}")
            
        # Check every 10 seconds
        await asyncio.sleep(10)
