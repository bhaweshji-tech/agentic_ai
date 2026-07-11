// FinOps Dashboard Application Logic

// 1. Mock Data - Optimization Opportunities
const initialOpportunities = [
    {
        id: "opp-001",
        resourceId: "i-09f1ad124c88bf5a2",
        resourceName: "prod-api-server-3",
        cloud: "AWS",
        category: "compute",
        categoryLabel: "Compute Right-sizing",
        currentConfig: "m5.4xlarge (16 vCPU, 64 GB)",
        recommendedConfig: "t3.2xlarge (8 vCPU, 32 GB)",
        savings: 1420,
        impact: "High",
        region: "us-east-1 (N. Virginia)",
        tags: { env: "production", team: "core-api", owner: "api-team" },
        details: {
            cpuAvg: "4.2%",
            cpuPeak: "18.5%",
            memoryAvg: "24.1%",
            ageDays: "98",
            billingType: "On-Demand",
            reason: "Average CPU utilization has remained under 5% and memory under 25% for the last 30 days. Downsizing to a burstable t3.2xlarge is recommended to safely handle peaks while reducing idle costs.",
            recommendationType: "Downsize Instance"
        }
    },
    {
        id: "opp-002",
        resourceId: "vol-0a86bf5c8d0e1aa29",
        resourceName: "temp-analytics-cache",
        cloud: "AWS",
        category: "storage",
        categoryLabel: "Storage Cleanup",
        currentConfig: "2000 GB gp2 EBS SSD",
        recommendedConfig: "Delete Volume (Orphaned)",
        savings: 240,
        impact: "Medium",
        region: "us-west-2 (Oregon)",
        tags: { env: "staging", project: "analytics", backup: "weekly" },
        details: {
            cpuAvg: "0.0% (Unattached)",
            cpuPeak: "0.0%",
            memoryAvg: "0.0%",
            ageDays: "14",
            billingType: "Storage-GB/Mo",
            reason: "This volume has been unattached from any active EC2 instance for 14 consecutive days. Deleting the volume will stop continuous billing. A final snapshot is recommended prior to deletion.",
            recommendationType: "Delete Unattached Volume"
        }
    },
    {
        id: "opp-003",
        resourceId: "db-rds-postgresql-shared",
        resourceName: "dev-analytics-db",
        cloud: "AWS",
        category: "idle",
        categoryLabel: "Idle Resource",
        currentConfig: "db.r5.2xlarge (8 vCPU, 64 GB)",
        recommendedConfig: "Stop Instance / Downsize to db.t3.medium",
        savings: 820,
        impact: "Medium",
        region: "us-east-1 (N. Virginia)",
        tags: { env: "development", owner: "data-science" },
        details: {
            cpuAvg: "1.1%",
            cpuPeak: "8.0%",
            memoryAvg: "15.3%",
            ageDays: "45",
            billingType: "On-Demand RDS",
            reason: "Database experiences zero query traffic outside business hours and very light usage during the day. Recommend stopping the database automatically on weekends and nights, or downsizing configuration.",
            recommendationType: "Downsize or Auto-stop RDS"
        }
    },
    {
        id: "opp-004",
        resourceId: "vm-prod-web-frontend",
        resourceName: "k8s-node-pool-01",
        cloud: "Azure",
        category: "ri",
        categoryLabel: "Commitment Coverage",
        currentConfig: "Standard_E16s_v3 (16 vCPU, 128 GB)",
        recommendedConfig: "Purchase 3-Year Reserved VM Instance",
        savings: 2310,
        impact: "High",
        region: "East US",
        tags: { cluster: "aks-prod-01", costCenter: "marketing-it" },
        details: {
            cpuAvg: "48.7%",
            cpuPeak: "82.1%",
            memoryAvg: "62.0%",
            ageDays: "365+",
            billingType: "Pay-As-You-Go",
            reason: "This node pool has run continuously for 12 months with high resource utilization. Switching from Pay-As-You-Go to a 3-Year Azure Reserved Instance will yield a 62% discount without altering hardware.",
            recommendationType: "Purchase Azure Reserved Instance"
        }
    },
    {
        id: "opp-005",
        resourceId: "storage-bucket-raw-ingest",
        resourceName: "telemetry-raw-logs-2025",
        cloud: "GCP",
        category: "storage",
        categoryLabel: "Storage Cleanup",
        currentConfig: "50 TB Standard Storage",
        recommendedConfig: "Apply Lifecycle Policy (Archive to Coldline)",
        savings: 1050,
        impact: "High",
        region: "us-central1 (Iowa)",
        tags: { dataRetention: "compliance", pipeline: "telemetry" },
        details: {
            cpuAvg: "N/A",
            cpuPeak: "N/A",
            memoryAvg: "N/A",
            ageDays: "180",
            billingType: "Standard Storage Class",
            reason: "Objects in this bucket have not been accessed in over 90 days. Implementing a GCS Lifecycle policy to automatically transition files older than 90 days to Coldline storage saves 80% on storage costs.",
            recommendationType: "Configure Lifecycle Policy"
        }
    },
    {
        id: "opp-006",
        resourceId: "instance-2026-gcp-ai-training",
        resourceName: "gpu-worker-node-14",
        cloud: "GCP",
        category: "idle",
        categoryLabel: "Idle Resource",
        currentConfig: "n1-standard-8 + 2x NVIDIA T4 GPU",
        recommendedConfig: "Delete Idle GPU Instance",
        savings: 1890,
        impact: "High",
        region: "us-west1 (Oregon)",
        tags: { project: "llm-fine-tuning", env: "sandbox" },
        details: {
            cpuAvg: "0.2%",
            cpuPeak: "1.0%",
            memoryAvg: "2.5%",
            ageDays: "12",
            billingType: "On-Demand (with GPU)",
            reason: "This high-cost GPU node was spun up for a model training job that completed 10 days ago. It has sat completely idle (GPU usage 0.0%) for 10 days. Immediate deletion is recommended.",
            recommendationType: "Terminate Idle GPU VM"
        }
    },
    {
        id: "opp-007",
        resourceId: "sqldb-azure-customer-data",
        resourceName: "cust-profiles-replica",
        cloud: "Azure",
        category: "compute",
        categoryLabel: "Compute Right-sizing",
        currentConfig: "vCore-based Azure SQL (8 vCores)",
        recommendedConfig: "Scale down to vCore Azure SQL (2 vCores)",
        savings: 580,
        impact: "Medium",
        region: "West Europe",
        tags: { database: "replica", environment: "staging" },
        details: {
            cpuAvg: "3.5%",
            cpuPeak: "12.0%",
            memoryAvg: "33.2%",
            ageDays: "60",
            billingType: "SQL Database DTU/vCore",
            reason: "This read-replica database experiences very few select queries. Average CPU is consistently below 5%. Scaling down the database size preserves performance requirements while lowering billing rate.",
            recommendationType: "Resize Azure SQL Database"
        }
    },
    {
        id: "opp-008",
        resourceId: "disk-azure-os-backup-33",
        resourceName: "backup-vhd-volume",
        cloud: "Azure",
        category: "storage",
        categoryLabel: "Storage Cleanup",
        currentConfig: "1024 GB Standard HDD Disk",
        recommendedConfig: "Convert to Azure Snapshot & Delete Disk",
        savings: 90,
        impact: "Low",
        region: "East US 2",
        tags: { tagBackup: "decommissioned-vm" },
        details: {
            cpuAvg: "0.0%",
            cpuPeak: "0.0%",
            memoryAvg: "0.0%",
            ageDays: "120",
            billingType: "Standard HDD GB/Mo",
            reason: "This managed disk is from a decommissioned VM. Converting it to a cheaper snapshot blob and deleting the active managed disk volume retains the backup option while reducing monthly storage cost.",
            recommendationType: "Snapshot and Delete Disk"
        }
    },
    {
        id: "opp-009",
        resourceId: "aws-elasticache-redis-02",
        resourceName: "session-store-cache",
        cloud: "AWS",
        category: "ri",
        categoryLabel: "Commitment Coverage",
        currentConfig: "cache.r5.xlarge (4 nodes)",
        recommendedConfig: "Purchase 1-Year Reserved Nodes",
        savings: 1120,
        impact: "High",
        region: "ap-southeast-1 (Singapore)",
        tags: { app: "e-commerce-portal", component: "caching" },
        details: {
            cpuAvg: "25.4%",
            cpuPeak: "45.0%",
            memoryAvg: "71.2%",
            ageDays: "150",
            billingType: "On-Demand Cache",
            reason: "This Redis cache cluster handles persistent session state and runs 24/7. Committing to a 1-Year Reserved Node purchase will decrease node rental cost by 37% without any service disruption.",
            recommendationType: "Purchase ElastiCache Reserved Nodes"
        }
    },
    {
        id: "opp-010",
        resourceId: "aws-elb-external-gateway",
        resourceName: "unused-classic-load-balancer",
        cloud: "AWS",
        category: "idle",
        categoryLabel: "Idle Resource",
        currentConfig: "Classic Load Balancer (ELB)",
        recommendedConfig: "Delete Unused Load Balancer",
        savings: 150,
        impact: "Low",
        region: "us-east-1 (N. Virginia)",
        tags: { env: "dev", owner: "infrastructure" },
        details: {
            cpuAvg: "0 Requests/sec",
            cpuPeak: "0 Requests/sec",
            memoryAvg: "N/A",
            ageDays: "30",
            billingType: "ELB Hourly & Data Processed",
            reason: "This Classic Load Balancer has registered zero active targets and has routed no traffic for over 30 days. Deleting it will stop the idle base hourly charge.",
            recommendationType: "Delete Idle Load Balancer"
        }
    },
    {
        id: "opp-011",
        resourceId: "gcp-compute-custom-vm-9",
        resourceName: "integration-testing-runner",
        cloud: "GCP",
        category: "compute",
        categoryLabel: "Compute Right-sizing",
        currentConfig: "custom-8-32768 (8 vCPU, 32 GB)",
        recommendedConfig: "Apply Custom Machine Type Recommendation",
        savings: 340,
        impact: "Medium",
        region: "europe-west3 (Frankfurt)",
        tags: { env: "ci-cd", framework: "cypress" },
        details: {
            cpuAvg: "8.1%",
            cpuPeak: "44.0%",
            memoryAvg: "18.0%",
            ageDays: "90",
            billingType: "GCP Custom Machine",
            reason: "Google Cloud Recommender has identified that this instance is overprovisioned. Shrinking it to a custom 4 vCPU, 16 GB instance will retain sufficient ceiling for test suites while reducing compute cost.",
            recommendationType: "Resize Custom VM"
        }
    },
    {
        id: "opp-012",
        resourceId: "vol-0f2c418a1a399cc11",
        resourceName: "sandbox-temp-scratchpad",
        cloud: "AWS",
        category: "storage",
        categoryLabel: "Storage Cleanup",
        currentConfig: "800 GB gp3 EBS SSD",
        recommendedConfig: "Delete Idle Storage Volume",
        savings: 96,
        impact: "Low",
        region: "eu-west-1 (Ireland)",
        tags: { env: "sandbox", user: "dev-trainee" },
        details: {
            cpuAvg: "0.0% unattached",
            cpuPeak: "0.0%",
            memoryAvg: "0.0%",
            ageDays: "60",
            billingType: "gp3 Storage-GB/Mo",
            reason: "An unattached sandbox disk created by a developer who left the project 2 months ago. Has had no write or read IOPS for 60 days. Safe to delete immediately.",
            recommendationType: "Delete Unattached Volume"
        }
    },
    {
        id: "opp-013",
        resourceId: "azure-cosmosdb-gremlin",
        resourceName: "graph-social-dev",
        cloud: "Azure",
        category: "compute",
        categoryLabel: "Compute Right-sizing",
        currentConfig: "CosmosDB Autoscale (10,000 RU/s)",
        recommendedConfig: "Scale down Autoscale Max RU/s to 4,000 RU/s",
        savings: 420,
        impact: "Medium",
        region: "East Asia",
        tags: { env: "dev", dbType: "graph" },
        details: {
            cpuAvg: "1.2% (Request Units maxed at 800 RU/s)",
            cpuPeak: "12.0%",
            memoryAvg: "N/A",
            ageDays: "40",
            billingType: "CosmosDB Autoscale RU/s",
            reason: "The maximum requested throughput of 10,000 RU/s has never been breached. Current active queries require less than 1,000 RU/s peak. Lowering the maximum scale ceiling reduces idle billing guarantees.",
            recommendationType: "Reduce CosmosDB Peak RU/s Capacity"
        }
    },
    {
        id: "opp-014",
        resourceId: "aws-eip-orphaned-ip",
        resourceName: "eipalloc-01abff927",
        cloud: "AWS",
        category: "idle",
        categoryLabel: "Idle Resource",
        currentConfig: "Unassociated Elastic IP",
        recommendedConfig: "Release Elastic IP",
        savings: 40,
        impact: "Low",
        region: "us-west-2 (Oregon)",
        tags: { team: "network-ops" },
        details: {
            cpuAvg: "N/A",
            cpuPeak: "N/A",
            memoryAvg: "N/A",
            ageDays: "22",
            billingType: "EIP Hourly Charge for Unused IP",
            reason: "AWS charges a small hourly penalty for Elastic IP addresses that are allocated to your account but are not associated with an active running EC2 instance. Releasing this allocation halts charges.",
            recommendationType: "Release Elastic IP Address"
        }
    }
];

