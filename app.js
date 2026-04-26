// =========================================================================
// Noah Farm ERP - Core Application Logic
// =========================================================================

// --- 1. Database Configuration (Dexie.js) ---
const db = new Dexie("NoahFarm_ERP_DB");
db.version(4).stores({
    system: 'id', // Stores 'config': capital, safeBalance, inventory
    cycles: 'id, name, startDate, status',
    expenses: 'id, date, type, cycleId, timestamp',
    incomes: 'id, date, source, cycleId, timestamp',
    workers: 'id, name, lastPaid',
    cycleLogs: 'id, cycleId, date, timestamp', // Bio Tracking
    vaccinations: 'id, cycleId, date' // Medical Tracking
});

// Global Variables
let currentViewedCycleId = null;
let datePickerInstances =[];

// --- 2. Application Bootstrapping ---
document.addEventListener("DOMContentLoaded", async () => {
    showLoader();
    initPlugins();
    await initDatabase();
    setupRouting();
    setupFormListeners();
    await populateCycleDropdowns();
    await loadDashboardData();
    hideLoader();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js').catch(err => console.log("SW Error:", err));
    }
});

// --- 3. UI Helpers ---
function showLoader() { document.getElementById('loader').classList.remove('d-none'); }
function hideLoader() { document.getElementById('loader').classList.add('d-none'); }

function initPlugins() {
    flatpickr(".flatpickr-date", {
        locale: "ar",
        dateFormat: "n/j/Y",
        defaultDate: new Date()
    });
}

function notify(msg, type = "success") {
    Toastify({
        text: msg,
        duration: 3000,
        gravity: "bottom",
        position: "right",
        style: {
            background: type === "success" ? "#2e7d32" : "#d32f2f",
            borderRadius: "8px",
            fontFamily: "Cairo",
            fontWeight: "bold"
        }
    }).showToast();
}

function formatCurrency(num) {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(num || 0);
}

// --- 4. Database Initialization ---
async function initDatabase() {
    const config = await db.system.get('config');
    if (!config) {
        await db.system.put({
            id: 'config',
            capital: 0,
            safeBalance: 0,
            inventory: { feed: 0 }
        });
    }
}

// Populate Dropdowns for linking expenses/incomes to cycles
async function populateCycleDropdowns() {
    const cycles = await db.cycles.where('status').equals('active').toArray();
    let options = `<option value="">-- مصروف / إيراد عام (لا يخص دورة) --</option>`;
    let incOptions = `<option value="">-- إيراد عام (لا يخص دورة) --</option>`;
    cycles.forEach(c => {
        options += `<option value="${c.id}">${c.name}</option>`;
        incOptions += `<option value="${c.id}">${c.name}</option>`;
    });
    const expSelect = document.getElementById('expCycleId');
    const incSelect = document.getElementById('incCycleId');
    if(expSelect) expSelect.innerHTML = options;
    if(incSelect) incSelect.innerHTML = incOptions;
}

// --- 5. SPA Routing ---
function setupRouting() {
    const links = document.querySelectorAll('.nav-link-custom');
    const sections = document.querySelectorAll('.spa-section');

    document.getElementById("menu-toggle").addEventListener("click", () => {
        document.getElementById("wrapper").classList.toggle("toggled");
    });

    links.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            
            // UI States
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            document.getElementById('page-title').innerText = link.innerText.trim();

            // Toggle Sections
            sections.forEach(sec => {
                if (sec.id === targetId) {
                    sec.classList.remove('d-none');
                    setTimeout(() => sec.classList.add('active'), 50);
                } else {
                    sec.classList.add('d-none');
                    sec.classList.remove('active');
                }
            });

            // Ensure we close cycle profile view when navigating away
            if(targetId !== 'cycles' && targetId !== 'cycle-profile') {
                currentViewedCycleId = null;
                document.getElementById('cycle-profile').classList.add('d-none');
            }

            // Load Section Data
            showLoader();
            if (targetId === 'dashboard') await loadDashboardData();
            if (targetId === 'accounting') await loadAccountingData();
            if (targetId === 'expenses') await renderExpenses();
            if (targetId === 'incomes') await renderIncomes();
            if (targetId === 'cycles') await renderCycles();
            if (targetId === 'workers') await renderWorkers();
            hideLoader();
            
            // Close sidebar on mobile
            if (window.innerWidth < 992) document.getElementById("wrapper").classList.remove("toggled");
        });
    });

    // Cycle Profile Inner Tabs Routing
    document.querySelectorAll('#cycleTabs .nav-link').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('#cycleTabs .nav-link').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');['clogs-sec', 'cvacc-sec', 'cexp-sec', 'cinc-sec'].forEach(sec => document.getElementById(sec).classList.add('d-none'));
            document.getElementById(e.target.dataset.target + '-sec').classList.remove('d-none');
        });
    });
}

