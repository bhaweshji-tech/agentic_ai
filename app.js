// Virtual Stock Trading Simulator - Frontend Controller

const isGitHubPages = window.location.hostname.includes("github.io");
const API_BASE = isGitHubPages ? "http://localhost:8000" : (window.location.protocol + "//" + window.location.host);
const WS_BASE = isGitHubPages ? "ws://localhost:8000" : ((window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host);

// Firebase Configuration - Put your Firebase Credentials from console here!
// By default, if credentials are unchanged, it falls back to sandbox mock sign-in.
const firebaseConfig = {
  apiKey: "AIzaSyBnDBFx2UXRVIl-XnXZojPq00qIZuFX830",
  authDomain: "myaitraining-4326a.firebaseapp.com",
  projectId: "myaitraining-4326a",
  storageBucket: "myaitraining-4326a.firebasestorage.app",
  messagingSenderId: "451753280099",
  appId: "1:451753280099:web:8f0d5a873875bdbe4e2e56",
  measurementId: "G-9Q6F7GQSXP"
};

// Check if user has initialized Firebase
let firebaseAuth = null;
try {
    if (typeof firebase !== 'undefined') {
        if (firebase.apps.length === 0) {
            firebase.initializeApp(firebaseConfig);
        }
        firebaseAuth = firebase.auth();
    }
} catch (e) {
    console.warn("Firebase Auth failed to load. Running in simulated fallback mode.", e);
}

// Application State
let state = {
    token: localStorage.getItem("sim_token") || null,
    user: null,
    activeStock: "STOCK_A",
    prices: { STOCK_A: 100.0, STOCK_B: 250.0, STOCK_C: 500.0, STOCK_D: 1200.0 },
    openPrices: { STOCK_A: 100.0, STOCK_B: 250.0, STOCK_C: 500.0, STOCK_D: 1200.0 },
    holdings: {},
    orders: [],
    logs: [],
    tradesToday: [],
    socket: null,
    chart: null,
    chartData: {
        labels: [],
        prices: []
    },
    tradeType: "BUY" // BUY or SELL
};

// Document Init
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupEventListeners();
    initCountdownTimer();
    
    // Check if token exists
    if (state.token) {
        verifySession();
    } else {
        showPanel("auth-panel");
    }
}

// 1. Panel Views Navigation
function showPanel(panelId) {
    document.getElementById("auth-panel").classList.add("hidden");
    document.getElementById("portal-panel").classList.add("hidden");
    document.getElementById("blocked-overlay").classList.add("hidden");
    
    document.getElementById(panelId).classList.remove("hidden");
}

function verifySession() {
    fetch(`${API_BASE}/api/user/profile?token=${state.token}`)
        .then(async res => {
            if (res.status === 200) {
                const data = await res.json();
                state.user = data;
                
                if (data.is_blocked) {
                    showBlockedScreen("You have been blocked by the admin. Please contact admin.");
                    return;
                }
                
                setupDashboardHeader();
                showPanel("portal-panel");
                connectWebSocket();
                initializeChart();
                loadUserData();
            } else {
                logout();
            }
        })
        .catch(() => {
            logout();
        });
}