// 2. Application State Variables
let opportunities = [...initialOpportunities];
let appliedOpportunities = [];
let checkedIds = new Set();
let costChart = null;

// Filter State
const filters = {
    provider: "all",
    category: "all",
    impact: "all",
    search: ""
};

// Base Financial values
const BASE_MONTHLY_SPEND = 84320;
const INITIAL_POTENTIAL_SAVINGS = 11870; // Hardcoded baseline from current set

// 3. Document Ready Setup
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    // Render initial data
    renderOpportunitiesTable();
    updateSummaryKPIs();
    initCostTrendChart();
    
    // Set active badges
    document.getElementById("opportunities-count-badge").innerText = opportunities.length;

    // Attach Event Listeners
    setupEventListeners();
}

// 4. Event Listeners Setup
function setupEventListeners() {
    // Navigation Tabs Toggle
    const navs = [
        { id: "nav-dashboard", contentId: "dashboard-tab-content", liId: "nav-dashboard-li" },
        { id: "nav-opportunities", contentId: "dashboard-tab-content", liId: "nav-opportunities-li" }, // Redirects to Dashboard containing list
        { id: "nav-accounts", contentId: "accounts-tab-content", liId: "nav-accounts-li" },
        { id: "nav-policies", contentId: "policies-tab-content", liId: "nav-policies-li" },
        { id: "nav-settings", contentId: "settings-tab-content", liId: "nav-settings-li" }
    ];

    navs.forEach(nav => {
        const trigger = document.getElementById(nav.id);
        if (trigger) {
            trigger.addEventListener("click", (e) => {
                e.preventDefault();
                // Remove active classes
                navs.forEach(n => {
                    const li = document.getElementById(n.liId);
                    if (li) li.classList.remove("active");
                    const content = document.getElementById(n.contentId);
                    if (content) content.style.display = "none";
                });
                
                // Add active to selected
                const selectedLi = document.getElementById(nav.liId);
                if (selectedLi) selectedLi.classList.add("active");
                const selectedContent = document.getElementById(nav.contentId);
                if (selectedContent) selectedContent.style.display = "block";

                // Scroll to opportunities table if clicking "Opportunities" in same dashboard
                if (nav.id === "nav-opportunities") {
                    document.querySelector(".opportunities-section").scrollIntoView({ behavior: "smooth" });
                }
            });
        }
    });

    // Filtering inputs
    document.getElementById("filter-provider").addEventListener("change", (e) => {
        filters.provider = e.target.value;
        renderOpportunitiesTable();
    });
    
    document.getElementById("filter-category").addEventListener("change", (e) => {
        filters.category = e.target.value;
        renderOpportunitiesTable();
    });

    document.getElementById("filter-impact").addEventListener("change", (e) => {
        filters.impact = e.target.value;
        renderOpportunitiesTable();
    });

    document.getElementById("global-search").addEventListener("input", (e) => {
        filters.search = e.target.value.toLowerCase().trim();
        renderOpportunitiesTable();
    });

    document.getElementById("btn-reset-filters").addEventListener("click", () => {
        document.getElementById("filter-provider").value = "all";
        document.getElementById("filter-category").value = "all";
        document.getElementById("filter-impact").value = "all";
        document.getElementById("global-search").value = "";
        
        filters.provider = "all";
        filters.category = "all";
        filters.impact = "all";
        filters.search = "";
        
        renderOpportunitiesTable();
    });

    // Bulk selection controls
    document.getElementById("header-checkbox").addEventListener("change", (e) => {
        const filteredOpps = getFilteredOpportunities();
        if (e.target.checked) {
            filteredOpps.forEach(opp => checkedIds.add(opp.id));
        } else {
            filteredOpps.forEach(opp => checkedIds.delete(opp.id));
        }
        
        // Sync row checkboxes
        document.querySelectorAll(".row-checkbox").forEach(box => {
            const id = box.getAttribute("data-id");
            box.checked = checkedIds.has(id);
        });
        
        updateBulkBarState();
        updateSummaryKPIs();
        updateCostTrendChart();
    });

    document.getElementById("btn-select-all-filtered").addEventListener("click", () => {
        const filteredOpps = getFilteredOpportunities();
        filteredOpps.forEach(opp => checkedIds.add(opp.id));
        renderOpportunitiesTable();
        updateBulkBarState();
        updateSummaryKPIs();
        updateCostTrendChart();
    });

    document.getElementById("btn-clear-selection").addEventListener("click", () => {
        checkedIds.clear();
        renderOpportunitiesTable();
        updateBulkBarState();
        updateSummaryKPIs();
        updateCostTrendChart();
    });

    // Apply simulation buttons
    const applySimulation = () => {
        if (checkedIds.size === 0) return;
        
        // Accumulate savings
        let totalAppliedSavings = 0;
        const remainingOpps = [];
        
        opportunities.forEach(opp => {
            if (checkedIds.has(opp.id)) {
                totalAppliedSavings += opp.savings;
                appliedOpportunities.push(opp);
            } else {
                remainingOpps.push(opp);
            }
        });
        
        // Set up success modal details
        document.getElementById("applied-savings-value").innerText = `$${totalAppliedSavings.toLocaleString()}/mo`;
        
        // Show success modal
        document.getElementById("modal-backdrop").classList.add("active");
        document.getElementById("success-modal").classList.add("active");
        
        // Update lists
        opportunities = remainingOpps;
        checkedIds.clear();
    };

    document.getElementById("btn-apply-selected-bulk").addEventListener("click", applySimulation);
    document.getElementById("banner-apply-btn").addEventListener("click", applySimulation);

    // Modal Close
    document.getElementById("btn-close-modal").addEventListener("click", () => {
        document.getElementById("modal-backdrop").classList.remove("active");
        document.getElementById("success-modal").classList.remove("active");
        
        // Sync layout
        renderOpportunitiesTable();
        updateSummaryKPIs();
        updateBulkBarState();
        updateCostTrendChart();
        
        document.getElementById("opportunities-count-badge").innerText = opportunities.length;
    });

    // Drawer Close
    document.getElementById("btn-close-drawer").addEventListener("click", closeDrawer);
    document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);
}