// --- 6. Dashboards & Accounting Global ---
let cashflowChartIns = null;
let expenseChartIns = null;

async function loadDashboardData() {
    const config = await db.system.get('config');
    const expenses = await db.expenses.toArray();
    const incomes = await db.incomes.toArray();

    const totalExp = expenses.reduce((sum, item) => sum + item.amount, 0);
    const totalInc = incomes.reduce((sum, item) => sum + item.amount, 0);

    document.getElementById('dash-capital').innerText = formatCurrency(config.capital);
    document.getElementById('dash-safe').innerText = formatCurrency(config.safeBalance);
    document.getElementById('nav-safe-balance').innerText = formatCurrency(config.safeBalance);
    document.getElementById('dash-total-exp').innerText = formatCurrency(totalExp);
    document.getElementById('dash-feed').innerText = formatCurrency(config.inventory.feed || 0) + ' كجم';

    // Chart: Expense Types
    const types = { general: 0, feed: 0, chicks: 0, med: 0 };
    expenses.forEach(ex => { if(types[ex.type] !== undefined) types[ex.type] += ex.amount; });

    if (expenseChartIns) expenseChartIns.destroy();
    expenseChartIns = new Chart(document.getElementById('expensesChart'), {
        type: 'doughnut',
        data: {
            labels:['عامة', 'أعلاف', 'كتاكيت', 'أدوية'],
            datasets: [{ data:[types.general, types.feed, types.chicks, types.med], backgroundColor:['#9e9e9e', '#ff9800', '#03a9f4', '#f44336'] }]
        },
        options: { plugins: { legend: { position: 'bottom', labels: { fontFamily: 'Cairo' } } } }
    });

    // Chart: Cashflow
    if (cashflowChartIns) cashflowChartIns.destroy();
    cashflowChartIns = new Chart(document.getElementById('cashflowChart'), {
        type: 'bar',
        data: {
            labels: ['إجمالي حركة الخزنة'],
            datasets:[
                { label: 'إيرادات (+)', data: [totalInc], backgroundColor: '#4caf50' },
                { label: 'مصروفات (-)', data: [totalExp], backgroundColor: '#f44336' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { fontFamily: 'Cairo' } } } }
    });
}

async function loadAccountingData() {
    const totalInc = (await db.incomes.toArray()).reduce((sum, i) => sum + i.amount, 0);
    const totalExp = (await db.expenses.toArray()).reduce((sum, i) => sum + i.amount, 0);
    const netProfit = totalInc - totalExp;
    
    const profitEl = document.getElementById('net-profit');
    profitEl.innerText = formatCurrency(netProfit) + ' ج.م';
    profitEl.className = `display-4 fw-bold mt-3 ${netProfit >= 0 ? 'text-white' : 'text-danger'}`;
}

// --- 7. CYCLE PROFILE ENGINE (The Core Operations Center) ---
window.viewCycleProfile = async (id) => {
    currentViewedCycleId = id.toString();
    document.getElementById('cycles').classList.add('d-none');
    document.getElementById('cycle-profile').classList.remove('d-none');
    document.getElementById('page-title').innerText = "مركز عمليات القطيع";
    
    // Switch to first tab safely
    document.querySelector('#cycleTabs .nav-link[data-target="clogs"]').click();
    await refreshCycleProfile();
};

window.goBackToCycles = () => {
    currentViewedCycleId = null;
    document.getElementById('cycle-profile').classList.add('d-none');
    document.getElementById('cycles').classList.remove('d-none');
    document.getElementById('page-title').innerText = "إدارة الدورات";
    renderCycles();
};

let cWChart, cFChart;
let cLogsGrid, cVaccGrid, cExpGrid, cIncGrid;

