// MZJ UI helpers (global) — sidebar toggle + theme + clock
(function () {
  const shell = document.getElementById('mzjShell');
  const sidebar = document.getElementById('mzjSidebar');
  const sidebarBtn = document.getElementById('mzjSidebarBtn');
  const backdrop = document.getElementById('mzjBackdrop');
  const themeBtn = document.getElementById('mzjThemeBtn');
  const nowEl = document.getElementById('mzjNow');

  const mqDesktop = window.matchMedia('(min-width: 1024px)');
  const isDesktop = () => mqDesktop.matches;

  function closeMobile(){ shell?.classList.remove('sidebar-open'); }
  function toggleMobile(){ shell?.classList.toggle('sidebar-open'); }

  function setCollapsed(v){
    if (!shell) return;
    shell.classList.toggle('sidebar-collapsed', !!v);
    localStorage.setItem('mzj_sidebar_collapsed', v ? '1' : '0');
  }

  // Restore collapse state on desktop
  if (isDesktop() && localStorage.getItem('mzj_sidebar_collapsed') === '1') setCollapsed(true);

  mqDesktop.addEventListener?.('change', () => {
    closeMobile();
    if (isDesktop()){
      setCollapsed(localStorage.getItem('mzj_sidebar_collapsed') === '1');
    } else {
      shell?.classList.remove('sidebar-collapsed');
    }
  });

  sidebarBtn?.addEventListener('click', () => {
    if (!shell) return;
    if (isDesktop()){
      setCollapsed(!shell.classList.contains('sidebar-collapsed'));
    } else {
      toggleMobile();
    }
  });

  backdrop?.addEventListener('click', closeMobile);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobile(); });

  sidebar?.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    if (!isDesktop()) closeMobile();
  });

  // Theme
  const savedTheme = localStorage.getItem('mzj_theme');
  if (savedTheme === 'dark') document.body.classList.add('dark');
  themeBtn?.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('mzj_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });

  // Clock
  function tick(){
    try{
      const dt = new Date();
      const fmt = new Intl.DateTimeFormat('ar-SA', {
        weekday:'short', year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'Asia/Riyadh'
      });
      if (nowEl) nowEl.textContent = fmt.format(dt);
    }catch(_){
      if (nowEl) nowEl.textContent = new Date().toLocaleString('ar-SA');
    }
  }
  tick(); setInterval(tick, 15000);
})();

