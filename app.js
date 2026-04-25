let expensesGridInstance = null;
let genericModal;
let html5QrcodeScanner;
let expenseDoughnut = null;
let historyBar = null;

// التنبيه الصوتي الذكي (Beep)
function playBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 800;
        osc.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.1);
    } catch (e) { }
}

function toastSuccess(msg) { playBeep(); Toastify({ text: msg, duration: 3000, gravity: "bottom", style: { background: "#198754" } }).showToast(); }
function toastError(msg) { Toastify({ text: msg, duration: 3000, gravity: "bottom", style: { background: "#dc3545" } }).showToast(); }

document.addEventListener('DOMContentLoaded', async () => {
    genericModal = new bootstrap.Modal(document.getElementById('genericInputModal'));
    flatpickr("#filter-start", { locale: "ar" }); flatpickr("#filter-end", { locale: "ar" });

    await refreshUI();
    initGrid();

    window.navigate = async function (viewId, el) {
        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        document.querySelectorAll('.bottom-nav .nav-item').forEach(i => i.classList.remove('active'));
        if (el) el.classList.add('active');
        if (viewId === 'view-accounting') await updateGridData();
        await refreshUI();
    };
});

// ================= MODAL & CRUD OPERATIONS =================
function buildModal(title, inputsHTML, saveCallback) {
    document.getElementById('gModalTitle').innerHTML = title;
    document.getElementById('gModalBody').innerHTML = inputsHTML;
    let saveBtn = document.getElementById('gModalSave');
    saveBtn.replaceWith(saveBtn.cloneNode(true));
    document.getElementById('gModalSave').addEventListener('click', saveCallback);
    genericModal.show();
}