async function refreshCycleProfile() {
    if(!currentViewedCycleId) return;

    const cycleIdInt = parseInt(currentViewedCycleId);
    const cycle = await db.cycles.get(cycleIdInt);
    
    // Fetch Cycle Data
    const logs = await db.cycleLogs.where('cycleId').equals(currentViewedCycleId).sortBy('timestamp');
    const vaccs = await db.vaccinations.where('cycleId').equals(currentViewedCycleId).toArray();
    const cExps = await db.expenses.where('cycleId').equals(currentViewedCycleId).toArray();
    const cIncs = await db.incomes.where('cycleId').equals(currentViewedCycleId).toArray();

    document.getElementById('cp-name').innerText = `${cycle.name} ${cycle.status === 'active' ? '🟢' : '🔴'}`;

    // 1. Calculate Bio-Financial KPIs
    let totalMort = 0; 
    let totalFeed = 0; 
    let lastWeight = 0;

    logs.forEach(l => {
        totalMort += (l.mortality || 0);
        totalFeed += (l.feedConsumed || 0);
        if (l.weight > 0) lastWeight = l.weight;
    });
    
    let remaining = cycle.birds - totalMort;
    if (remaining < 0) remaining = 0;

    let ageDays = Math.floor((new Date() - new Date(cycle.startDate)) / (1000 * 60 * 60 * 24));
    if (ageDays < 0) ageDays = 0;
    
    let mortRate = cycle.birds > 0 ? ((totalMort / cycle.birds) * 100).toFixed(1) : 0;
    
    // FCR Calculation: Total Feed (KG) / Total Live Weight (KG)
    let totalWeightKG = (lastWeight * remaining) / 1000;
    let fcr = (totalWeightKG > 0) ? (totalFeed / totalWeightKG).toFixed(2) : "0.00";
    
    // Financials
    let cycleCost = cExps.reduce((s, e) => s + e.amount, 0);
    let cycleRevenue = cIncs.reduce((s, e) => s + e.amount, 0);
    let profit = cycleRevenue - cycleCost;

    // Update Top Cards
    document.getElementById('cp-age').innerText = ageDays;
    document.getElementById('cp-birds').innerText = formatCurrency(remaining);
    document.getElementById('cp-mortality').innerText = mortRate + '%';
    document.getElementById('cp-fcr').innerText = fcr;
    document.getElementById('cp-weight').innerText = formatCurrency(lastWeight);
    document.getElementById('cp-profit').innerText = formatCurrency(profit);
    document.getElementById('cp-profit').className = profit >= 0 ? "m-0 text-success" : "m-0 text-danger";

    // 2. Render Charts
    let lbls = logs.map(l => l.date.substring(0, 5)); // e.g. "5/27"
    let weights = logs.map(l => l.weight);
    let feeds = logs.map(l => l.feedConsumed);

    if (cWChart) cWChart.destroy();
    cWChart = new Chart(document.getElementById('cycleWeightChart'), { 
        type: 'line', 
        data: { labels: lbls, datasets:[{ label: 'الوزن الفعلي (جرام)', data: weights, borderColor: '#0dcaf0', backgroundColor: 'rgba(13, 202, 240, 0.1)', fill: true, tension: 0.3 }] },
        options: { plugins: { legend: { labels: { fontFamily: 'Cairo' } } } }
    });

    if (cFChart) cFChart.destroy();
    cFChart = new Chart(document.getElementById('cycleFeedChart'), { 
        type: 'bar', 
        data: { labels: lbls, datasets:[{ label: 'الاستهلاك (كجم)', data: feeds, backgroundColor: '#ffc107', borderRadius: 4 }] },
        options: { plugins: { legend: { labels: { fontFamily: 'Cairo' } } } }
    });

    // 3. Render Inner Grids
    const glang = { search: { placeholder: "بحث..." }, pagination: { previous: "السابق", next: "التالي", showing: "عرض", results: () => "سجل" } };

    // Logs Grid
    const logsFmt = logs.map(l =>[l.date, l.mortality, l.feedConsumed, l.weight]);
    if (cLogsGrid) cLogsGrid.updateConfig({ data: logsFmt }).forceRender();
    else cLogsGrid = new gridjs.Grid({ columns: ["التاريخ", "النافق", "العلف المستهلك", "الوزن (جم)"], data: logsFmt, pagination: { limit: 5 }, language: glang }).render(document.getElementById('cycle-logs-grid'));

    // Vaccine Grid
    const vacFmt = vaccs.map(v =>[v.date, v.name, v.method]);
    if (cVaccGrid) cVaccGrid.updateConfig({ data: vacFmt }).forceRender();
    else cVaccGrid = new gridjs.Grid({ columns: ["التاريخ", "التحصين/الدواء", "الطريقة"], data: vacFmt, pagination: { limit: 5 }, language: glang }).render(document.getElementById('cycle-vacc-grid'));

    // Expense Grid (Cycle)
    const expFmt = cExps.map(e => [e.date, e.desc, formatCurrency(e.amount)]);
    if (cExpGrid) cExpGrid.updateConfig({ data: expFmt }).forceRender();
    else cExpGrid = new gridjs.Grid({ columns: ["التاريخ", "البيان", "التكلفة"], data: expFmt, pagination: { limit: 5 }, language: glang }).render(document.getElementById('cycle-exp-grid'));

    // Income Grid (Cycle)
    const incFmt = cIncs.map(i => [i.date, i.desc, formatCurrency(i.amount)]);
    if (cIncGrid) cIncGrid.updateConfig({ data: incFmt }).forceRender();
    else cIncGrid = new gridjs.Grid({ columns: ["التاريخ", "البيان", "الإيراد"], data: incFmt, pagination: { limit: 5 }, language: glang }).render(document.getElementById('cycle-inc-grid'));
}