function syncUserProfile(uid, email) {
    const errorAlert = document.getElementById("auth-error-alert");
    errorAlert.classList.add("hidden");
    
    fetch(`${API_BASE}/api/auth/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: uid, email: email })
    })
    .then(async res => {
        const data = await res.json();
        if (res.status === 200) {
            localStorage.setItem("sim_token", data.access_token);
            state.token = data.access_token;
            verifySession();
        } else {
            errorAlert.innerText = data.detail || "Profile synchronization error.";
            errorAlert.classList.remove("hidden");
        }
    })
    .catch(() => {
        errorAlert.innerText = "Failed to synchronize profile session with backend server.";
        errorAlert.classList.remove("hidden");
    });
}

function setupDashboardHeader() {
    document.getElementById("header-user-email").innerText = state.user.email;
    document.getElementById("header-user-balance").innerText = `Rs. ${state.user.virtual_balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    // Admin Toggle
    if (state.user.email === "bhaweshji@gmail.com") {
        document.getElementById("admin-indicator").classList.remove("hidden");
        document.getElementById("btn-admin-panel").classList.remove("hidden");
    } else {
        document.getElementById("admin-indicator").classList.add("hidden");
        document.getElementById("btn-admin-panel").classList.add("hidden");
    }
}

function logout() {
    localStorage.removeItem("sim_token");
    state.token = null;
    state.user = null;
    if (state.socket) {
        state.socket.close();
        state.socket = null;
    }
    showPanel("auth-panel");
}

function showBlockedScreen(msg) {
    document.getElementById("blocked-screen-msg").innerText = msg;
    showPanel("blocked-overlay");
}

// 2. Auth Actions (Login/Signup toggle and submission)
function setupEventListeners() {
    // Switch login/signup forms
    const switchBtn = document.getElementById("auth-switch-btn");
    const switchText = document.getElementById("auth-switch-text");
    const authTitle = document.getElementById("auth-title");
    const submitBtn = document.getElementById("auth-submit-btn");
    
    let isLoginMode = true;
    
    switchBtn.addEventListener("click", (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        
        const googleBtn = document.getElementById("btn-google-login");
        
        if (isLoginMode) {
            authTitle.innerText = "Welcome back";
            submitBtn.innerText = "Sign In";
            googleBtn.innerHTML = `
                <svg class="w-4 h-4" viewBox="0 0 24 24"><path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.859-3.578-7.859-8s3.529-8 7.859-8c2.46 0 4.105 1.025 5.047 1.926l3.245-3.125C18.29 1.926 15.485 1 12.24 1 6.033 1 1 6.033 1 12.24s5.033 11.24 11.24 11.24c6.478 0 10.793-4.537 10.793-10.985 0-.74-.08-1.305-.18-1.865h-10.613z"/></svg>
                Sign In with Google
            `;
            switchText.innerText = "Don't have an account?";
            switchBtn.innerText = "Sign Up";
        } else {
            authTitle.innerText = "Create Account";
            submitBtn.innerText = "Register";
            googleBtn.innerHTML = `
                <svg class="w-4 h-4" viewBox="0 0 24 24"><path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.859-3.578-7.859-8s3.529-8 7.859-8c2.46 0 4.105 1.025 5.047 1.926l3.245-3.125C18.29 1.926 15.485 1 12.24 1 6.033 1 1 6.033 1 12.24s5.033 11.24 11.24 11.24c6.478 0 10.793-4.537 10.793-10.985 0-.74-.08-1.305-.18-1.865h-10.613z"/></svg>
                Sign Up with Google
            `;
            switchText.innerText = "Already have an account?";
            switchBtn.innerText = "Sign In";
        }
        document.getElementById("auth-error-alert").classList.add("hidden");
    });
    
    // Submit Auth Form
    document.getElementById("auth-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const email = document.getElementById("auth-email").value.trim();
        const password = document.getElementById("auth-password").value;
        const errorAlert = document.getElementById("auth-error-alert");
        
        errorAlert.classList.add("hidden");
        
        const endpoint = isLoginMode ? "/api/auth/login" : "/api/auth/register";
        
        fetch(`${API_BASE}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        })
        .then(async res => {
            const data = await res.json();
            if (res.status === 200) {
                localStorage.setItem("sim_token", data.access_token);
                state.token = data.access_token;
                verifySession();
            } else {
                errorAlert.innerText = data.detail || "Authentication request failed.";
                errorAlert.classList.remove("hidden");
            }
        })
        .catch(() => {
            errorAlert.innerText = "Server connection lost. Try again later.";
            errorAlert.classList.remove("hidden");
        });
    });
    
    // Google OAuth Sign-In via Firebase
    document.getElementById("btn-google-login").addEventListener("click", () => {
        const errorAlert = document.getElementById("auth-error-alert");
        errorAlert.classList.add("hidden");

        const hasValidConfig = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("FakeKeyPlaceholder");
        
        if (firebaseAuth && hasValidConfig) {
            const provider = new firebase.auth.GoogleAuthProvider();
            firebaseAuth.signInWithPopup(provider)
                .then((result) => {
                    const user = result.user;
                    syncUserProfile(user.uid, user.email);
                })
                .catch((error) => {
                    errorAlert.innerText = error.message || "Google Sign-In failed.";
                    errorAlert.classList.remove("hidden");
                });
        } else {
            // Out-of-the-box simulated fallback for instant developer evaluation
            const mockEmail = prompt("Simulating Google login sandbox popup!\nEnter your Google email address:", "bhaweshji@gmail.com");
            if (mockEmail && mockEmail.trim() !== "") {
                const cleanEmail = mockEmail.trim();
                const mockUid = "mock-uid-" + cleanEmail.replace(/[^a-zA-Z0-9]/g, "");
                syncUserProfile(mockUid, cleanEmail);
            }
        }
    });
    
    // Logout trigger
    document.getElementById("btn-logout").addEventListener("click", logout);
    document.getElementById("btn-blocked-logout").addEventListener("click", logout);
    
    // Stock Selection Cards Click
    document.querySelectorAll("#stocks-cards-container > div").forEach(card => {
        card.addEventListener("click", () => {
            const stock = card.getAttribute("data-stock");
            selectActiveStock(stock);
        });
    });
    
    // Limit Mode Toggle Form field
    document.getElementById("trade-mode").addEventListener("change", (e) => {
        const limitGroup = document.getElementById("trade-limit-price-group");
        if (e.target.value === "LIMIT") {
            limitGroup.classList.remove("hidden");
            document.getElementById("trade-limit-price").setAttribute("required", "true");
        } else {
            limitGroup.classList.add("hidden");
            document.getElementById("trade-limit-price").removeAttribute("required");
        }
        calculateTradeEstCosts();
    });
    
    // BUY / SELL switch form
    document.getElementById("btn-trade-buy").addEventListener("click", () => {
        setTradeType("BUY");
    });
    document.getElementById("btn-trade-sell").addEventListener("click", () => {
        setTradeType("SELL");
    });
    
    // Est Costs calculations on values input
    document.getElementById("trade-qty").addEventListener("input", calculateTradeEstCosts);
    document.getElementById("trade-limit-price").addEventListener("input", calculateTradeEstCosts);
    
    // Trade Form Submit
    document.getElementById("trade-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const stock_name = state.activeStock;
        const qty = parseInt(document.getElementById("trade-qty").value);
        const order_type = state.tradeType;
        const order_mode = document.getElementById("trade-mode").value;
        const limit_price = order_mode === "LIMIT" ? parseFloat(document.getElementById("trade-limit-price").value) : null;
        const stop_loss = document.getElementById("trade-stop-loss").value ? parseFloat(document.getElementById("trade-stop-loss").value) : null;
        
        const errorBox = document.getElementById("trade-error-msg");
        errorBox.classList.add("hidden");
        
        fetch(`${API_BASE}/api/orders/place?token=${state.token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                stock_name,
                qty,
                order_type,
                order_mode,
                limit_price,
                stop_loss
            })
        })
        .then(async res => {
            const data = await res.json();
            if (res.status === 200) {
                // Success!
                document.getElementById("trade-qty").value = "";
                document.getElementById("trade-limit-price").value = "";
                document.getElementById("trade-stop-loss").value = "";
                calculateTradeEstCosts();
                
                // Show floating alerts if manual execute
                showInfoToast(order_type === "BUY" ? "BUY Position Logged!" : "SELL Position Logged!");
                loadUserData();
            } else {
                errorBox.innerText = data.detail || "Order execution rejected.";
                errorBox.classList.remove("hidden");
            }
        })
        .catch(() => {
            errorBox.innerText = "Server connection timeout.";
            errorBox.classList.remove("hidden");
        });
    });
    
    // Tab switching controls
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            // Remove active classes
            document.querySelectorAll(".tab-btn").forEach(b => {
                b.classList.remove("border-b-2", "border-blue-500", "text-blue-500");
                b.classList.add("text-gray-400");
            });
            document.querySelectorAll(".tab-content").forEach(c => {
                c.classList.add("hidden");
                c.classList.remove("block");
            });
            
            // Add to active
            btn.classList.add("border-b-2", "border-blue-500", "text-blue-500");
            btn.classList.remove("text-gray-400");
            
            const targetTab = btn.getAttribute("data-tab");
            document.getElementById(targetTab).classList.remove("hidden");
            document.getElementById(targetTab).classList.add("block");
        });
    });
    
    // Download CSV
    document.getElementById("btn-download-csv").addEventListener("click", downloadTradeCSVReport);
    
    // Admin buttons triggers
    document.getElementById("btn-admin-panel").addEventListener("click", openAdminPanel);
    document.getElementById("btn-close-admin").addEventListener("click", closeAdminPanel);
    
    // Fetch History manual button trigger
    document.getElementById("btn-fetch-history").addEventListener("click", fetchSelectedHistoricalData);
}

