// إنشاء قاعدة البيانات الحديثة وتجهيز الجداول
const db = new Dexie('FarmERP_Database');
db.version(1).stores({
    keyval: 'key', // للقيم المفردة زي الخزنة ورأس المال
    expenses: 'id, timestamp, date, type, amount', // الفواتير والصور
    cycles: 'id, status', // الدورات
    medicine: 'id, barcode', // الأدوية
    workers: 'id',
    recurring: 'id'
});

// دوال للتعامل مع المتغيرات الفردية بسهولة
async function getVal(key, defaultVal = 0) {
    let rec = await db.keyval.get(key);
    return rec ? rec.value : defaultVal;
}
async function setVal(key, value) {
    await db.keyval.put({ key: key, value: value });
}

// ==========================================
// MIGRATION: استيراد البيانات القديمة والجديدة
// ==========================================
window.importLegacyData = function(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.safeBalance !== undefined || data.expenses) {
                Swal.fire({ title: 'جاري التحديث...', text: 'يتم نقل بياناتك للقاعدة الاحترافية الجديدة', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
                
                // ترحيل القيم الأساسية
                await setVal('capital', data.capital || 0);
                await setVal('safeBalance', data.safeBalance || 0);
                await setVal('feedStock', data.inventory?.feed || 0);

                // ترحيل المصفوفات
                if(data.cycles) await db.cycles.bulkPut(data.cycles);
                if(data.workers) await db.workers.bulkPut(data.workers);
                if(data.medicine) await db.medicine.bulkPut(data.medicine);
                if(data.recurring) await db.recurring.bulkPut(data.recurring);
                
                // ترحيل المصروفات مع إضافة Timestamp زمني للفلترة المتقدمة
                if(data.expenses) {
                    let exps = data.expenses.map(exp => {
                        exp.timestamp = exp.timestamp || new Date(exp.date).getTime();
                        return exp;
                    });
                    await db.expenses.bulkPut(exps);
                }
                
                Swal.fire('نجاح', 'تم استيراد كافة البيانات القديمة بنجاح!', 'success').then(() => location.reload());
            }
        } catch (err) { Swal.fire('خطأ', 'الملف غير صالح أو تالف', 'error'); }
    };
    reader.readAsText(file);
};

// تصدير كنسخة احتياطية
window.exportData = async function() {
    let exportObj = {
        capital: await getVal('capital'), safeBalance: await getVal('safeBalance'), inventory: { feed: await getVal('feedStock') },
        cycles: await db.cycles.toArray(), expenses: await db.expenses.toArray(), medicine: await db.medicine.toArray(), workers: await db.workers.toArray()
    };
    const blob = new Blob([JSON.stringify(exportObj)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Farm_Backup_Pro_${new Date().toISOString().split('T')[0]}.json`; a.click();
    Toastify({text: "تم تصدير النسخة بنجاح", duration: 3000, style: {background: "green"}}).showToast();
};