// 5. Filter Handler logic
function getFilteredOpportunities() {
    return opportunities.filter(opp => {
        // Provider filter
        if (filters.provider !== "all" && opp.cloud !== filters.provider) return false;
        
        // Category filter
        if (filters.category !== "all" && opp.category !== filters.category) return false;
        
        // Impact filter
        if (filters.impact !== "all" && opp.impact !== filters.impact) return false;
        
        // Search filter
        if (filters.search !== "") {
            const s = filters.search;
            const matchId = opp.resourceId.toLowerCase().includes(s);
            const matchName = opp.resourceName.toLowerCase().includes(s);
            const matchConfig = opp.currentConfig.toLowerCase().includes(s) || opp.recommendedConfig.toLowerCase().includes(s);
            const matchRegion = opp.region.toLowerCase().includes(s);
            const matchTag = Object.entries(opp.tags).some(([key, val]) => 
                key.toLowerCase().includes(s) || val.toLowerCase().includes(s)
            );
            
            if (!matchId && !matchName && !matchConfig && !matchRegion && !matchTag) return false;
        }
        
        return true;
    });
}

// 6. Rendering Logic
function renderOpportunitiesTable() {
    const tableBody = document.getElementById("opps-table-body");
    const emptyState = document.getElementById("table-empty-state");
    const headerCheckbox = document.getElementById("header-checkbox");
    
    // Clear rows
    tableBody.innerHTML = "";
    
    const filteredOpps = getFilteredOpportunities();
    
    // Update count labels
    const totalPotentialFiltered = filteredOpps.reduce((acc, curr) => acc + curr.savings, 0);
    document.getElementById("filtered-stats").innerHTML = `Showing <strong>${filteredOpps.length}</strong> opportunities costing <strong>$${totalPotentialFiltered.toLocaleString()}/mo</strong> in savings potential`;
    
    if (filteredOpps.length === 0) {
        emptyState.style.display = "flex";
        headerCheckbox.checked = false;
        headerCheckbox.disabled = true;
        return;
    }
    
    emptyState.style.display = "none";
    headerCheckbox.disabled = false;
    
    // Check if all filtered items are checked in current session
    const allChecked = filteredOpps.every(opp => checkedIds.has(opp.id));
    headerCheckbox.checked = allChecked && filteredOpps.length > 0;
    
    // Insert new rows
    filteredOpps.forEach(opp => {
        const row = document.createElement("tr");
        row.setAttribute("data-opp-id", opp.id);
        
        const isChecked = checkedIds.has(opp.id) ? "checked" : "";
        const providerBadgeClass = `provider-${opp.cloud.toLowerCase()}`;
        const impactClass = `impact-${opp.impact.toLowerCase()}`;
        
        row.innerHTML = `
            <td class="col-checkbox" onclick="event.stopPropagation()">
                <input type="checkbox" class="row-checkbox" data-id="${opp.id}" ${isChecked}>
            </td>
            <td class="col-resource">
                <div class="resource-cell">
                    <span>${opp.resourceName}</span>
                    <span class="resource-id">${opp.resourceId}</span>
                </div>
            </td>
            <td class="col-provider">
                <span class="badge-provider ${providerBadgeClass}">${opp.cloud}</span>
            </td>
            <td class="col-category">
                <span class="badge-category">${opp.categoryLabel}</span>
            </td>
            <td class="col-current">${opp.currentConfig}</td>
            <td class="col-recommended">${opp.recommendedConfig}</td>
            <td class="col-savings text-right color-teal">$${opp.savings.toLocaleString()}</td>
            <td class="col-impact">
                <span class="badge-impact ${impactClass}">${opp.impact}</span>
            </td>
            <td class="col-actions" onclick="event.stopPropagation()">
                <button class="btn-more" title="View details" onclick="openDrawer('${opp.id}')">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                </button>
            </td>
        `;
        
        // Row click triggers detail drawer
        row.addEventListener("click", () => {
            openDrawer(opp.id);
        });
        
        // Checkbox toggle event listener
        const checkbox = row.querySelector(".row-checkbox");
        checkbox.addEventListener("change", (e) => {
            if (e.target.checked) {
                checkedIds.add(opp.id);
            } else {
                checkedIds.delete(opp.id);
            }
            updateBulkBarState();
            updateSummaryKPIs();
            updateCostTrendChart();
            
            // Recalculate header checkbox
            const checkAll = filteredOpps.every(o => checkedIds.has(o.id));
            headerCheckbox.checked = checkAll;
        });
        
        tableBody.appendChild(row);
    });
}