// 3. WebSocket Real-time Tickers Integration
function connectWebSocket() {
    if (state.socket) {
        state.socket.close();
    }
    
    state.socket = new WebSocket(`${WS_BASE}/ws/${state.token}`);
    
    state.socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        switch (msg.type) {
            case "INITIAL_PRICES":
                state.prices = msg.prices;
                state.openPrices = msg.open_prices;
                STOCKS.forEach(stock => {
                    document.getElementById(`open-${stock}`).innerText = `Rs. ${msg.open_prices[stock].toFixed(2)}`;
                    updateStockCardUI(stock, msg.prices[stock]);
                });
                break;
                
            case "TICK":
                const prevPrices = { ...state.prices };
                state.prices = msg.prices;
                
                // Update stock card UI
                STOCKS.forEach(stock => {
                    if (prevPrices[stock] !== msg.prices[stock]) {
                        const isUp = msg.prices[stock] > prevPrices[stock];
                        flashStockCardBorder(stock, isUp);
                    }
                    updateStockCardUI(stock, msg.prices[stock]);
                });
                
                // Add live point to chart if active stock ticked and granularity is 1s
                const activeGran = document.getElementById("chart-granularity").value;
                if (activeGran === "second") {
                    const tickTime = new Date(msg.time);
                    const formattedTime = formatTimeHHMMSS(tickTime);
                    const priceVal = msg.prices[state.activeStock];
                    
                    appendTickToChart(formattedTime, priceVal);
                }
                
                // Update form rates
                updateSummaryCurrentPrice();
                break;
                
            case "PROFILE_UPDATE":
                state.user.virtual_balance = msg.balance;
                setupDashboardHeader();
                break;
                
            case "ORDER_EXECUTED":
                showSuccessToast(msg.message);
                state.user.virtual_balance = msg.balance;
                setupDashboardHeader();
                loadUserData();
                break;
                
            case "STOP_LOSS_TRIGGERED":
                showWarningToast(msg.message);
                state.user.virtual_balance = msg.balance;
                setupDashboardHeader();
                loadUserData();
                break;
                
            case "ALERT_WARNING":
                showSystemNotificationBanner(msg.message, "warning");
                break;
                
            case "ALERT_CRITICAL":
                showSystemNotificationBanner(msg.message, "critical");
                break;
                
            case "ALERT_INFO":
                showSystemNotificationBanner(msg.message, "info");
                break;
                
            case "DAILY_RESET":
                showWarningToast(msg.message);
                state.user.virtual_balance = msg.balance;
                setupDashboardHeader();
                loadUserData();
                break;
                
            case "FORCE_LOGOUT":
                showBlockedScreen(msg.reason);
                break;
        }
    };
    
    state.socket.onclose = (e) => {
        console.log("WebSocket connection closed: ", e.reason);
    };
}