// --- 8. Render Main Grids ---
let cycGrid, expGrid, incGrid, workGrid;
const glang = { search: { placeholder: "بحث هنا..." }, pagination: { previous: "السابق", next: "التالي", showing: "عرض", results: () => "سجل" } };

async function renderCycles() {
    const data = await db.cycles.toArray();
    const formatted = data.map(c =>[
        c.name, formatCurrency(c.birds), new Date(c.startDate).toLocaleDateString('ar-EG'), c.status === 'active' ? '🟢 نشطة' : '🔴 مغلقة',
        gridjs.html(`
            <button class="action-btn btn-view" title="دخول مركز العمليات" onclick="viewCycleProfile('${c.id}')"><i class="fa-solid fa-eye"></i></button>
            <button class="action-btn btn-edit" title="تعديل" onclick="editCycle('${c.id}')"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn btn-delete" title="حذف" onclick="deleteCycle('${c.id}')"><i class="fa-solid fa-trash"></i></button>
        `)
    ]);
    if (cycGrid) cycGrid.updateConfig({ data: formatted }).forceRender();
    else cycGrid = new gridjs.Grid({ columns:["القطيع / الدورة", "العدد المبدئي", "تاريخ البدء", "الحالة", "إجراءات"], data: formatted, search: true, pagination: { limit: 10 }, language: glang }).render(document.getElementById('cycles-grid'));
}

async function renderExpenses() {
    const data = await db.expenses.orderBy('timestamp').reverse().toArray();
    const formatted = data.map(ex =>[
        ex.date, ex.desc, translateType(ex.type, 'exp'), formatCurrency(ex.amount),
        gridjs.html(`
            <button class="action-btn btn-edit" onclick="editExpense('${ex.id}')"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn btn-delete" onclick="deleteExpense('${ex.id}')"><i class="fa-solid fa-trash"></i></button>
        `)
    ]);
    if (expGrid) expGrid.updateConfig({ data: formatted }).forceRender();
    else expGrid = new gridjs.Grid({ columns:["التاريخ", "البيان", "النوع", "المبلغ", "إجراءات"], data: formatted, search: true, pagination: { limit: 10 }, language: glang }).render(document.getElementById('expenses-grid'));
}

async function renderIncomes() {
    const data = await db.incomes.orderBy('timestamp').reverse().toArray();
    const formatted = data.map(inc =>[
        inc.date, inc.desc, translateType(inc.source, 'inc'), formatCurrency(inc.amount),
        gridjs.html(`
            <button class="action-btn btn-edit" onclick="editIncome('${inc.id}')"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn btn-delete" onclick="deleteIncome('${inc.id}')"><i class="fa-solid fa-trash"></i></button>
        `)
    ]);
    if (incGrid) incGrid.updateConfig({ data: formatted }).forceRender();
    else incGrid = new gridjs.Grid({ columns: ["التاريخ", "البيان", "المصدر", "المبلغ", "إجراءات"], data: formatted, search: true, pagination: { limit: 10 }, language: glang }).render(document.getElementById('incomes-grid'));
}

async function renderWorkers() {
    const data = await db.workers.toArray();
    const formatted = data.map(w =>[
        w.name, formatCurrency(w.salary), w.lastPaid ? new Date(w.lastPaid).toLocaleDateString('ar-EG') : 'لم يتم الصرف',
        gridjs.html(`
            <button class="action-btn btn-pay" title="صرف راتب" onclick="payWorker('${w.id}')"><i class="fa-solid fa-hand-holding-dollar"></i></button>
            <button class="action-btn btn-edit" onclick="editWorker('${w.id}')"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn btn-delete" onclick="deleteWorker('${w.id}')"><i class="fa-solid fa-trash"></i></button>
        `)
    ]);
    if (workGrid) workGrid.updateConfig({ data: formatted }).forceRender();
    else workGrid = new gridjs.Grid({ columns:["العامل", "الراتب المستحق", "آخر صرف", "إجراءات"], data: formatted, search: true, pagination: { limit: 10 }, language: glang }).render(document.getElementById('workers-grid'));
}