// 7. Update KPI Widgets State
function updateSummaryKPIs() {
    // 1. Total Spend Calculation (decreased by applied opportunities)
    const appliedSavingsVal = appliedOpportunities.reduce((acc, curr) => acc + curr.savings, 0);
    const netSpend = BASE_MONTHLY_SPEND - appliedSavingsVal;
    document.getElementById("kpi-total-spend").innerText = `$${netSpend.toLocaleString()}`;
    
    // 2. Potential Savings (sum of what remains)
    const potentialSavingsVal = opportunities.reduce((acc, curr) => acc + curr.savings, 0);
    document.getElementById("kpi-potential-savings").innerText = `$${potentialSavingsVal.toLocaleString()}`;
    
    // 3. Simulated Savings (currently checked)
    let simulatedSavingsVal = 0;
    opportunities.forEach(opp => {
        if (checkedIds.has(opp.id)) {
            simulatedSavingsVal += opp.savings;
        }
    });
    
    // Update KPI indicators
    document.getElementById("kpi-simulated-savings").innerText = `$${simulatedSavingsVal.toLocaleString()}`;
    document.getElementById("banner-savings-value").innerText = `$${simulatedSavingsVal.toLocaleString()}/mo`;
    document.getElementById("simulated-savings-amount").innerText = `$${simulatedSavingsVal.toLocaleString()}/mo`;
    
    // Enable/Disable apply actions based on checks
    const applyBtnBanner = document.getElementById("banner-apply-btn");
    if (simulatedSavingsVal > 0) {
        applyBtnBanner.removeAttribute("disabled");
    } else {
        applyBtnBanner.setAttribute("disabled", "true");
    }
    
    // 4. Count of Active Opportunities
    document.getElementById("kpi-active-opps").innerText = opportunities.length;
    
    // 5. Efficiency Score Gauge Calculation
    // Initial max potential savings is: remaining potential + already permanently applied savings
    const baseSavingsTarget = potentialSavingsVal + appliedSavingsVal;
    
    // Optimization score baseline is 78%. We scale the remaining score up based on applied recommendations.
    // If all are applied (remaining potential is 0), optimization efficiency is 100%.
    let currentScore = 78;
    if (baseSavingsTarget > 0) {
        const percentSavingsAchieved = appliedSavingsVal / baseSavingsTarget;
        currentScore = Math.min(100, Math.round(78 + (percentSavingsAchieved * 22)));
    } else {
        currentScore = 100;
    }
    
    document.getElementById("kpi-efficiency-score").innerText = `${currentScore}%`;
    document.getElementById("score-percent").innerText = currentScore;
    
    // Update circular path rating stroke dash array
    const strokeDash = `${currentScore}, 100`;
    document.getElementById("circle-score-path").setAttribute("stroke-dasharray", strokeDash);
    
    // 6. Update breakdown bars
    updateBreakdownBars();
}