window.openModal = async function (type) {
    let activeCycle = (await db.cycles.where('status').equals('active').toArray())[0];

    if (type === 'quickActionModal') { new bootstrap.Modal(document.getElementById('quickActionModal')).show(); return; }

    if (type === 'capitalModal') {
        buildModal('ضخ رأس مال', `<input type="number" id="m-amt" class="form-control" placeholder="المبلغ">`, async () => {
            let amt = parseFloat(document.getElementById('m-amt').value);
            if (amt > 0) { await setVal('capital', await getVal('capital') + amt); await setVal('safeBalance', await getVal('safeBalance') + amt); toastSuccess("تم الإيداع"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'expenseModal') {
        // أرشفة الفواتير بالصور
        buildModal('تسجيل مصروف + فاتورة', `
            <input type="text" id="m-desc" class="form-control mb-2" placeholder="البيان">
            <input type="number" id="m-amt" class="form-control mb-2" placeholder="المبلغ">
            <label class="small text-muted mb-1">صورة الفاتورة (اختياري)</label>
            <input type="file" id="m-img" class="form-control" accept="image/*" capture="environment">
        `, async () => {
            let d = document.getElementById('m-desc').value, a = parseFloat(document.getElementById('m-amt').value);
            let fileInput = document.getElementById('m-img');
            let base64Image = null;
            if (fileInput.files.length > 0) {
                base64Image = await new Promise(resolve => { let reader = new FileReader(); reader.onload = e => resolve(e.target.result); reader.readAsDataURL(fileInput.files[0]); });
            }
            if (d && a > 0) {
                await setVal('safeBalance', await getVal('safeBalance') - a);
                await db.expenses.add({ id: Date.now(), timestamp: Date.now(), date: new Date().toLocaleDateString(), desc: d, amount: a, type: 'general', receipt: base64Image });
                if (activeCycle) { activeCycle.totalCost += a; await db.cycles.put(activeCycle); }
                toastSuccess("تم الحفظ بنجاح"); genericModal.hide(); refreshUI(); if (document.getElementById('view-accounting').classList.contains('active')) updateGridData();
            }
        });
    } else if (type === 'feedModal') {
        buildModal('شراء علف', `<input type="number" id="m-b" class="form-control mb-2" placeholder="العدد"><input type="number" id="m-c" class="form-control" placeholder="التكلفة">`, async () => {
            let b = parseInt(document.getElementById('m-b').value), c = parseFloat(document.getElementById('m-c').value);
            if (b > 0 && c > 0) { await setVal('feedStock', await getVal('feedStock') + b); await setVal('safeBalance', await getVal('safeBalance') - c); await db.expenses.add({ id: Date.now(), timestamp: Date.now(), date: new Date().toLocaleDateString(), desc: `شراء ${b} علف`, amount: c, type: 'feed' }); if (activeCycle) { activeCycle.totalCost += c; await db.cycles.put(activeCycle); } toastSuccess("تم الشراء"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'startCycleModal') {
        buildModal('دورة جديدة', `<input type="text" id="m-n" class="form-control mb-2" placeholder="الاسم"><input type="number" id="m-b" class="form-control mb-2" placeholder="العدد"><input type="number" id="m-c" class="form-control" placeholder="تكلفة الكتاكيت">`, async () => {
            let n = document.getElementById('m-n').value, b = parseInt(document.getElementById('m-b').value), c = parseFloat(document.getElementById('m-c').value);
            if (n && b > 0) { await db.cycles.add({ id: Date.now(), name: n, startDate: new Date().toISOString(), status: 'active', birds: b, mortality: 0, feedConsumed: 0, avgWeight: 0.05, totalCost: c, sales: 0 }); await setVal('safeBalance', await getVal('safeBalance') - c); await db.expenses.add({ id: Date.now(), timestamp: Date.now(), date: new Date().toLocaleDateString(), desc: `كتاكيت: ${n}`, amount: c, type: 'chicks' }); toastSuccess("بدأت الدورة"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'sellModal' && activeCycle) {
        buildModal('تسجيل مبيعات', `<input type="number" id="m-w" class="form-control mb-2" placeholder="الوزن الإجمالي (كجم)"><input type="number" id="m-p" class="form-control mb-2" placeholder="سعر الكيلو"><input type="number" id="m-b" class="form-control" placeholder="عدد الطيور المباعة">`, async () => {
            let w = parseFloat(document.getElementById('m-w').value), p = parseFloat(document.getElementById('m-p').value), b = parseInt(document.getElementById('m-b').value);
            if (w > 0 && p > 0) { let t = w * p; await setVal('safeBalance', await getVal('safeBalance') + t); activeCycle.sales += t; activeCycle.birds -= b; await db.expenses.add({ id: Date.now(), timestamp: Date.now(), date: new Date().toLocaleDateString(), desc: `مبيعات (${w}كجم)`, amount: -t, type: 'sale' }); await db.cycles.put(activeCycle); toastSuccess(`تم تحصيل ${t} ج`); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'medicineModal') {
        buildModal('شراء دواء', `<input type="text" id="m-n" class="form-control mb-2" placeholder="الاسم"><input type="text" id="m-bar" class="form-control mb-2" placeholder="باركود (اختياري)"><input type="number" id="m-q" class="form-control mb-2" placeholder="الكمية"><input type="number" id="m-c" class="form-control" placeholder="التكلفة">`, async () => {
            let n = document.getElementById('m-n').value, bar = document.getElementById('m-bar').value, q = parseFloat(document.getElementById('m-q').value), c = parseFloat(document.getElementById('m-c').value);
            if (n && q) { await db.medicine.add({ id: Date.now(), name: n, barcode: bar, qty: q, cost: c }); await setVal('safeBalance', await getVal('safeBalance') - c); await db.expenses.add({ id: Date.now(), timestamp: Date.now(), date: new Date().toLocaleDateString(), desc: `دواء: ${n}`, amount: c, type: 'med' }); if (activeCycle) { activeCycle.totalCost += c; await db.cycles.put(activeCycle); } toastSuccess("تم الحفظ"); genericModal.hide(); refreshUI(); }
        });
    }
};

window.doQuickAction = async function (type) {
    let active = (await db.cycles.where('status').equals('active').toArray())[0];
    bootstrap.Modal.getInstance(document.getElementById('quickActionModal')).hide();
    if (!active) return toastError("لا توجد دورة نشطة!");

    if (type === 'mortality') {
        buildModal('نافِق', `<input type="number" id="m-v" class="form-control" placeholder="العدد">`, async () => { let v = parseInt(document.getElementById('m-v').value); if (v > 0) { active.mortality += v; active.birds -= v; await db.cycles.put(active); toastSuccess("تم التسجيل"); genericModal.hide(); refreshUI(); } });
    } else if (type === 'feed') {
        buildModal('سحب علف', `<input type="number" id="m-v" class="form-control" placeholder="شكاير">`, async () => { let v = parseFloat(document.getElementById('m-v').value); let s = await getVal('feedStock'); if (v > 0 && s >= v) { await setVal('feedStock', s - v); active.feedConsumed += v; await db.cycles.put(active); toastSuccess("تم السحب"); genericModal.hide(); refreshUI(); } else toastError("رصيد العلف لا يكفي!"); });
    } else if (type === 'weight') {
        buildModal('الوزن', `<input type="number" id="m-v" class="form-control" placeholder="الوزن الحالي (كجم)">`, async () => { let v = parseFloat(document.getElementById('m-v').value); if (v > 0) { active.avgWeight = v; await db.cycles.put(active); toastSuccess("تم التحديث"); genericModal.hide(); refreshUI(); } });
    }
};

window.closeCycle = async function (id) {
    let cycle = await db.cycles.get(id);
    Swal.fire({ title: 'إنهاء الدورة وتوليد تقرير (P&L)؟', icon: 'info', showCancelButton: true, confirmButtonText: 'إنهاء وطباعة PDF', cancelButtonText: 'إلغاء' }).then(async r => {
        if (r.isConfirmed) {
            cycle.status = 'closed'; cycle.endDate = new Date().toISOString(); await db.cycles.put(cycle); toastSuccess("تم إغلاق الدورة!");
            await refreshUI(); generatePnLPDF(cycle);
        }
    });
};

// ================= P&L PDF EXPORT =================
function generatePnLPDF(cycle) {
    document.getElementById('pdf-cycle-name').innerText = cycle.name;
    document.getElementById('pdf-cycle-dates').innerText = `من: ${new Date(cycle.startDate).toLocaleDateString()} | إلى: ${new Date(cycle.endDate).toLocaleDateString()}`;
    document.getElementById('pdf-costs').innerText = cycle.totalCost.toLocaleString();
    document.getElementById('pdf-sales').innerText = cycle.sales.toLocaleString();
    document.getElementById('pdf-net').innerText = (cycle.sales - cycle.totalCost).toLocaleString();
    document.getElementById('pdf-birds').innerText = (cycle.birds + cycle.mortality);
    document.getElementById('pdf-mortality').innerText = cycle.mortality;
    document.getElementById('pdf-feed').innerText = (cycle.feedConsumed * 50) + " كجم";
    document.getElementById('pdf-fcr').innerText = (cycle.birds * cycle.avgWeight) > 0 ? ((cycle.feedConsumed * 50) / (cycle.birds * cycle.avgWeight)).toFixed(2) : 0;

    let target = document.getElementById('pdf-template-container');
    html2canvas(target, { scale: 2 }).then(canvas => {
        const { jsPDF } = window.jspdf;
        let pdf = new jsPDF('p', 'mm', 'a4');
        let imgData = canvas.toDataURL('image/jpeg', 1.0);
        pdf.addImage(imgData, 'JPEG', 10, 10, 190, (canvas.height * 190) / canvas.width);
        pdf.save(`PnL_Report_${cycle.name}.pdf`);
    });
}

// ================= BARCODE SCANNER =================
window.startBarcodeScan = function () {
    document.getElementById('qr-reader').style.display = 'block';
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
    html5QrcodeScanner.render(async (text) => {
        html5QrcodeScanner.clear(); document.getElementById('qr-reader').style.display = 'none'; playBeep();
        let med = (await db.medicine.where('barcode').equals(text).toArray())[0];
        if (med) { Swal.fire('تم التعرف', `الصنف: ${med.name} | المتاح: ${med.qty}`, 'success'); }
        else { Swal.fire('غير مسجل', `الباركود: ${text} غير موجود بالمخزن`, 'error'); }
    }, () => { });
};

// ================= GRID & FILTERS (المصروفات) =================
async function initGrid() {
    expensesGridInstance = new gridjs.Grid({
        columns: ["التاريخ", "البيان", "المبلغ", { name: "إيصال", formatter: (cell) => cell ? gridjs.html(`<button class='btn btn-sm btn-info' onclick='viewReceipt("${cell}")'><i class='fa-solid fa-image'></i></button>`) : "-" }],
        data: [], pagination: { limit: 5 }, language: { search: { placeholder: "بحث..." }, pagination: { previous: "السابق", next: "التالي", showing: "عرض" } }
    }).render(document.getElementById("expenses-grid-wrapper"));
}

window.viewReceipt = function (base64) { Swal.fire({ imageUrl: base64, imageAlt: 'فاتورة', width: 'auto' }); };

window.applyExpenseFilter = async function () { await updateGridData(); };

async function updateGridData() {
    let start = document.getElementById('filter-start').value; let end = document.getElementById('filter-end').value;
    let query = db.expenses.orderBy('timestamp').reverse();
    if (start && end) {
        let sTime = new Date(start).getTime(); let eTime = new Date(end).getTime() + 86400000;
        query = db.expenses.where('timestamp').between(sTime, eTime).reverse();
    }
    let data = await query.toArray();
    let formatted = data.map(e => [e.date, e.desc, `${e.amount < 0 ? '+' : '-'}${Math.abs(e.amount)} ج`, e.receipt || ""]);
    expensesGridInstance.updateConfig({ data: formatted }).forceRender();
}

// ================= CHARTS (تحليلات ومقارنات) =================
async function renderCharts(activeCycle) {
    // 1. Doughnut Chart للمصروفات الدورية
    if (activeCycle) {
        let exps = await db.expenses.where('timestamp').above(new Date(activeCycle.startDate).getTime()).toArray();
        let feedC = 0, chickC = 0, medC = 0, genC = 0;
        exps.forEach(e => { if (e.amount > 0) { if (e.type === 'feed') feedC += e.amount; else if (e.type === 'chicks') chickC += e.amount; else if (e.type === 'med') medC += e.amount; else genC += e.amount; } });

        const ctxD = document.getElementById('expenseDoughnutChart');
        if (expenseDoughnut) expenseDoughnut.destroy();
        expenseDoughnut = new Chart(ctxD, { type: 'doughnut', data: { labels: ['علف', 'كتاكيت', 'أدوية', 'نثريات وعمال'], datasets: [{ data: [feedC, chickC, medC, genC], backgroundColor: ['#ffc107', '#198754', '#0dcaf0', '#dc3545'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    }

    // 2. Bar Chart لتاريخ الدورات (P&L)
    const ctxB = document.getElementById('historyBarChart'); if (!ctxB) return;
    let cycles = await db.cycles.where('status').equals('closed').toArray();
    let labels = cycles.slice(-5).map(c => c.name);
    let profits = cycles.slice(-5).map(c => c.sales - c.totalCost);
    if (historyBar) historyBar.destroy();
    historyBar = new Chart(ctxB, { type: 'bar', data: { labels: labels, datasets: [{ label: 'صافي الربح (ج.م)', data: profits, backgroundColor: profits.map(p => p >= 0 ? '#198754' : '#dc3545') }] } });
}

// ================= UI REFRESH =================
async function refreshUI() {
    document.getElementById('total-cash').innerText = (await getVal('safeBalance')).toLocaleString();
    document.getElementById('acc-capital').innerText = (await getVal('capital')).toLocaleString() + ' ج.م';
    document.getElementById('inv-feed-stock').innerText = await getVal('feedStock');

    let active = (await db.cycles.where('status').equals('active').toArray())[0];
    if (active) {
        document.getElementById('kpi-birds').innerText = active.birds;
        document.getElementById('kpi-fcr').innerText = (active.birds * active.avgWeight) > 0 ? ((active.feedConsumed * 50) / (active.birds * active.avgWeight)).toFixed(2) : 0;
        document.getElementById('kpi-breakeven').innerText = (active.birds * active.avgWeight) > 0 ? (active.totalCost / (active.birds * active.avgWeight)).toFixed(2) : 0;
        let age = Math.floor((new Date() - new Date(active.startDate)) / 86400000) + 1;

        document.getElementById('active-cycle-container').innerHTML = `
            <div class="card shadow-sm border-0 border-start border-success border-4"><div class="card-body">
                <div class="d-flex justify-content-between align-items-center mb-2"><h5 class="text-success mb-0">${active.name}</h5><span class="badge bg-warning text-dark">عمر: ${age} يوم</span></div>
                <hr class="my-2"><div class="d-flex justify-content-between mb-1"><span>العدد الحالي:</span> <strong>${active.birds}</strong></div>
                <div class="d-flex justify-content-between mb-1"><span>إجمالي التكلفة:</span> <strong class="text-danger">${active.totalCost.toLocaleString()} ج</strong></div>
                <button class="btn btn-sm btn-danger w-100 mt-2" onclick="closeCycle(${active.id})">إنهاء وتوليد تقرير (PDF)</button>
            </div></div>`;
    } else {
        ['kpi-birds', 'kpi-fcr', 'kpi-breakeven'].forEach(id => document.getElementById(id).innerText = '0');
        document.getElementById('active-cycle-container').innerHTML = `<button class="btn btn-success w-100 py-3 shadow-sm" onclick="openModal('startCycleModal')"><i class="fa-solid fa-plus"></i> بدء دورة جديدة</button>`;
    }

    let meds = await db.medicine.toArray();
    document.getElementById('medicine-list').innerHTML = meds.map(m => `<div class="col-6"><div class="card p-2 shadow-sm border-0 border-start border-info border-3"><small class="text-muted">${m.name}</small><div class="d-flex justify-content-between align-items-center mt-1"><b>${m.qty} وحدة</b><button class="btn btn-sm btn-outline-info py-0 px-2" onclick="useMedicine(${m.id})">سحب</button></div></div></div>`).join('');

    await renderCharts(active);
}