function translateType(val, cat) {
    const dict = { general: 'عامة', feed: 'أعلاف', chicks: 'كتاكيت', med: 'أدوية', birds: 'لحم', manure: 'سبلة', other: 'أخرى' };
    return dict[val] || val;
}

// --- 9. Modal Reset Helpers ---
window.openExpenseModal = () => { document.getElementById('expenseForm').reset(); document.getElementById('expId').value = ''; document.getElementById('expenseModalTitle').innerText = 'سند صرف جديد'; new bootstrap.Modal(document.getElementById('expenseModal')).show(); };
window.openIncomeModal = () => { document.getElementById('incomeForm').reset(); document.getElementById('incId').value = ''; document.getElementById('incomeModalTitle').innerText = 'سند قبض جديد'; new bootstrap.Modal(document.getElementById('incomeModal')).show(); };
window.openCycleModal = () => { document.getElementById('cycleForm').reset(); document.getElementById('cycId').value = ''; document.getElementById('cycleModalTitle').innerText = 'دورة جديدة'; new bootstrap.Modal(document.getElementById('cycleModal')).show(); };
window.openWorkerModal = () => { document.getElementById('workerForm').reset(); document.getElementById('workId').value = ''; document.getElementById('workerModalTitle').innerText = 'إضافة عامل'; new bootstrap.Modal(document.getElementById('workerModal')).show(); };

// Cycle Specific Buttons
window.openDailyLogModal = () => { document.getElementById('dailyLogForm').reset(); document.getElementById('logId').value = ''; new bootstrap.Modal(document.getElementById('dailyLogModal')).show(); };
window.openVaccineModal = () => { document.getElementById('vaccineForm').reset(); new bootstrap.Modal(document.getElementById('vaccineModal')).show(); };
window.openCycleExpenseModal = () => { window.openExpenseModal(); document.getElementById('expCycleId').value = currentViewedCycleId; };
window.openCycleIncomeModal = () => { window.openIncomeModal(); document.getElementById('incCycleId').value = currentViewedCycleId; };

