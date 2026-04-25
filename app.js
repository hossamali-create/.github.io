let expensesGridInstance = null;
let genericModal;
let html5QrcodeScanner;
let expenseDoughnut = null;
let historyBar = null;

// التنبيه الصوتي (Beep)
function playBeep() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 800; osc.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.1); } catch(e) {} }
function toastSuccess(msg) { playBeep(); Toastify({text: msg, duration: 3000, gravity: "bottom", style: {background: "#198754"}}).showToast(); }
function toastError(msg) { Toastify({text: msg, duration: 3000, gravity: "bottom", style: {background: "#dc3545"}}).showToast(); }

document.addEventListener('DOMContentLoaded', async () => {
    genericModal = new bootstrap.Modal(document.getElementById('genericInputModal'));
    flatpickr("#filter-start", { locale: "ar" }); flatpickr("#filter-end", { locale: "ar" });
    
    await refreshUI();
    initGrid();
    
    window.navigate = async function(viewId, el) {
        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        document.querySelectorAll('.bottom-nav .nav-item').forEach(i => i.classList.remove('active'));
        if (el) el.classList.add('active');
        if(viewId === 'view-accounting') await updateGridData();
        await refreshUI();
    };
});

// ================= MODAL BUILDER & CRUD =================
function buildModal(title, inputsHTML, saveCallback) {
    document.getElementById('gModalTitle').innerHTML = title; document.getElementById('gModalBody').innerHTML = inputsHTML;
    let saveBtn = document.getElementById('gModalSave'); saveBtn.replaceWith(saveBtn.cloneNode(true));
    document.getElementById('gModalSave').addEventListener('click', saveCallback);
    genericModal.show();
}