// Sparkline/Card Visual Updates
function updateStockCardUI(stock, price) {
    const priceEl = document.getElementById(`price-${stock}`);
    const trendEl = document.getElementById(`trend-${stock}`);
    
    priceEl.innerText = `Rs. ${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const opening = state.openPrices[stock] || price;
    const diff = price - opening;
    const pct = (diff / opening) * 100;
    
    trendEl.innerText = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
    
    if (pct > 0) {
        trendEl.className = "price-indicator text-xs font-bold font-mono px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-500/20";
    } else if (pct < 0) {
        trendEl.className = "price-indicator text-xs font-bold font-mono px-2 py-0.5 rounded bg-red-950/40 text-red-400 border border-red-500/20";
    } else {
        trendEl.className = "price-indicator text-xs font-bold font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700/50";
    }
}

function flashStockCardBorder(stock, isUp) {
    const card = document.getElementById(`card-${stock}`);
    const flashClass = isUp ? "price-flash-up" : "price-flash-down";
    
    card.classList.add(flashClass);
    setTimeout(() => {
        card.classList.remove(flashClass);
    }, 800);
}

// 4. Select Active Stock tabs
function selectActiveStock(stock) {
    state.activeStock = stock;
    
    // Highlight Card
    document.querySelectorAll("#stocks-cards-container > div").forEach(card => {
        card.classList.remove("active-stock-card", "border-blue-500/50");
    });
    
    const selectedCard = document.getElementById(`card-${stock}`);
    selectedCard.classList.add("active-stock-card", "border-blue-500/50");
    
    // Update terminal displaying names
    document.getElementById("trade-stock-display").value = stock;
    document.getElementById("chart-active-stock-name").innerText = stock;
    
    updateSummaryCurrentPrice();
    fetchSelectedHistoricalData();
}

// 5. Execution forms computations
function setTradeType(type) {
    state.tradeType = type;
    const buyBtn = document.getElementById("btn-trade-buy");
    const sellBtn = document.getElementById("btn-trade-sell");
    const submitBtn = document.getElementById("btn-submit-order");
    
    if (type === "BUY") {
        buyBtn.className = "py-2 text-xs font-bold rounded-md transition-colors text-center text-teal-400 bg-teal-950/40 border border-teal-500/20";
        sellBtn.className = "py-2 text-xs font-bold rounded-md transition-colors text-center text-gray-400 hover:text-red-400";
        submitBtn.className = "w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-lg text-xs transition-colors shadow-lg shadow-teal-600/20 uppercase tracking-wider";
        submitBtn.innerText = "Execute BUY Order";
    } else {
        sellBtn.className = "py-2 text-xs font-bold rounded-md transition-colors text-center text-red-400 bg-red-950/40 border border-red-500/20";
        buyBtn.className = "py-2 text-xs font-bold rounded-md transition-colors text-center text-gray-400 hover:text-teal-400";
        submitBtn.className = "w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg text-xs transition-colors shadow-lg shadow-red-600/20 uppercase tracking-wider";
        submitBtn.innerText = "Execute SELL Order";
    }
    calculateTradeEstCosts();
}

function updateSummaryCurrentPrice() {
    const rate = state.prices[state.activeStock] || 100.00;
    document.getElementById("summary-current-price").innerText = `Rs. ${rate.toFixed(2)}`;
    calculateTradeEstCosts();
}

function calculateTradeEstCosts() {
    const rate = state.prices[state.activeStock] || 100.00;
    const qtyInput = document.getElementById("trade-qty").value;
    const qty = parseInt(qtyInput) || 0;
    const mode = document.getElementById("trade-mode").value;
    const limitPriceInput = document.getElementById("trade-limit-price").value;
    
    const activePrice = mode === "LIMIT" && limitPriceInput ? parseFloat(limitPriceInput) : rate;
    const estCost = qty * activePrice;
    
    document.getElementById("summary-est-cost").innerText = `Rs. ${estCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    if (state.user) {
        const balance = state.user.virtual_balance;
        let postBalance = balance;
        
        if (state.tradeType === "BUY") {
            postBalance = balance - estCost;
        } else {
            postBalance = balance + estCost;
        }
        
        const postBalanceEl = document.getElementById("summary-post-balance");
        postBalanceEl.innerText = `Rs. ${postBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        if (postBalance < 0 && state.tradeType === "BUY") {
            postBalanceEl.className = "font-mono text-red-500 font-semibold";
        } else {
            postBalanceEl.className = "font-mono text-teal-400 font-semibold";
        }
    }
}

// 6. User Portfolio updates & UI table bindings
function loadUserData() {
    // 1. Fetch user profile
    fetch(`${API_BASE}/api/user/profile?token=${state.token}`)
        .then(res => res.json())
        .then(data => {
            state.user = data;
            setupDashboardHeader();
        });

    // 2. Fetch activity logs and order history
    fetch(`${API_BASE}/api/user/activity?token=${state.token}`)
        .then(res => res.json())
        .then(data => {
            state.orders = data.orders;
            state.logs = data.logs;
            renderOrdersTable();
            renderLogsTable();
        });

    // 3. Fetch holdings
    fetch(`${API_BASE}/api/orders/holdings?token=${state.token}`)
        .then(res => res.json())
        .then(data => {
            state.holdings = data;
            renderHoldingsTable();
        });

    // 4. Fetch daily report card
    fetch(`${API_BASE}/api/user/report?token=${state.token}`)
        .then(res => res.json())
        .then(data => {
            state.tradesToday = data.trades;
            renderReportCardTable(data);
        });
}

function renderHoldingsTable() {
    const tbody = document.getElementById("holdings-table-body");
    tbody.innerHTML = "";
    
    let hasHoldings = false;
    
    STOCKS.forEach(stock => {
        const qty = state.holdings[stock] || 0;
        if (qty > 0) {
            hasHoldings = true;
            const marketPrice = state.prices[stock] || 0;
            const totalValue = qty * marketPrice;
            
            const tr = document.createElement("tr");
            tr.className = "border-b border-borderBlur/30 hover:bg-gray-800/10 text-xs";
            tr.innerHTML = `
                <td class="py-3.5 font-bold text-white">${stock}</td>
                <td class="py-3.5 font-mono font-medium">${qty}</td>
                <td class="py-3.5 font-mono">Rs. ${marketPrice.toFixed(2)}</td>
                <td class="py-3.5 font-bold font-mono text-teal-400">Rs. ${totalValue.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                <td class="py-3.5 text-right">
                    <button class="bg-red-950/40 hover:bg-red-900/50 border border-red-500/20 text-red-400 font-bold px-3 py-1.5 rounded transition-colors text-[10px]" onclick="prefillSellForm('${stock}', ${qty})">
                        LIQUIDATE ALL
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });
    
    if (!hasHoldings) {
        tbody.innerHTML = `
            <tr class="border-b border-borderBlur/30 text-gray-400">
                <td colspan="5" class="py-4 text-center">No active stock holdings. Start trading above!</td>
            </tr>
        `;
    }
}

function prefillSellForm(stock, qty) {
    selectActiveStock(stock);
    setTradeType("SELL");
    document.getElementById("trade-qty").value = qty;
    document.getElementById("trade-mode").value = "MARKET";
    document.getElementById("trade-limit-price-group").classList.add("hidden");
    document.getElementById("trade-limit-price").removeAttribute("required");
    document.getElementById("trade-form").scrollIntoView({ behavior: "smooth" });
    calculateTradeEstCosts();
}

function renderOrdersTable() {
    const tbody = document.getElementById("orders-table-body");
    tbody.innerHTML = "";
    
    if (state.orders.length === 0) {
        tbody.innerHTML = `
            <tr class="border-b border-borderBlur/30 text-gray-400">
                <td colspan="9" class="py-4 text-center">No order records found.</td>
            </tr>
        `;
        return;
    }
    
    state.orders.forEach(o => {
        const typeClass = o.type === "BUY" ? "text-teal-400 font-bold" : "text-red-400 font-bold";
        let statusClass = "text-yellow-500 font-semibold";
        if (o.status === "COMPLETED") statusClass = "text-emerald-400 font-bold";
        else if (o.status === "AUTO_CLOSED") statusClass = "text-purple-400 font-semibold";
        else if (o.status === "CANCELLED") statusClass = "text-gray-500";
        
        const timestamp = new Date(o.created_at).toLocaleString();
        
        const tr = document.createElement("tr");
        tr.className = "border-b border-borderBlur/30 hover:bg-gray-800/10 text-xs";
        tr.innerHTML = `
            <td class="py-3 font-mono text-[10px] text-gray-500">${o.id}</td>
            <td class="py-3 font-bold text-white">${o.stock}</td>
            <td class="py-3 ${typeClass}">${o.type}</td>
            <td class="py-3 font-mono font-medium">${o.qty}</td>
            <td class="py-3 font-mono">Rs. ${o.price.toFixed(2)}</td>
            <td class="py-3 font-mono text-gray-400">${o.stop_loss ? 'Rs. ' + o.stop_loss.toFixed(2) : '-'}</td>
            <td class="py-3 text-[11px] text-gray-400">${o.mode}</td>
            <td class="py-3 text-[11px] ${statusClass}">${o.status}</td>
            <td class="py-3 text-gray-400">${timestamp}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderLogsTable() {
    const container = document.getElementById("activity-logs-container");
    container.innerHTML = "";
    
    if (state.logs.length === 0) {
        container.innerHTML = `<p class="text-center py-4 text-gray-500 font-sans">No activity logs recorded today.</p>`;
        return;
    }
    
    state.logs.forEach(l => {
        const timeStr = new Date(l.created_at).toLocaleTimeString();
        const p = document.createElement("p");
        p.className = "py-1.5 border-b border-borderBlur/20 last:border-b-0 hover:text-white";
        p.innerHTML = `<span class="text-gray-500 font-sans mr-2">[${timeStr}]</span> ${l.action}`;
        container.appendChild(p);
    });
}

function renderReportCardTable(data) {
    const tbody = document.getElementById("report-table-body");
    tbody.innerHTML = "";
    
    if (data.trades.length === 0) {
        tbody.innerHTML = `
            <tr class="border-b border-borderBlur/30 text-gray-400">
                <td colspan="8" class="py-4 text-center">No trades logged in today's session.</td>
            </tr>
        `;
        return;
    }
    
    data.trades.forEach(t => {
        const typeClass = t.type === "BUY" ? "text-teal-400 font-semibold" : "text-red-400 font-semibold";
        const tr = document.createElement("tr");
        tr.className = "border-b border-borderBlur/30 text-xs";
        tr.innerHTML = `
            <td class="py-3 font-mono text-gray-400">${t.trade_num}</td>
            <td class="py-3 font-bold text-white">${t.stock_name}</td>
            <td class="py-3 font-mono font-medium">${t.qty}</td>
            <td class="py-3 ${typeClass}">${t.type}</td>
            <td class="py-3 font-mono">Rs. ${t.price.toFixed(2)}</td>
            <td class="py-3 font-mono text-teal-400">Rs. ${t.total_price.toFixed(2)}</td>
            <td class="py-3 text-gray-400">${t.mode}</td>
            <td class="py-3 text-gray-400 font-mono">${t.created_at}</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Summary values
    const s = data.summary;
    const profitColor = s.profit >= 0 ? "text-teal-400 font-bold" : "text-red-500 font-bold";
    document.getElementById("report-summary-text").innerHTML = `
        Today you executed <strong>${s.total_trades}</strong> trades (<strong>${s.manual_trades}</strong> manual, <strong>${s.automatic_trades}</strong> automatic) and your profit is <strong class="${profitColor}">${s.profit >= 0 ? '+' : ''}${s.profit.toFixed(2)} RS</strong>.
    `;
    
    document.getElementById("report-current-balance").innerText = `Rs. ${s.current_balance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
}

// 7. Dynamic compilation and download of CSV files
function downloadTradeCSVReport() {
    if (state.tradesToday.length === 0) {
        showWarningToast("No trades executed today to download.");
        return;
    }
    
    // Header
    let csvContent = "Trade Number,Stock Name,Quantity,Action Type,Price (Rs.),Total Price (Rs.),Execution Mode,Timestamp\n";
    
    state.tradesToday.forEach(t => {
        csvContent += `${t.trade_num},${t.stock_name},${t.qty},${t.type},${t.price.toFixed(2)},${t.total_price.toFixed(2)},${t.mode},"${t.created_at}"\n`;
    });
    
    // Create File Blob
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    link.setAttribute("href", url);
    link.setAttribute("download", `Virtual_Trading_Report_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = "hidden";
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 8. Visual Chart.js Controls
const STOCKS = ["STOCK_A", "STOCK_B", "STOCK_C", "STOCK_D"];

function initializeChart() {
    const ctx = document.getElementById("stock-live-chart").getContext("2d");
    
    // Standard Chart Config (Category horizontal scale)
    state.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: state.chartData.labels,
            datasets: [{
                label: 'Price (Rs.)',
                data: state.chartData.prices,
                borderColor: '#3b82f6',
                borderWidth: 2,
                fill: true,
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                tension: 0.15,
                pointBackgroundColor: '#3b82f6',
                pointRadius: 1,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0d1525',
                    titleColor: '#94a3b8',
                    titleFont: { family: 'Plus Jakarta Sans', size: 10 },
                    bodyColor: '#3b82f6',
                    bodyFont: { family: 'Plus Jakarta Sans', size: 12, weight: 'bold' },
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return 'Price: Rs. ' + Number(context.raw).toFixed(2);
                        },
                        title: function(context) {
                            // Trim date part if present and show hh:mm format
                            const fullLabel = context[0].label;
                            if (fullLabel.includes(" ")) {
                                const parts = fullLabel.split(" ");
                                return 'Time: ' + parts[1].substring(0, 5);
                            }
                            return 'Time: ' + fullLabel.substring(0, 5);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'Plus Jakarta Sans', size: 9 },
                        maxTicksLimit: 12
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'Plus Jakarta Sans', size: 9 },
                        callback: function(value) {
                            return 'Rs. ' + value.toFixed(2);
                        }
                    }
                }
            }
        }
    });
    
    // Set initial date pickers boundaries
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    
    document.getElementById("chart-range-start").value = formatDateForPicker(startOfToday);
    document.getElementById("chart-range-end").value = formatDateForPicker(today);
}