// Helper to update efficiency bars dynamically
function updateBreakdownBars() {
    // Categories count of open vs total
    const getEfficiencyForCategory = (cat, baseScore) => {
        const categoryOpps = opportunities.filter(o => o.category === cat);
        const resolvedCategoryOpps = appliedOpportunities.filter(o => o.category === cat);
        const totalCat = categoryOpps.length + resolvedCategoryOpps.length;
        
        if (totalCat === 0) return 100;
        
        const openVal = categoryOpps.reduce((acc, curr) => acc + curr.savings, 0);
        const resolvedVal = resolvedCategoryOpps.reduce((acc, curr) => acc + curr.savings, 0);
        const totalVal = openVal + resolvedVal;
        
        if (totalVal === 0) return 100;
        return Math.min(100, Math.round(baseScore + ((resolvedVal / totalVal) * (100 - baseScore))));
    };

    // Calculate dynamic scores
    const computeScore = getEfficiencyForCategory("compute", 64);
    const storageScore = getEfficiencyForCategory("storage", 88);
    const dbScore = getEfficiencyForCategory("idle", 75); // idle maps to DB mainly in list
    const unusedScore = getEfficiencyForCategory("ri", 40); // ri maps to general commitments
    
    // Update UI elements
    const updateBar = (valId, barId, score) => {
        document.getElementById(valId).innerText = `${score}%`;
        const bar = document.getElementById(barId);
        bar.style.width = `${score}%`;
        
        // Dynamically adjust coloring variables
        bar.className = "progress";
        if (score < 50) bar.classList.add("progress-danger");
        else if (score < 80) bar.classList.add("progress-warning");
        else bar.classList.add("progress-success");
    };
    
    updateBar("compute-breakdown-val", "compute-breakdown-bar", computeScore);
    updateBar("storage-breakdown-val", "storage-breakdown-bar", storageScore);
    updateBar("db-breakdown-val", "db-breakdown-bar", dbScore);
    updateBar("unused-breakdown-val", "unused-breakdown-bar", unusedScore);
}