// --- 10. Form Submit Listeners (CRUD with Accounting Integrity) ---
function setupFormListeners() {
    
    // Capital Logic
    document.getElementById('capitalForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const amt = parseFloat(document.getElementById('capAmount').value);
        const type = document.getElementById('capType').value;
        await db.transaction('rw', db.system, async () => {
            const c = await db.system.get('config');
            if (type === 'withdraw' && c.safeBalance < amt) throw new Error("لا يوجد رصيد كافٍ في الخزنة للسحب!");
            
            c.capital += (type === 'deposit' ? amt : -amt);
            c.safeBalance += (type === 'deposit' ? amt : -amt);
            await db.system.put(c);
        }).then(() => {
            bootstrap.Modal.getInstance(document.getElementById('capitalModal')).hide();
            notify("تم ضبط رأس المال وتحديث الخزنة");
            loadDashboardData();
        }).catch(err => Swal.fire('خطأ', err.message, 'error'));
    });

    // Feed Physical Inventory Logic
    document.getElementById('feedForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const qty = parseFloat(document.getElementById('feedQty').value);
        const action = document.getElementById('feedAction').value;
        await db.transaction('rw', db.system, async () => {
            const c = await db.system.get('config');
            if(action === 'consume' && (c.inventory.feed || 0) < qty) throw new Error("المخزون الحالي لا يكفي!");
            c.inventory.feed = (c.inventory.feed || 0) + (action === 'add' ? qty : -qty);
            await db.system.put(c);
        }).then(() => {
            bootstrap.Modal.getInstance(document.getElementById('feedModal')).hide();
            notify("تم تسوية المخزن العام بنجاح");
            loadDashboardData();
        }).catch(err => Swal.fire('خطأ', err.message, 'error'));
    });

    // Expense Logic (With SafeBalance deduction & Feed Addition)
    document.getElementById('expenseForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('expId').value;
        const parsedId = id ? parseInt(id) : Date.now();
        const amount = parseFloat(document.getElementById('expAmount').value);
        const type = document.getElementById('expType').value;
        
        const payload = {
            id: parsedId,
            desc: document.getElementById('expDesc').value,
            amount: amount,
            type: type,
            cycleId: document.getElementById('expCycleId').value,
            date: document.getElementById('expDate').value,
            timestamp: new Date(document.getElementById('expDate').value).getTime()
        };

        await db.transaction('rw', db.system, db.expenses, async () => {
            const c = await db.system.get('config');
            
            // Calculate Difference for Rollback
            let difference = amount;
            if (id) {
                const oldExp = await db.expenses.get(parsedId);
                difference = amount - oldExp.amount;
            }

            if (c.safeBalance < difference) throw new Error("لا يوجد رصيد كافٍ في الخزنة لإتمام الصرف!");
            
            // Apply Financials
            c.safeBalance -= difference;

            // Apply Feed Inventory Rules: If buying feed, ADD to physical stock (assuming amount is relative to kg for simple logic, though practically you might have separate qty field. We'll add amount value as KGs for logic completion).
            if (type === 'feed' && !id) {
                // To make it simple: We ask user to update Feed Inventory via Feed Modal if they want accurate physical KG, because amount here is EGP.
                // However, for automation: We won't mix EGP with KG automatically to prevent bugs. User uses Quick Action for Feed KG.
            }

            await db.system.put(c);
            await db.expenses.put(payload);
        }).then(() => {
            bootstrap.Modal.getInstance(document.getElementById('expenseModal')).hide();
            notify("تم الحفظ وخصم المبلغ من الخزنة");
            loadDashboardData();
            if(!document.getElementById('expenses').classList.contains('d-none')) renderExpenses();
            if(currentViewedCycleId) refreshCycleProfile();
        }).catch(err => Swal.fire('فشل العملية', err.message, 'error'));
    });

    // Income Logic
    document.getElementById('incomeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('incId').value;
        const parsedId = id ? parseInt(id) : Date.now();
        const amount = parseFloat(document.getElementById('incAmount').value);
        
        const payload = {
            id: parsedId,
            desc: document.getElementById('incDesc').value,
            amount: amount,
            source: document.getElementById('incType').value,
            cycleId: document.getElementById('incCycleId').value,
            date: document.getElementById('incDate').value,
            timestamp: new Date(document.getElementById('incDate').value).getTime()
        };

        await db.transaction('rw', db.system, db.incomes, async () => {
            const c = await db.system.get('config');
            let difference = amount;
            if(id) {
                const oldInc = await db.incomes.get(parsedId);
                difference = amount - oldInc.amount;
            }
            c.safeBalance += difference;
            await db.system.put(c);
            await db.incomes.put(payload);
        }).then(() => {
            bootstrap.Modal.getInstance(document.getElementById('incomeModal')).hide();
            notify("تم التوريد للخزنة بنجاح");
            loadDashboardData();
            if(!document.getElementById('incomes').classList.contains('d-none')) renderIncomes();
            if(currentViewedCycleId) refreshCycleProfile();
        });
    });

    // Cycle Create/Edit
    document.getElementById('cycleForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('cycId').value;
        await db.cycles.put({
            id: id ? parseInt(id) : Date.now(),
            name: document.getElementById('cycName').value,
            startDate: document.getElementById('cycDate').value,
            birds: parseInt(document.getElementById('cycBirds').value),
            status: document.getElementById('cycStatus').value
        });
        bootstrap.Modal.getInstance(document.getElementById('cycleModal')).hide();
        notify("تم حفظ بيانات الدورة");
        await populateCycleDropdowns();
        renderCycles();
    });

    // Worker Create/Edit
    document.getElementById('workerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('workId').value;
        const w = id ? await db.workers.get(parseInt(id)) : { id: Date.now(), lastPaid: null };
        w.name = document.getElementById('workName').value;
        w.salary = parseFloat(document.getElementById('workSalary').value);
        await db.workers.put(w);
        bootstrap.Modal.getInstance(document.getElementById('workerModal')).hide();
        notify("تم الحفظ بنجاح");
        renderWorkers();
    });

    // Cycle Daily Log (Deducts Physical Feed)
    document.getElementById('dailyLogForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const feedAmt = parseFloat(document.getElementById('logFeed').value) || 0;
        const logData = {
            id: Date.now(),
            cycleId: currentViewedCycleId,
            date: document.getElementById('logDate').value,
            mortality: parseInt(document.getElementById('logMortality').value) || 0,
            feedConsumed: feedAmt,
            weight: parseFloat(document.getElementById('logWeight').value) || 0,
            timestamp: new Date(document.getElementById('logDate').value).getTime()
        };

        await db.transaction('rw', db.system, db.cycleLogs, async () => {
            const c = await db.system.get('config');
            if (feedAmt > 0) {
                if ((c.inventory.feed || 0) < feedAmt) throw new Error(`المخزن العام لا يكفي! الرصيد: ${c.inventory.feed} كجم`);
                c.inventory.feed -= feedAmt; // Deduct from inventory
                await db.system.put(c);
            }
            await db.cycleLogs.put(logData);
        }).then(() => {
            bootstrap.Modal.getInstance(document.getElementById('dailyLogModal')).show();
            bootstrap.Modal.getInstance(document.getElementById('dailyLogModal')).hide();
            notify("تم الحفظ وتحديث المخزون وخصم العلف");
            loadDashboardData();
            refreshCycleProfile();
        }).catch(err => Swal.fire('خطأ', err.message, 'error'));
    });

    // Cycle Vaccine Save
    document.getElementById('vaccineForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await db.vaccinations.put({
            id: Date.now(), cycleId: currentViewedCycleId,
            date: document.getElementById('vacDate').value,
            name: document.getElementById('vacName').value,
            method: document.getElementById('vacMethod').value
        });
        bootstrap.Modal.getInstance(document.getElementById('vaccineModal')).hide();
        notify("تم التسجيل");
        refreshCycleProfile();
    });
}

