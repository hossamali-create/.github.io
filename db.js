// إنشاء قاعدة البيانات بـ Dexie (IndexedDB) لدعم آلاف السجلات والصور
const db = new Dexie('FarmERP_Final_DB');
db.version(1).stores({
    keyval: 'key', // للمتغيرات الفردية
    expenses: 'id, timestamp, date, type, amount', // الفواتير والصور
    cycles: 'id, status', // الدورات
    medicine: 'id, barcode', // الأدوية
    workers: 'id', // العمال
    recurring: 'id', // الإيجار الدوري
    contacts: 'id' // الموردين
});

// دوال مساعدة لجلب وحفظ القيم المفردة
async function getVal(key, defaultVal = 0) { let rec = await db.keyval.get(key); return rec ? rec.value : defaultVal; }
async function setVal(key, value) { await db.keyval.put({ key: key, value: value }); }

// ==========================================
// MIGRATION: استيراد البيانات القديمة
// ==========================================
window.importLegacyData = function(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.safeBalance !== undefined || data.expenses) {
                Swal.fire({ title: 'جاري تحديث البيانات...', text: 'يتم نقل بياناتك للقاعدة الاحترافية (Migration)', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
                
                // 1. ترحيل الأساسيات
                await setVal('capital', data.capital || 0);
                await setVal('safeBalance', data.safeBalance || 0);
                await setVal('feedStock', data.inventory?.feed || 0);

                // 2. ترحيل الجداول
                if(data.cycles) await db.cycles.bulkPut(data.cycles);
                if(data.workers) await db.workers.bulkPut(data.workers);
                if(data.medicine) await db.medicine.bulkPut(data.medicine);
                if(data.recurring) await db.recurring.bulkPut(data.recurring);
                if(data.contacts) await db.contacts.bulkPut(data.contacts);
                
                // 3. ترحيل المصروفات وضبط الـ Timestamp للفلاتر
                if(data.expenses) {
                    let exps = data.expenses.map(exp => { exp.timestamp = exp.timestamp || new Date(exp.date).getTime(); return exp; });
                    await db.expenses.bulkPut(exps);
                }
                
                Swal.fire('نجاح', 'تم استيراد كافة البيانات بنجاح!', 'success').then(() => location.reload());
            }
        } catch (err) { Swal.fire('خطأ', 'الملف غير صالح أو تالف', 'error'); }
    };
    reader.readAsText(file);
};

// تصدير JSON شامل
window.exportData = async function() {
    let exportObj = {
        capital: await getVal('capital'), safeBalance: await getVal('safeBalance'), inventory: { feed: await getVal('feedStock') },
        cycles: await db.cycles.toArray(), expenses: await db.expenses.toArray(), medicine: await db.medicine.toArray(), 
        workers: await db.workers.toArray(), recurring: await db.recurring.toArray(), contacts: await db.contacts.toArray()
    };
    const blob = new Blob([JSON.stringify(exportObj)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Farm_Backup_${new Date().toISOString().split('T')[0]}.json`; a.click();
};