// 8. Bulk action bar state management
function updateBulkBarState() {
    const bulkBar = document.getElementById("bulk-bar");
    const checkedCountEl = document.getElementById("checked-count");
    
    if (checkedIds.size > 0) {
        bulkBar.style.display = "flex";
        checkedCountEl.innerText = `${checkedIds.size} optimization${checkedIds.size > 1 ? "s" : ""} selected`;
    } else {
        bulkBar.style.display = "none";
    }
}

// 9. Drawer Actions (Open, render content, close)
function openDrawer(oppId) {
    const opp = opportunities.find(o => o.id === oppId);
    if (!opp) return;
    
    // Update drawer header details
    const pBadge = document.getElementById("drawer-provider-badge");
    pBadge.innerText = opp.cloud;
    pBadge.className = `provider-badge-large provider-${opp.cloud.toLowerCase()}`;
    
    document.getElementById("drawer-title").innerText = opp.categoryLabel;
    document.getElementById("drawer-resource-id").innerText = opp.resourceId;
    
    // Populate drawer body
    const body = document.getElementById("drawer-body-content");
    
    // Construct tag nodes
    let tagsHtml = "";
    Object.entries(opp.tags).forEach(([key, val]) => {
        tagsHtml += `<span class="badge-category" style="font-size:10px; margin-right:4px;">${key}: ${val}</span>`;
    });
    
    const isChecked = checkedIds.has(opp.id);
    
    body.innerHTML = `
        <div class="drawer-section">
            <h4>Resource Overview</h4>
            <div style="font-size: 13px; display: grid; grid-template-columns: auto 1fr; gap: 8px 16px;">
                <span class="weight-bold text-muted">Name:</span>
                <span>${opp.resourceName}</span>
                <span class="weight-bold text-muted">Region:</span>
                <span>${opp.region}</span>
                <span class="weight-bold text-muted">Billing Model:</span>
                <span>${opp.details.billingType}</span>
                <span class="weight-bold text-muted">Age:</span>
                <span>${opp.details.ageDays} days</span>
            </div>
        </div>

        <div class="drawer-section">
            <h4>Tags</h4>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">
                ${tagsHtml || '<span class="text-muted" style="font-size:12px;">No tags found.</span>'}
            </div>
        </div>

        <div class="drawer-section">
            <h4>Utilization (Last 30 days)</h4>
            <div class="util-grid">
                <div class="util-card">
                    <span class="label">CPU Avg Utilization</span>
                    <span class="value color-orange">${opp.details.cpuAvg}</span>
                    <span class="desc">Peak: ${opp.details.cpuPeak}</span>
                </div>
                <div class="util-card">
                    <span class="label">Memory Avg</span>
                    <span class="value color-blue">${opp.details.memoryAvg}</span>
                    <span class="desc">Buffer allocated</span>
                </div>
            </div>
        </div>

        <div class="drawer-section">
            <h4>Configuration Adjustment</h4>
            <div class="compare-container">
                <div class="compare-row">
                    <span>Current Config</span>
                    <span></span>
                    <span>Recommended</span>
                </div>
                <div class="compare-row">
                    <div class="compare-col">
                        <span class="bold-val">${opp.currentConfig.split("(")[0]}</span>
                        <span class="sub-val">${opp.currentConfig.includes("(") ? opp.currentConfig.substring(opp.currentConfig.indexOf("(")) : ""}</span>
                    </div>
                    <span class="arrow-right">→</span>
                    <div class="compare-col color-teal">
                        <span class="bold-val">${opp.recommendedConfig.split("(")[0]}</span>
                        <span class="sub-val">${opp.recommendedConfig.includes("(") ? opp.recommendedConfig.substring(opp.recommendedConfig.indexOf("(")) : ""}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="cost-savings-highlight">
            <span class="lbl">Est. Monthly Savings</span>
            <span class="val">$${opp.savings.toLocaleString()}/mo</span>
        </div>

        <div class="drawer-section" style="font-size:13px; line-height:1.6;">
            <h4>Optimization Insight</h4>
            <p>${opp.details.reason}</p>
        </div>

        <div class="action-row">
            <button class="btn btn-secondary" id="drawer-btn-simulation-toggle">
                ${isChecked ? "Remove from Simulation" : "Add to Simulation"}
            </button>
            <button class="btn btn-primary" id="drawer-btn-apply-immediate">
                Quick Apply
            </button>
        </div>
    `;
    
    // Toggle active classes on backdrop and drawer
    document.getElementById("drawer-backdrop").classList.add("active");
    document.getElementById("detail-drawer").classList.add("active");
    
    // Register actions
    document.getElementById("drawer-btn-simulation-toggle").addEventListener("click", () => {
        if (checkedIds.has(opp.id)) {
            checkedIds.delete(opp.id);
        } else {
            checkedIds.add(opp.id);
        }
        // Sync structures
        renderOpportunitiesTable();
        updateSummaryKPIs();
        updateBulkBarState();
        updateCostTrendChart();
        closeDrawer();
    });
    
    document.getElementById("drawer-btn-apply-immediate").addEventListener("click", () => {
        checkedIds.clear();
        checkedIds.add(opp.id);
        applySimulationImmediate(opp);
    });
}