// --- 11. Edit and Delete Window Functions (with Rollbacks) ---

window.editExpense = async (id) => {
    const x = await db.expenses.get(parseInt(id));
    document.getElementById('expId').value = x.id; document.getElementById('expDesc').value = x.desc; 
    document.getElementById('expAmount').value = x.amount; document.getElementById('expType').value = x.type; 
    document.getElementById('expCycleId').value = x.cycleId || ''; document.getElementById('expDate').value = x.date; 
    document.getElementById('expenseModalTitle').innerText = 'تعديل سند الصرف';
    new bootstrap.Modal(document.getElementById('expenseModal')).show(); 
};

window.editIncome = async (id) => {
    const x = await db.incomes.get(parseInt(id));
    document.getElementById('incId').value = x.id; document.getElementById('incDesc').value = x.desc; 
    document.getElementById('incAmount').value = x.amount; document.getElementById('incType').value = x.source; 
    document.getElementById('incCycleId').value = x.cycleId || ''; document.getElementById('incDate').value = x.date; 
    document.getElementById('incomeModalTitle').innerText = 'تعديل سند القبض';
    new bootstrap.Modal(document.getElementById('incomeModal')).show(); 
};

window.editCycle = async (id) => {
    const x = await db.cycles.get(parseInt(id));
    document.getElementById('cycId').value = x.id; document.getElementById('cycName').value = x.name; 
    document.getElementById('cycDate').value = x.startDate; document.getElementById('cycBirds').value = x.birds; 
    document.getElementById('cycStatus').value = x.status; 
    document.getElementById('cycleModalTitle').innerText = 'تعديل الدورة';
    new bootstrap.Modal(document.getElementById('cycleModal')).show(); 
};

window.editWorker = async (id) => {
    const x = await db.workers.get(parseInt(id));
    document.getElementById('workId').value = x.id; document.getElementById('workName').value = x.name; 
    document.getElementById('workSalary').value = x.salary;
    document.getElementById('workerModalTitle').innerText = 'تعديل بيانات عامل';
    new bootstrap.Modal(document.getElementById('workerModal')).show(); 
};

// Safe Deletion Wrapper
async function confirmAction(msg, onConfirm) {
    const res = await Swal.fire({ title: 'تأكيد', text: msg, icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'تنفيذ', cancelButtonText: 'إلغاء' });
    if(res.isConfirmed) onConfirm();
}

window.deleteExpense = (idStr) => {
    confirmAction("سيتم مسح السجل وإرجاع مبلغه للخزنة تلقائياً. متأكد؟", async () => {
        const id = parseInt(idStr);
        await db.transaction('rw', db.system, db.expenses, async () => {
            const exp = await db.expenses.get(id);
            const c = await db.system.get('config');
            c.safeBalance += exp.amount; // Rollback cash
            await db.system.put(c);
            await db.expenses.delete(id);
        });
        notify("تم الحذف واسترداد المبلغ"); loadDashboardData(); renderExpenses();
        if(currentViewedCycleId) refreshCycleProfile();
    });
};

window.deleteIncome = (idStr) => {
    confirmAction("سيتم مسح الإيراد وخصم مبلغه من الخزنة. متأكد؟", async () => {
        const id = parseInt(idStr);
        await db.transaction('rw', db.system, db.incomes, async () => {
            const inc = await db.incomes.get(id);
            const c = await db.system.get('config');
            c.safeBalance -= inc.amount; // Rollback cash
            await db.system.put(c);
            await db.incomes.delete(id);
        });
        notify("تم الحذف وخصم المبلغ"); loadDashboardData(); renderIncomes();
        if(currentViewedCycleId) refreshCycleProfile();
    });
};

window.deleteCycle = (idStr) => {
    confirmAction("حذف الدورة نهائياً سيمسحها من القائمة، لكن حساباتها ستبقى في الدفاتر العامة. متأكد؟", async () => {
        await db.cycles.delete(parseInt(idStr));
        notify("تم حذف الدورة"); await populateCycleDropdowns(); renderCycles();
    });
};