window.openModal = async function(type) {
    let activeCycle = (await db.cycles.where('status').equals('active').toArray())[0];
    if (type === 'quickActionModal') { new bootstrap.Modal(document.getElementById('quickActionModal')).show(); return; }
    
    if (type === 'capitalModal') {
        buildModal('ضخ رأس مال', `<input type="number" id="m-amt" class="form-control" placeholder="المبلغ (ج.م)">`, async () => {
            let amt = parseFloat(document.getElementById('m-amt').value);
            if(amt>0){ await setVal('capital', await getVal('capital')+amt); await setVal('safeBalance', await getVal('safeBalance')+amt); toastSuccess("تم الإيداع"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'expenseModal') {
        buildModal('تسجيل مصروف + صورة', `
            <input type="text" id="m-desc" class="form-control mb-2" placeholder="البيان (مثال: كهرباء، صيانة)">
            <input type="number" id="m-amt" class="form-control mb-2" placeholder="المبلغ">
            <label class="small text-muted mb-1">صورة الفاتورة (اختياري)</label>
            <input type="file" id="m-img" class="form-control" accept="image/*" capture="environment">`, async () => {
            let d=document.getElementById('m-desc').value, a=parseFloat(document.getElementById('m-amt').value), fileInput = document.getElementById('m-img'), base64Image = null;
            if(fileInput.files.length > 0) base64Image = await new Promise(res => { let reader = new FileReader(); reader.onload = e => res(e.target.result); reader.readAsDataURL(fileInput.files[0]); });
            if(d && a>0) { await setVal('safeBalance', await getVal('safeBalance')-a); await db.expenses.add({id:Date.now(), timestamp: Date.now(), date:new Date().toLocaleDateString(), desc:d, amount:a, type:'general', receipt: base64Image}); if(activeCycle) { activeCycle.totalCost+=a; await db.cycles.put(activeCycle); } toastSuccess("تم החفظ"); genericModal.hide(); refreshUI(); if(document.getElementById('view-accounting').classList.contains('active')) updateGridData(); }
        });
    } else if (type === 'feedModal') {
        buildModal('شراء علف', `<input type="number" id="m-b" class="form-control mb-2" placeholder="العدد (شكاير)"><input type="number" id="m-c" class="form-control" placeholder="إجمالي التكلفة">`, async () => {
            let b=parseInt(document.getElementById('m-b').value), c=parseFloat(document.getElementById('m-c').value);
            if(b>0 && c>0){ await setVal('feedStock', await getVal('feedStock')+b); await setVal('safeBalance', await getVal('safeBalance')-c); await db.expenses.add({id:Date.now(), timestamp:Date.now(), date:new Date().toLocaleDateString(), desc:`شراء ${b} شكارة علف`, amount:c, type:'feed'}); if(activeCycle){ activeCycle.totalCost+=c; await db.cycles.put(activeCycle); } toastSuccess("تم الشراء"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'startCycleModal') {
        buildModal('دورة جديدة', `<input type="text" id="m-n" class="form-control mb-2" placeholder="الاسم (مثال: دفعة مايو)"><input type="number" id="m-b" class="form-control mb-2" placeholder="عدد الكتاكيت"><input type="number" id="m-c" class="form-control" placeholder="التكلفة">`, async () => {
            let n=document.getElementById('m-n').value, b=parseInt(document.getElementById('m-b').value), c=parseFloat(document.getElementById('m-c').value);
            if(n && b>0){ await db.cycles.add({id:Date.now(), name:n, startDate:new Date().toISOString(), status:'active', birds:b, mortality:0, feedConsumed:0, avgWeight:0.05, totalCost:c, sales:0}); await setVal('safeBalance', await getVal('safeBalance')-c); await db.expenses.add({id:Date.now(), timestamp:Date.now(), date:new Date().toLocaleDateString(), desc:`كتاكيت دورة: ${n}`, amount:c, type:'chicks'}); toastSuccess("بدأت الدورة!"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'sellModal' && activeCycle) {
        buildModal('تسجيل مبيعات', `<input type="number" id="m-w" class="form-control mb-2" placeholder="الوزن المباع (كجم)"><input type="number" id="m-p" class="form-control mb-2" placeholder="سعر الكيلو"><input type="number" id="m-b" class="form-control" placeholder="عدد الطيور لخصمها">`, async () => {
            let w=parseFloat(document.getElementById('m-w').value), p=parseFloat(document.getElementById('m-p').value), b=parseInt(document.getElementById('m-b').value);
            if(w>0 && p>0){ let t=w*p; await setVal('safeBalance', await getVal('safeBalance')+t); activeCycle.sales+=t; activeCycle.birds-=b; await db.expenses.add({id:Date.now(), timestamp:Date.now(), date:new Date().toLocaleDateString(), desc:`مبيعات (${w}كجم)`, amount:-t, type:'sale'}); await db.cycles.put(activeCycle); toastSuccess(`تم تحصيل ${t} ج`); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'editCycleModal' && activeCycle) {
        buildModal('تعديل بيانات الدورة', `<label class="small text-muted">العدد الفعلي</label><input type="number" id="m-b" class="form-control mb-2" value="${activeCycle.birds}"><label class="small text-muted">العلف المسحوب (شكارة)</label><input type="number" id="m-f" class="form-control mb-2" value="${activeCycle.feedConsumed}"><label class="small text-muted">إجمالي التكلفة</label><input type="number" id="m-c" class="form-control" value="${activeCycle.totalCost}">`, async () => {
            activeCycle.birds=parseInt(document.getElementById('m-b').value); activeCycle.feedConsumed=parseFloat(document.getElementById('m-f').value); activeCycle.totalCost=parseFloat(document.getElementById('m-c').value); await db.cycles.put(activeCycle); toastSuccess("تم التعديل"); genericModal.hide(); refreshUI();
        });
    } else if (type === 'medicineModal') {
        buildModal('شراء دواء', `<input type="text" id="m-n" class="form-control mb-2" placeholder="الاسم"><input type="text" id="m-bar" class="form-control mb-2" placeholder="باركود (اختياري)"><input type="number" id="m-q" class="form-control mb-2" placeholder="الكمية"><input type="number" id="m-c" class="form-control" placeholder="التكلفة">`, async () => {
            let n=document.getElementById('m-n').value, bar=document.getElementById('m-bar').value, q=parseFloat(document.getElementById('m-q').value), c=parseFloat(document.getElementById('m-c').value);
            if(n&&q){ await db.medicine.add({id:Date.now(), name:n, barcode:bar, qty:q, cost:c}); await setVal('safeBalance', await getVal('safeBalance')-c); await db.expenses.add({id:Date.now(), timestamp:Date.now(), date:new Date().toLocaleDateString(), desc:`دواء: ${n}`, amount:c, type:'med'}); if(activeCycle){activeCycle.totalCost+=c; await db.cycles.put(activeCycle);} toastSuccess("تم تخزين الدواء"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'workerModal') {
        buildModal('إضافة عامل', `<input type="text" id="m-n" class="form-control mb-2" placeholder="الاسم"><input type="number" id="m-s" class="form-control" placeholder="الراتب الشهري">`, async () => {
            let n=document.getElementById('m-n').value, s=parseFloat(document.getElementById('m-s').value);
            if(n&&s>0){ await db.workers.add({id:Date.now(), name:n, salary:s, lastPaid:new Date().toISOString()}); toastSuccess("تم إضافة العامل"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'recurringModal') {
        buildModal('مصروف دوري', `<input type="text" id="m-n" class="form-control mb-2" placeholder="مثال: إيجار، إنترنت"><input type="number" id="m-a" class="form-control mb-2" placeholder="المبلغ"><input type="number" id="m-d" class="form-control" placeholder="يوم الاستحقاق (1-31)">`, async () => {
            let n=document.getElementById('m-n').value, a=parseFloat(document.getElementById('m-a').value), d=parseInt(document.getElementById('m-d').value);
            if(n&&a&&d){ await db.recurring.add({id:Date.now(), name:n, amount:a, dueDay:d}); toastSuccess("تم الحفظ"); genericModal.hide(); refreshUI(); }
        });
    } else if (type === 'contactModal') {
        buildModal('إضافة جهة اتصال', `<input type="text" id="m-n" class="form-control mb-2" placeholder="الاسم"><input type="text" id="m-p" class="form-control mb-2" placeholder="الموبايل"><select id="m-t" class="form-select"><option>مورد</option><option>عميل</option></select>`, async () => {
            let n=document.getElementById('m-n').value, p=document.getElementById('m-p').value, t=document.getElementById('m-t').value;
            if(n){ await db.contacts.add({id:Date.now(), name:n, phone:p, type:t}); toastSuccess("تم الإضافة للدليل"); genericModal.hide(); refreshUI(); }
        });
    }
};

window.doQuickAction = async function(type) {
    let active = (await db.cycles.where('status').equals('active').toArray())[0];
    bootstrap.Modal.getInstance(document.getElementById('quickActionModal')).hide();
    if (!active) return toastError("عفواً، لا توجد دورة نشطة!");
    
    if (type === 'mortality') {
        buildModal('نافِق', `<input type="number" id="m-v" class="form-control" placeholder="العدد">`, async () => { let v=parseInt(document.getElementById('m-v').value); if(v>0){ active.mortality+=v; active.birds-=v; await db.cycles.put(active); toastSuccess("تم التسجيل"); genericModal.hide(); refreshUI();} });
    } else if (type === 'feed') {
        buildModal('سحب علف', `<input type="number" id="m-v" class="form-control" placeholder="عدد الشكاير">`, async () => { let v=parseFloat(document.getElementById('m-v').value); let s=await getVal('feedStock'); if(v>0 && s>=v){ await setVal('feedStock', s-v); active.feedConsumed+=v; await db.cycles.put(active); toastSuccess("تم السحب"); genericModal.hide(); refreshUI();} else toastError("رصيد العلف بالمخزن لا يكفي!"); });
    } else if (type === 'weight') {
        buildModal('الوزن', `<input type="number" id="m-v" class="form-control" placeholder="متوسط الوزن (كجم)">`, async () => { let v=parseFloat(document.getElementById('m-v').value); if(v>0){ active.avgWeight=v; await db.cycles.put(active); toastSuccess("تم التحديث"); genericModal.hide(); refreshUI();} });
    }
};

// ================= MANAGEMENT ACTIONS =================
window.payWorker = async function(id) {
    let w = await db.workers.get(id); let activeCycle = (await db.cycles.where('status').equals('active').toArray())[0];
    Swal.fire({title:`صرف ${w.salary}ج لـ ${w.name}؟`, showCancelButton:true, confirmButtonText:'نعم، اصرف'}).then(async r => {
        if(r.isConfirmed){ await setVal('safeBalance', await getVal('safeBalance')-w.salary); w.lastPaid=new Date().toISOString(); await db.workers.put(w); await db.expenses.add({id:Date.now(), timestamp:Date.now(), date:new Date().toLocaleDateString(), desc:`راتب ${w.name}`, amount:w.salary, type:'salary'}); if(activeCycle){ activeCycle.totalCost+=w.salary; await db.cycles.put(activeCycle); } toastSuccess("تم الصرف"); refreshUI(); }
    });
};
window.useMedicine = async function(id) {
    let med = await db.medicine.get(id);
    buildModal(`سحب ${med.name}`, `<p class="small text-muted mb-2">المتاح حالياً: ${med.qty}</p><input type="number" id="m-q" class="form-control" placeholder="الكمية المسحوبة">`, async () => {
        let u=parseFloat(document.getElementById('m-q').value); if(u>0 && u<=med.qty){ med.qty-=u; if(med.qty<=0) await db.medicine.delete(id); else await db.medicine.put(med); toastSuccess("تم الاستخدام"); genericModal.hide(); refreshUI(); } else toastError("رصيد غير كاف");
    });
};
window.deleteContact = function(id) { Swal.fire({title:'حذف؟', icon:'warning', showCancelButton:true, confirmButtonText:'نعم'}).then(async r=>{ if(r.isConfirmed){ await db.contacts.delete(id); refreshUI();} }); };
window.closeCycle = async function(id) {
    let cycle = await db.cycles.get(id);
    Swal.fire({title:'إنهاء وتوليد تقرير (P&L)؟', icon:'info', showCancelButton:true, confirmButtonText:'إنهاء وطباعة PDF'}).then(async r => {
        if(r.isConfirmed){ cycle.status='closed'; cycle.endDate=new Date().toISOString(); await db.cycles.put(cycle); toastSuccess("تم إغلاق الدورة!"); await refreshUI(); generatePnLPDF(cycle); }
    });
};

// ================= BARCODE SCANNER =================
window.startBarcodeScan = function() {
    document.getElementById('qr-reader').style.display = 'block';
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    html5QrcodeScanner.render(async (text) => {
        html5QrcodeScanner.clear(); document.getElementById('qr-reader').style.display = 'none'; playBeep();
        let med = (await db.medicine.where('barcode').equals(text).toArray())[0];
        if(med) Swal.fire('تم التعرف', `الصنف: ${med.name} | المتاح: ${med.qty}`, 'success'); else Swal.fire('غير مسجل', `الباركود غير موجود بالمخزن`, 'error');
    }, () => {});
};

// ================= P&L PDF EXPORT =================
function generatePnLPDF(cycle) {
    document.getElementById('pdf-cycle-name').innerText = cycle.name; document.getElementById('pdf-cycle-dates').innerText = `من: ${new Date(cycle.startDate).toLocaleDateString()} | إلى: ${new Date(cycle.endDate).toLocaleDateString()}`;
    document.getElementById('pdf-costs').innerText = cycle.totalCost.toLocaleString(); document.getElementById('pdf-sales').innerText = cycle.sales.toLocaleString();
    document.getElementById('pdf-net').innerText = (cycle.sales - cycle.totalCost).toLocaleString(); document.getElementById('pdf-birds').innerText = (cycle.birds + cycle.mortality);
    document.getElementById('pdf-mortality').innerText = cycle.mortality; document.getElementById('pdf-feed').innerText = (cycle.feedConsumed * 50) + " كجم";
    document.getElementById('pdf-fcr').innerText = (cycle.birds * cycle.avgWeight) > 0 ? ((cycle.feedConsumed * 50) / (cycle.birds * cycle.avgWeight)).toFixed(2) : 0;

    html2canvas(document.getElementById('pdf-template-container'), {scale: 2}).then(canvas => {
        const { jsPDF } = window.jspdf; let pdf = new jsPDF('p', 'mm', 'a4');
        pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', 10, 10, 190, (canvas.height * 190) / canvas.width);
        pdf.save(`PnL_Report_${cycle.name}.pdf`);
    });
}

// ================= GRID & FILTERS =================
async function initGrid() {
    expensesGridInstance = new gridjs.Grid({
        columns: ["التاريخ", "البيان", "المبلغ", {name: "إيصال", formatter: (cell) => cell ? gridjs.html(`<button class='btn btn-sm btn-info py-0' onclick='viewReceipt("${cell}")'><i class='fa-solid fa-image'></i></button>`) : "-"}],
        data: [], pagination: { limit: 5 }, language: { search: { placeholder: "بحث في الفواتير..." }, pagination: { previous: "السابق", next: "التالي", showing: "عرض" } }
    }).render(document.getElementById("expenses-grid-wrapper"));
}
window.viewReceipt = function(base64) { Swal.fire({imageUrl: base64, imageAlt: 'فاتورة', width: 'auto'}); };
window.applyExpenseFilter = async function() { await updateGridData(); };
window.clearExpenseFilter = async function() { document.getElementById('filter-start').value=''; document.getElementById('filter-end').value=''; await updateGridData(); };

async function updateGridData() {
    let start = document.getElementById('filter-start').value, end = document.getElementById('filter-end').value;
    let query = db.expenses.orderBy('timestamp').reverse();
    if(start && end) { let sTime=new Date(start).getTime(), eTime=new Date(end).getTime()+86400000; query=db.expenses.where('timestamp').between(sTime, eTime).reverse(); }
    let data = await query.toArray();
    expensesGridInstance.updateConfig({ data: data.map(e => [e.date, e.desc, `${e.amount<0?'+':'-'}${Math.abs(e.amount)} ج`, e.receipt||""]) }).forceRender();
}

// ================= CHARTS =================
async function renderCharts(activeCycle) {
    if(activeCycle) {
        let exps = await db.expenses.where('timestamp').above(new Date(activeCycle.startDate).getTime()).toArray();
        let f=0, c=0, m=0, g=0; exps.forEach(e => { if(e.amount>0) { if(e.type==='feed') f+=e.amount; else if(e.type==='chicks') c+=e.amount; else if(e.type==='med') m+=e.amount; else g+=e.amount; }});
        if(expenseDoughnut) expenseDoughnut.destroy();
        expenseDoughnut = new Chart(document.getElementById('expenseDoughnutChart'), { type: 'doughnut', data: { labels: ['علف', 'كتاكيت', 'أدوية', 'عمال ونثريات'], datasets: [{ data: [f, c, m, g], backgroundColor: ['#ffc107', '#198754', '#0dcaf0', '#dc3545'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    }
    const ctxB = document.getElementById('historyBarChart'); if(!ctxB) return;
    let cycles = await db.cycles.where('status').equals('closed').toArray();
    let labels = cycles.slice(-5).map(c => c.name), profits = cycles.slice(-5).map(c => c.sales - c.totalCost);
    if(historyBar) historyBar.destroy();
    historyBar = new Chart(ctxB, { type: 'bar', data: { labels: labels, datasets: [{ label: 'الصافي (أرباح/خسائر)', data: profits, backgroundColor: profits.map(p => p >= 0 ? '#198754' : '#dc3545') }] } });
}

// ================= UI REFRESH =================
async function refreshUI() {
    document.getElementById('total-cash').innerText = (await getVal('safeBalance')).toLocaleString();
    document.getElementById('acc-capital').innerText = (await getVal('capital')).toLocaleString() + ' ج.م';
    document.getElementById('inv-feed-stock').innerText = await getVal('feedStock');
    
    let active = (await db.cycles.where('status').equals('active').toArray())[0];
    if(active) {
        document.getElementById('kpi-birds').innerText = active.birds;
        document.getElementById('kpi-fcr').innerText = (active.birds * active.avgWeight) > 0 ? ((active.feedConsumed * 50) / (active.birds * active.avgWeight)).toFixed(2) : 0;
        document.getElementById('kpi-breakeven').innerText = (active.birds * active.avgWeight) > 0 ? (active.totalCost / (active.birds * active.avgWeight)).toFixed(2) : 0;
        let age = Math.floor((new Date() - new Date(active.startDate)) / 86400000) + 1;
        
        document.getElementById('active-cycle-container').innerHTML = `
            <div class="card shadow-sm border-0 border-start border-success border-4"><div class="card-body">
                <div class="d-flex justify-content-between align-items-center mb-2"><h5 class="text-success mb-0">${active.name}</h5><div><span class="badge bg-warning text-dark me-2">العمر: ${age} يوم</span><button class="btn btn-sm btn-outline-secondary" onclick="openModal('editCycleModal')"><i class="fa-solid fa-pen"></i></button></div></div>
                <hr class="my-2"><div class="d-flex justify-content-between mb-1"><span>العدد الحالي:</span> <strong>${active.birds}</strong></div>
                <div class="d-flex justify-content-between mb-1"><span>إجمالي التكلفة:</span> <strong class="text-danger">${active.totalCost.toLocaleString()} ج</strong></div>
                <button class="btn btn-sm btn-danger w-100 mt-2" onclick="closeCycle(${active.id})">إنهاء الدورة وتوليد (PDF)</button>
            </div></div>`;
        document.getElementById('vaccine-schedule').innerHTML = [{d:7, n:"هتشنر"}, {d:14, n:"جمبورو"}, {d:21, n:"لاسوتا"}, {d:28, n:"جرعة منشطة"}].map(v => `<div class="timeline-item ${age>v.d?'past':(age===v.d?'today':'future')}"><div class="d-flex justify-content-between"><strong>يوم ${v.d}: ${v.n}</strong><span class="badge bg-light text-dark border">${age>v.d?'تم':(age===v.d?'اليوم!':`باقي ${v.d-age}`)}</span></div></div>`).join('');
    } else {
        ['kpi-birds', 'kpi-fcr', 'kpi-breakeven'].forEach(id => document.getElementById(id).innerText='0');
        document.getElementById('active-cycle-container').innerHTML = `<button class="btn btn-success w-100 py-3 shadow-sm" onclick="openModal('startCycleModal')"><i class="fa-solid fa-plus"></i> بدء دورة جديدة</button>`;
        document.getElementById('vaccine-schedule').innerHTML = `<p class="text-muted small">لا توجد دورة نشطة</p>`;
    }

    document.getElementById('workers-list').innerHTML = (await db.workers.toArray()).map(w => `<div class="list-group-item d-flex justify-content-between align-items-center"><div><b><i class="fa-solid fa-user text-secondary"></i> ${w.name}</b><br><small class="text-muted">آخر صرف: ${new Date(w.lastPaid).toLocaleDateString()}</small></div><button class="btn btn-sm btn-success rounded-pill px-3" onclick="payWorker(${w.id})">صرف ${w.salary} ج</button></div>`).join('') || '<p class="p-3 text-center text-muted small m-0">لا يوجد عمال</p>';
    document.getElementById('recurring-list').innerHTML = (await db.recurring.toArray()).map(r => `<div class="list-group-item d-flex justify-content-between"><span>${r.name} (يوم ${r.dueDay})</span><b class="text-primary">${r.amount} ج</b></div>`).join('') || '<p class="p-3 text-center text-muted small m-0">لا توجد إيجارات</p>';
    document.getElementById('medicine-list').innerHTML = (await db.medicine.toArray()).map(m => `<div class="col-6"><div class="card p-2 shadow-sm border-0 border-start border-info border-3"><small class="text-muted">${m.name}</small><div class="d-flex justify-content-between align-items-center mt-1"><b>${m.qty}</b><button class="btn btn-sm btn-outline-info py-0 px-2" onclick="useMedicine(${m.id})">سحب</button></div></div></div>`).join('') || '<p class="p-3 text-center text-muted small m-0 w-100">المخزن فارغ</p>';
    document.getElementById('contacts-list').innerHTML = (await db.contacts.toArray()).map(c => `<div class="col-12"><div class="card shadow-sm border-0 border-end border-4 ${c.type==='مورد'?'border-danger':'border-success'}"><div class="card-body py-2 d-flex justify-content-between align-items-center"><div><h6 class="mb-0 fw-bold">${c.name} <span class="badge bg-light text-dark border">${c.type}</span></h6><a href="tel:${c.phone}" class="text-decoration-none text-muted small"><i class="fa-solid fa-phone"></i> ${c.phone}</a></div><button class="btn btn-sm text-danger" onclick="deleteContact(${c.id})"><i class="fa-solid fa-trash"></i></button></div></div></div>`).join('') || '<p class="p-3 text-center text-muted small m-0 w-100">لا يوجد موردين</p>';
    
    // التنبيهات
    let alerts = []; let td = new Date().getDate();
    if(currentTemp>=32) alerts.push({t:`طوارئ حرارة: ${currentTemp}°C! شغل خلايا التبريد`, c:'danger'});
    if(await getVal('feedStock') <= 5) alerts.push({t:`علف منخفض: باقي ${await getVal('feedStock')} شكارة`, c:'warning'});
    (await db.recurring.toArray()).forEach(r => { if(Math.abs(r.dueDay - td) <= 2) alerts.push({t:`استحقاق ${r.name} (يوم ${r.dueDay})`, c:'warning'}); });
    document.getElementById('smart-alerts-container').innerHTML = alerts.map(a => `<div class="alert alert-${a.c} alert-sm shadow-sm mb-2"><i class="fa-solid fa-bell"></i> ${a.t}</div>`).join('');
    
    await renderCharts(active);
}