function closeDrawer() {
    document.getElementById("drawer-backdrop").classList.remove("active");
    document.getElementById("detail-drawer").classList.remove("active");
}

function applySimulationImmediate(opp) {
    closeDrawer();
    
    // Accumulate savings
    const totalAppliedSavings = opp.savings;
    appliedOpportunities.push(opp);
    opportunities = opportunities.filter(o => o.id !== opp.id);
    
    // Set up success modal details
    document.getElementById("applied-savings-value").innerText = `$${totalAppliedSavings.toLocaleString()}/mo`;
    
    // Show success modal
    document.getElementById("modal-backdrop").classList.add("active");
    document.getElementById("success-modal").classList.add("active");
    
    checkedIds.clear();
}

// 10. Charting integration
function initCostTrendChart() {
    const ctx = document.getElementById("cost-trend-chart").getContext("2d");
    
    // Generating datasets:
    // Past 6 months: Jan - Jun (Static historic costs)
    // Next 3 months: Jul - Sep (Forecast)
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul (Forecast)", "Aug (Forecast)", "Sep (Forecast)"];
    
    // Historical trends
    const historicData = [81400, 82500, 83100, 83800, 84200, 84320];
    
    // Current Forecast (without optimizations - runs slightly upward)
    const currentPath = [...historicData, 84900, 85400, 86100];
    
    // Optimized Forecast (drops in July due to applying savings)
    const optimizedPath = calculateOptimizedChartData(historicData);
    
    costChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Current Path',
                    data: currentPath,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#3b82f6',
                    pointRadius: 4
                },
                {
                    label: 'Optimized Path',
                    data: optimizedPath,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#10b981',
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // We use custom legends in HTML
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#172237',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: $${context.raw.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            family: 'Plus Jakarta Sans',
                            size: 11
                        }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            family: 'Plus Jakarta Sans',
                            size: 11
                        },
                        callback: function(value) {
                            return '$' + (value / 1000) + 'k';
                        }
                    }
                }
            }
        }
    });
}