// ===============================
// MZJ Activity Logger (global)
// - Logs important writes to Firestore into collection: mzj_activity_log
// - Supports Firebase v10 modular pages via wrappers (mzjSetDoc/mzjUpdateDoc)
// - Supports Firebase v8 compat pages via prototype patch (wrapCompat)
// ===============================
(function () {
  if (window.mzjActivity) return;

  const state = {
    db: null,
    collection: null,
    addDoc: null,
    serverTimestamp: null,
    getDoc: null,
    user: { uid:null, email:null, name:null, role:null }
  };

  function safeStr(v){ try{ return (v==null)?'':String(v); }catch(_){ return ''; } }
  function pickSummary(obj){
    try{
      const out = {};
      if(!obj || typeof obj!=='object') return out;
      // Summaries for very large blobs (stock/moves/models arrays)
      if(Array.isArray(obj.stock)) out.stockCount = obj.stock.length;
      if(Array.isArray(obj.moves)) out.movesCount = obj.moves.length;
      if(Array.isArray(obj.models)) out.modelsCount = obj.models.length;
      // Copy a few small scalar fields if present
      ['status','kind','total','action','date','details','userEmail','userName'].forEach(k=>{
        if(obj[k]!=null && typeof obj[k] !== 'object') out[k]=obj[k];
      });
      return out;
    }catch(_){ return {}; }
  }

  async function writeLog(payload){
    try{
      if(!state.db || !state.addDoc || !state.collection) return;
      const colRef = state.collection(state.db, 'mzj_activity_log');
      const docPayload = {
        action: payload.action || 'تحديث',
        details: payload.details || '',
        refPath: payload.refPath || '',
        entity: payload.entity || '',
        before: payload.before || null,
        after: payload.after || null,
        userUid: payload.userUid || state.user.uid || null,
        userEmail: payload.userEmail || state.user.email || null,
        userName: payload.userName || state.user.name || null,
        userRole: payload.userRole || state.user.role || null,
        ts: state.serverTimestamp ? state.serverTimestamp() : new Date(),
        date: new Date().toISOString().slice(0,10),
      };
      // Prevent huge docs
      if(docPayload.details && docPayload.details.length > 900) docPayload.details = docPayload.details.slice(0,900) + '…';
      await state.addDoc(colRef, docPayload);
    }catch(e){
      // silent (no UX impact)
      console.warn('mzjActivity log failed', e);
    }
  }

  function initModular({db, collection, addDoc, serverTimestamp, getDoc}){
    state.db = db;
    state.collection = collection;
    state.addDoc = addDoc;
    state.serverTimestamp = serverTimestamp;
    state.getDoc = getDoc;
  }

  function setUserContext(u){
    state.user = Object.assign(state.user, u||{});
  }

  function inferActionFromPath(path, dataKeys){
    const p = safeStr(path);
    const keys = Array.isArray(dataKeys) ? dataKeys : [];
    if(p.startsWith('requests/')) return 'تحديث طلب';
    if(p.startsWith('mzj_admin_state/')) {
      if(keys.includes('stock') || keys.includes('moves')) return 'تحديث المخزون/النقل';
      if(keys.includes('shootRequests') || keys.includes('moveRequests')) return 'تحديث ملخص الطلبات';
      return 'تحديث حالة النظام';
    }
    if(p.startsWith('cars/')) return 'تعديل سيارة';
    return 'تحديث';
  }

  async function modularSetDoc({setDoc, ref, data, options, meta}){
    const refPath = safeStr(ref && ref.path);
    const keys = data && typeof data==='object' ? Object.keys(data) : [];
    let beforeSnap=null, before=null;
    try{
      if(state.getDoc && ref && typeof refPath==='string' && refPath){
        beforeSnap = await state.getDoc(ref);
        before = beforeSnap && beforeSnap.exists ? pickSummary(beforeSnap.data()) : null;
      }
    }catch(_e){}
    const res = await setDoc(ref, data, options);
    const after = pickSummary(data);
    const action = (meta && meta.action) || inferActionFromPath(refPath, keys);
    const details = (meta && meta.details) || `تم حفظ بيانات (${keys.join(', ')||'—'})`;
    await writeLog({ action, details, refPath, entity: (meta&&meta.entity)||'', before, after });
    return res;
  }

  async function modularUpdateDoc({updateDoc, ref, data, meta}){
    const refPath = safeStr(ref && ref.path);
    const keys = data && typeof data==='object' ? Object.keys(data) : [];
    let beforeSnap=null, before=null;
    try{
      if(state.getDoc && ref && typeof refPath==='string' && refPath){
        beforeSnap = await state.getDoc(ref);
        before = beforeSnap && beforeSnap.exists ? pickSummary(beforeSnap.data()) : null;
      }
    }catch(_e){}
    const res = await updateDoc(ref, data);
    const after = pickSummary(data);
    const action = (meta && meta.action) || inferActionFromPath(refPath, keys);
    const details = (meta && meta.details) || `تم تحديث بيانات (${keys.join(', ')||'—'})`;
    await writeLog({ action, details, refPath, entity: (meta&&meta.entity)||'', before, after });
    return res;
  }

  // Firebase v8 compat patch (used in photoshoot-user.html)
  function wrapCompat(firebase, db, userResolver){
    try{
      if(!firebase || !firebase.firestore || !firebase.firestore.DocumentReference) return;
      if(firebase.firestore.__mzjPatched) return;
      firebase.firestore.__mzjPatched = true;

      const DocRef = firebase.firestore.DocumentReference;
      const ColRef = firebase.firestore.CollectionReference;
      const Batch = firebase.firestore.WriteBatch;

      const origSet = DocRef.prototype.set;
      const origUpdate = DocRef.prototype.update;
      const origDelete = DocRef.prototype.delete;
      const origAdd = ColRef.prototype.add;
      const origBatchCommit = Batch.prototype.commit;

      async function compatLog(action, refPath, details){
        try{
          const u = (typeof userResolver==='function') ? (userResolver()||{}) : {};
          await db.collection("mzj_activity_log").add({
            action: action || 'تحديث',
            details: details || '',
            refPath: refPath || '',
            userUid: u.uid || null,
            userEmail: u.email || null,
            userName: u.name || null,
            userRole: u.role || null,
            ts: firebase.firestore.FieldValue.serverTimestamp(),
            date: new Date().toISOString().slice(0,10),
          });
        }catch(_e){}
      }

      DocRef.prototype.set = function(data, options){
        const path = this.path || '';
        const keys = data && typeof data==='object' ? Object.keys(data) : [];
        return origSet.call(this, data, options).then(async (r)=>{
          await compatLog(inferActionFromPath(path, keys), path, `set: ${keys.join(', ')||'—'}`);
          return r;
        });
      };

      DocRef.prototype.update = function(data){
        const path = this.path || '';
        const keys = data && typeof data==='object' ? Object.keys(data) : [];
        return origUpdate.call(this, data).then(async (r)=>{
          await compatLog(inferActionFromPath(path, keys), path, `update: ${keys.join(', ')||'—'}`);
          return r;
        });
      };

      DocRef.prototype.delete = function(){
        const path = this.path || '';
        return origDelete.call(this).then(async (r)=>{
          await compatLog('حذف', path, 'delete');
          return r;
        });
      };

      ColRef.prototype.add = function(data){
        const path = (this.path || '') + '/(autoId)';
        const keys = data && typeof data==='object' ? Object.keys(data) : [];
        return origAdd.call(this, data).then(async (r)=>{
          await compatLog(inferActionFromPath(this.path||'', keys), this.path||'', `add: ${keys.join(', ')||'—'}`);
          return r;
        });
      };

      Batch.prototype.commit = function(){
        // Don't spam per op; single commit entry
        const path = '(batch)';
        return origBatchCommit.call(this).then(async (r)=>{
          await compatLog('تحديث دفعة واحدة', path, 'batch.commit');
          return r;
        });
      };

    }catch(e){
      console.warn('wrapCompat failed', e);
    }
  }

  window.mzjActivity = {
    initModular,
    setUserContext,
    modularSetDoc,
    modularUpdateDoc,
    wrapCompat,
    _debugState: state
  };
})();