function fetchSelectedHistoricalData() {
    const stock = state.activeStock;
    const granularity = document.getElementById("chart-granularity").value;
    const start = document.getElementById("chart-range-start").value;
    const end = document.getElementById("chart-range-end").value;
    
    let url = `${API_BASE}/api/stocks/history?stock_name=${stock}&granularity=${granularity}`;
    if (start) {
        url += `&start_time=${new Date(start).toISOString()}`;
    }
    if (end) {
        url += `&end_time=${new Date(end).toISOString()}`;
    }
    
    fetch(url)
        .then(res => res.json())
        .then(ticks => {
            state.chartData.labels = [];
            state.chartData.prices = [];
            
            ticks.forEach(t => {
                const tickTime = new Date(t.created_at);
                // Format: If granularity is 1s, show hh:mm:ss. If downsampled, show hh:mm
                const formatted = granularity === "second" ? formatTimeHHMMSS(tickTime) : formatTimeHHMM(tickTime);
                state.chartData.labels.push(formatted);
                state.chartData.prices.push(t.price);
            });
            
            // Re-render chart dataset
            state.chart.data.labels = state.chartData.labels;
            state.chart.data.datasets[0].data = state.chartData.prices;
            state.chart.update();
        })
        .catch(err => {
            console.error("Failed to load historical ticks data: ", err);
        });
}