// Compute optimized path forecast based on applied and simulated options
function calculateOptimizedChartData(historicData) {
    // Current active permanent applied savings
    const appliedSavingsVal = appliedOpportunities.reduce((acc, curr) => acc + curr.savings, 0);
    
    // Checked simulation savings
    let simulatedSavingsVal = 0;
    opportunities.forEach(opp => {
        if (checkedIds.has(opp.id)) {
            simulatedSavingsVal += opp.savings;
        }
    });
    
    const totalSavings = appliedSavingsVal + simulatedSavingsVal;
    
    // Forecast months: Jul, Aug, Sep
    // Base forecast would be: [84900, 85400, 86100]
    // Subtract savings dynamically
    const julForecast = Math.max(0, 84900 - totalSavings);
    const augForecast = Math.max(0, 85400 - totalSavings);
    const sepForecast = Math.max(0, 86100 - totalSavings);
    
    return [...historicData, julForecast, augForecast, sepForecast];
}

function updateCostTrendChart() {
    if (!costChart) return;
    
    const historicData = [81400, 82500, 83100, 83800, 84200, 84320];
    const newOptimizedData = calculateOptimizedChartData(historicData);
    
    costChart.data.datasets[1].data = newOptimizedData;
    costChart.update('none'); // Update without full transition animation to feel super reactive
}