window.deleteWorker = (idStr) => {
    confirmAction("سيتم حذف بيانات العامل بشكل نهائي.", async () => {
        await db.workers.delete(parseInt(idStr)); notify("تم مسح العامل"); renderWorkers();
    });
};

// Worker Auto-Payroll Processing
window.payWorker = async (idStr) => {
    const id = parseInt(idStr);
    const worker = await db.workers.get(id);
    
    const { value: amount } = await Swal.fire({
        title: `صرف للعامل: ${worker.name}`,
        input: 'number',
        inputLabel: 'المبلغ المراد صرفه (يُخصم من الخزنة)',
        inputValue: worker.salary,
        showCancelButton: true,
        confirmButtonText: 'صرف وتسجيل',
        cancelButtonText: 'إلغاء'
    });

    if (amount) {
        const amtNum = parseFloat(amount);
        try {
            await db.transaction('rw', db.system, db.expenses, db.workers, async () => {
                const c = await db.system.get('config');
                if (c.safeBalance < amtNum) throw new Error("لا يوجد نقدية كافية بالخزنة لدفع الراتب!");
                
                // Deduct from safe
                c.safeBalance -= amtNum;
                await db.system.put(c);
                
                // Create Expense
                const dateStr = new Date().toLocaleDateString('en-US'); // Matches plugin format basically
                await db.expenses.put({
                    id: Date.now(),
                    desc: `راتب / سلفة للعامل: ${worker.name}`,
                    amount: amtNum,
                    type: 'general',
                    cycleId: '',
                    date: dateStr,
                    timestamp: Date.now()
                });
                
                // Update Worker
                worker.lastPaid = new Date().toISOString();
                await db.workers.put(worker);
            });
            notify("تم صرف الراتب وتسجيله في المصروفات بنجاح");
            loadDashboardData();
            renderWorkers();
        } catch (err) { Swal.fire('خطأ', err.message, 'error'); }
    }
};

// --- 12. Backup & Restore (JSON Import/Export) ---
document.getElementById('exportDataBtn').addEventListener('click', async () => {
    showLoader();
    const exportObj = {
        capital: (await db.system.get('config')).capital,
        safeBalance: (await db.system.get('config')).safeBalance,
        inventory: (await db.system.get('config')).inventory,
        cycles: await db.cycles.toArray(),
        expenses: await db.expenses.toArray(),
        incomes: await db.incomes.toArray(),
        workers: await db.workers.toArray(),
        cycleLogs: await db.cycleLogs.toArray(),
        vaccinations: await db.vaccinations.toArray()
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `NoahFarm_FullBackup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    hideLoader();
    notify("تم تصدير النسخة الاحتياطية لجهازك بنجاح");
});

document.getElementById('confirmImportBtn').addEventListener('click', () => {
    const fileInput = document.getElementById('importFile');
    if (!fileInput.files.length) return notify("الرجاء اختيار ملف النسخة الاحتياطية أولاً", "error");

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            showLoader();
            const data = JSON.parse(e.target.result);
            
            await db.transaction('rw', db.system, db.cycles, db.expenses, db.incomes, db.workers, db.cycleLogs, db.vaccinations, async () => {
                // Clear existing
                await Promise.all([db.cycles.clear(), db.expenses.clear(), db.incomes.clear(), db.workers.clear(), db.cycleLogs.clear(), db.vaccinations.clear()]);
                
                // Restore Config
                await db.system.put({
                    id: 'config',
                    capital: data.capital || 0,
                    safeBalance: data.safeBalance || 0,
                    inventory: data.inventory || { feed: 0 }
                });

                // Restore Arrays
                if(data.cycles) await db.cycles.bulkPut(data.cycles);
                if(data.expenses) await db.expenses.bulkPut(data.expenses);
                if(data.incomes) await db.incomes.bulkPut(data.incomes);
                if(data.workers) await db.workers.bulkPut(data.workers);
                if(data.cycleLogs) await db.cycleLogs.bulkPut(data.cycleLogs);
                if(data.vaccinations) await db.vaccinations.bulkPut(data.vaccinations);
            });
            
            bootstrap.Modal.getInstance(document.getElementById('importModal')).hide();
            notify("تمت استعادة النظام بنجاح! سيتم إعادة التحميل...");
            setTimeout(() => window.location.reload(), 1500);

        } catch (err) {
            hideLoader();
            Swal.fire('خطأ في الملف', 'تعذر قراءة الملف، تأكد أنه ملف نسخة احتياطية صالح الخاص بالنظام.', 'error');
        }
    };
    reader.readAsText(fileInput.files[0]);
});