function appendTickToChart(label, price) {
    if (!state.chart) return;
    
    // Limit live tick chart cache size to 60 points to keep UI sleek
    if (state.chartData.labels.length >= 60) {
        state.chartData.labels.shift();
        state.chartData.prices.shift();
    }
    
    state.chartData.labels.push(label);
    state.chartData.prices.push(price);
    
    state.chart.update('none'); // Update without transition triggers to save rendering lag
}

// 9. Administrative panel actions
function openAdminPanel() {
    const overlay = document.getElementById("admin-panel-overlay");
    overlay.classList.remove("translate-x-full");
    
    // Fetch users list
    fetch(`${API_BASE}/api/admin/users?token=${state.token}`)
        .then(res => res.json())
        .then(users => {
            const tbody = document.getElementById("admin-users-table-body");
            tbody.innerHTML = "";
            
            users.forEach(u => {
                const isBlockedChecked = u.is_blocked ? "checked" : "";
                const dateStr = u.last_active ? new Date(u.last_active).toLocaleString() : "Never";
                const isSelfAdmin = u.email === "bhaweshji@gmail.com";
                const disabledStr = isSelfAdmin ? "disabled cursor-not-allowed" : "";
                
                const tr = document.createElement("tr");
                tr.className = "border-b border-borderBlur/30 hover:bg-gray-800/10 text-xs";
                tr.innerHTML = `
                    <td class="py-3.5 font-bold text-white">${u.email}</td>
                    <td class="py-3.5 font-mono text-teal-400">Rs. ${u.balance.toFixed(2)}</td>
                    <td class="py-3.5 text-gray-400 font-mono text-[11px]">${dateStr}</td>
                    <td class="py-3.5 text-right">
                        <label class="inline-flex items-center cursor-pointer">
                            <input type="checkbox" value="" class="sr-only peer admin-block-toggle" data-id="${u.id}" ${isBlockedChecked} ${disabledStr}>
                            <div class="relative w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                        </label>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            
            // Attach toggle listeners
            document.querySelectorAll(".admin-block-toggle").forEach(checkbox => {
                checkbox.addEventListener("change", (e) => {
                    const userId = e.target.getAttribute("data-id");
                    const isBlocked = e.target.checked;
                    toggleUserBlockState(userId, isBlocked);
                });
            });
        });
}

function closeAdminPanel() {
    const overlay = document.getElementById("admin-panel-overlay");
    overlay.classList.add("translate-x-full");
}

function toggleUserBlockState(userId, isBlocked) {
    fetch(`${API_BASE}/api/admin/block?user_id=${userId}&is_blocked=${isBlocked}&token=${state.token}`, {
        method: "POST"
    })
    .then(async res => {
        const data = await res.json();
        if (res.status === 200) {
            showInfoToast(isBlocked ? "User profile BLOCKED successfully." : "User profile UNBLOCKED.");
            // Refresh list
            openAdminPanel();
        } else {
            showWarningToast(data.detail || "Action rejected.");
            openAdminPanel();
        }
    })
    .catch(() => {
        showWarningToast("Server failure toggling block state.");
        openAdminPanel();
    });
}

// 10. Helpers formatting functions
function formatTimeHHMMSS(date) {
    return date.toTimeString().split(' ')[0];
}

function formatTimeHHMM(date) {
    const parts = date.toTimeString().split(' ')[0].split(':');
    return `${parts[0]}:${parts[1]}`;
}

function formatDateForPicker(date) {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// System banner manager
function showSystemNotificationBanner(msg, alertType) {
    const banner = document.getElementById("system-broadcast-banner");
    const text = document.getElementById("system-banner-text");
    
    text.innerText = msg;
    banner.className = "transition-all duration-300 border p-4 rounded-xl flex items-center justify-between text-xs font-semibold gap-4";
    
    if (alertType === "critical") {
        banner.classList.add("alert-banner-critical");
    } else if (alertType === "warning") {
        banner.classList.add("alert-banner-warning");
    } else {
        banner.classList.add("alert-banner-info");
    }
    
    banner.classList.remove("hidden");
}

// Countdown loop
function initCountdownTimer() {
    setInterval(() => {
        const now = new Date();
        
        // Update Local header clock
        document.getElementById("header-server-time").innerText = formatTimeHHMMSS(now);
        
        // Calculate until midnight
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        const diffMs = midnight - now;
        
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
        
        document.getElementById("header-reset-timer").innerText = `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
    }, 1000);
}

// Toast Notification popup engine
function showInfoToast(msg) {
    createToastNode(msg, "bg-blue-600/90 border-blue-500");
}

function showSuccessToast(msg) {
    createToastNode(msg, "bg-teal-600/90 border-teal-500");
}

function showWarningToast(msg) {
    createToastNode(msg, "bg-red-600/90 border-red-500");
}

function createToastNode(msg, styleClasses) {
    const toast = document.createElement("div");
    toast.className = `fixed bottom-6 right-6 ${styleClasses} border text-white text-xs font-semibold px-4 py-3.5 rounded-xl shadow-2xl z-50 flex items-center gap-2 transform translate-y-4 opacity-0 transition-all duration-300`;
    toast.innerText = msg;
    
    document.body.appendChild(toast);
    
    // Trigger transition
    setTimeout(() => {
        toast.classList.remove("translate-y-4", "opacity-0");
    }, 50);
    
    // Self-destruct
    setTimeout(() => {
        toast.classList.add("translate-y-4", "opacity-0");
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 4000);
}
