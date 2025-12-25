// --- FIREBASE CONFIGURATION (REPLACE WITH YOUR KEYS) ---
const firebaseConfig = {
  apiKey: "AIzaSyDuV3QgG8K5DDooao4Hjd2Ixi11sCjOhPk",
  authDomain: "study-15285.firebaseapp.com",
  projectId: "study-15285",
  storageBucket: "study-15285.firebasestorage.app",
  messagingSenderId: "44232947532",
  appId: "1:44232947532:web:785c2e11e33901233ac1e9",
  measurementId: "G-PPPEGWMJ01"
};

// Initialize Firebase (Check if loaded to avoid errors)
let auth, googleProvider;
try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    googleProvider = new firebase.auth.GoogleAuthProvider();
} catch (e) {
    console.error("Firebase initialization failed:", e);
}

// --- ROBUST DATA ENGINE ---
const DB_KEY = 'StudySync_Ultimate_v9';
const getLocalDateStr = (date = new Date()) => {
    const offset = date.getTimezoneOffset() * 60000;
    return (new Date(date - offset)).toISOString().split('T')[0];
};

const DB = {
    data: { 
        user: null, // Stores synced Firebase user info
        subjects: [], 
        chapters: {}, 
        sessions: [], 
        settings: { pomodoro: 25 }, 
        streak: { current: 0, lastLogin: null } 
    },
    
    init() {
        try {
            const stored = localStorage.getItem(DB_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                this.data = { ...this.data, ...parsed };
                if(!this.data.subjects) this.data.subjects = [];
                if(!this.data.sessions) this.data.sessions = [];
            }
        } catch(e) { console.error("DB Corrupt", e); }
        this.updateStreak();
        this.save();
    },

    save() { try { localStorage.setItem(DB_KEY, JSON.stringify(this.data)); } catch(e){} },
    
    // Updated: Uses Firebase Display Name
    setUser(displayName) { 
        const parts = displayName ? displayName.split(' ') : ['User', ''];
        this.data.user = { 
            firstName: parts[0], 
            lastName: parts.slice(1).join(' '),
            fullName: displayName
        }; 
        this.save(); 
    },
    
    clearUser() { this.data.user = null; this.save(); },

    updateStreak() {
        const today = getLocalDateStr();
        if(this.data.streak.lastLogin !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yStr = getLocalDateStr(yesterday);
            
            if(this.data.streak.lastLogin === yStr) this.data.streak.current++; 
            else if(this.data.streak.lastLogin !== today) this.data.streak.current = 1; 
            
            this.data.streak.lastLogin = today;
            this.save();
        }
    },

    addSubject(name) {
        const id = 'sub_' + Date.now();
        this.data.subjects.push({ id, name, progress: 0 });
        this.data.chapters[id] = [];
        this.save();
    },
    
    deleteSubject(id) {
        this.data.subjects = this.data.subjects.filter(s => s.id !== id);
        delete this.data.chapters[id];
        this.data.sessions = this.data.sessions.filter(s => s.subjectId !== id);
        this.save();
    },
    
    addChapter(subId, name) {
        const id = 'chap_' + Date.now() + Math.random().toString(16).slice(2);
        if(!this.data.chapters[subId]) this.data.chapters[subId] = [];
        this.data.chapters[subId].push({ id, name, status: 'bad' });
        this.calcProgress(subId);
    },
    
    updateChapter(subId, chapId, status) {
        const chap = this.data.chapters[subId].find(c => c.id === chapId);
        if(chap) { 
            chap.status = status; 
            this.calcProgress(subId); 
            if(status === 'excellent') App.triggerConfetti();
        }
    },
    
    deleteChapter(subId, chapId) {
        this.data.chapters[subId] = this.data.chapters[subId].filter(c => c.id !== chapId);
        this.calcProgress(subId);
        this.save();
    },
    
    calcProgress(subId) {
        const chaps = this.data.chapters[subId] || [];
        if(chaps.length === 0) { this.updateSubMeta(subId, 0); return; }
        let score = 0;
        chaps.forEach(c => {
            if(c.status === 'excellent') score += 100;
            else if(c.status === 'good') score += 50;
        });
        this.updateSubMeta(subId, Math.round(score / chaps.length));
    },
    
    updateSubMeta(id, prog) {
        const sub = this.data.subjects.find(s => s.id === id);
        if(sub) { sub.progress = prog; this.save(); }
    },

    logSession(subjectId, duration) {
        const now = new Date();
        const dateStr = getLocalDateStr(now);
        this.data.sessions.push({
            id: 'sess_' + Date.now(),
            subjectId, duration,
            date: dateStr,
            timestamp: now.getTime(),
            fullDate: now.toLocaleString()
        });
        this.save();
    },
    
    getStats(period, subId = null) {
        const todayStr = getLocalDateStr();
        const now = new Date();
        let total = 0;
        this.data.sessions.forEach(s => {
            if(subId && s.subjectId !== subId) return;
            if(period === 'daily' && s.date === todayStr) total += s.duration;
            else if(period === 'weekly') {
                const sessDate = new Date(s.date);
                const diff = Math.ceil(Math.abs(now - sessDate) / (1000*60*60*24));
                if(diff <= 7) total += s.duration;
            }
            else if(period === 'monthly') {
                const sessDate = new Date(s.date);
                if(sessDate.getMonth() === now.getMonth() && sessDate.getFullYear() === now.getFullYear()) total += s.duration;
            }
        });
        return total;
    },
    
    getHistory(subId) {
        return this.data.sessions.filter(s => s.subjectId === subId).sort((a,b)=>b.timestamp-a.timestamp);
    }
};

// --- APP CONTROLLER ---
const App = {
    activeSubjectId: null,
    timerInterval: null,
    startTime: null,
    elapsedTime: 0,
    isTimerRunning: false,
    currentTab: 'home',
    pendingChapters: [],
    pomodoroMode: false,
    pomodoroTime: 25 * 60, 

    init() {
        DB.init();
        if (typeof THREE !== 'undefined') this.initThreeJS();
        
        // Listen to Firebase Auth State Changes
        if(auth) {
            auth.onAuthStateChanged(user => {
                if (user) {
                    // User is signed in.
                    console.log("Logged in as:", user.displayName);
                    DB.setUser(user.displayName); // Sync Firebase user to Local DB
                    this.checkAuth(); // Update UI
                } else {
                    // User is signed out.
                    console.log("Logged out");
                    // Optionally clear DB user or keep local data
                    // DB.clearUser(); 
                    this.checkAuth();
                }
            });
        } else {
            console.error("Auth not initialized. Check config.");
        }
    },

    // Updated: Trigger Firebase Popup
    loginWithGoogle() {
        const statusEl = document.getElementById('login-status');
        if(statusEl) statusEl.innerText = "Connecting to Google...";
        
        auth.signInWithPopup(googleProvider)
            .then((result) => {
                this.showToast("Welcome " + result.user.displayName, "success");
            }).catch((error) => {
                console.error(error);
                if(statusEl) statusEl.innerText = "Error: " + error.message;
                this.showToast("Login Failed", "error");
            });
    },

    // Updated: Trigger Firebase SignOut
    logout() { 
        if(confirm("Sign out?")) { 
            auth.signOut().then(() => {
                DB.clearUser();
                location.reload(); 
            });
        } 
    },

    checkAuth() {
        const loginEl = document.getElementById('login-screen');
        const appEl = document.getElementById('app-container');
        
        // Check if DB has user (synced from Firebase)
        if(DB.data.user && DB.data.user.firstName) {
            if(loginEl) loginEl.classList.add('hidden');
            if(appEl) {
                appEl.classList.remove('hidden');
                appEl.classList.add('fade-in-up');
            }
            const nameEl = document.getElementById('header-username');
            if(nameEl) nameEl.innerText = DB.data.user.firstName;
            
            const streakEl = document.getElementById('streak-counter');
            if(streakEl) streakEl.innerText = `🔥 ${DB.data.streak.current} Day Streak`;
            
            this.renderHome();
        } else {
            if(loginEl) loginEl.classList.remove('hidden');
            if(appEl) appEl.classList.add('hidden');
        }
    },

    // ... (Utilities, RenderHome, and other functions remain exactly the same) ...
    // --- UTILITIES ---
    getGreeting() {
        const h = new Date().getHours();
        return h < 12 ? 'Good Morning' : (h < 18 ? 'Good Afternoon' : 'Good Evening');
    },
    
    formatTime(s) {
        if(s < 60) return s + 's';
        const h = Math.floor(s/3600);
        const m = Math.floor((s%3600)/60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    },
    
    showToast(msg, type = 'info') {
        const container = document.getElementById('toast-container');
        if(!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<i class="fas fa-${type==='success'?'check-circle':(type==='error'?'exclamation-circle':'info-circle')} text-2xl"></i><span class="font-bold text-sm">${msg}</span>`;
        container.appendChild(toast);
        void toast.offsetWidth;
        toast.classList.add('show');
        if(navigator.vibrate) navigator.vibrate(50);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    
    triggerConfetti() {
        if(typeof confetti === 'function') confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        if(navigator.vibrate) navigator.vibrate([100, 50, 100]);
    },
    vibrate(pattern) { if(navigator.vibrate) navigator.vibrate(pattern); },

    // --- EXPORT/IMPORT ---
    exportData() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(DB.data));
        const dl = document.createElement('a');
        dl.setAttribute("href", dataStr);
        dl.setAttribute("download", "study_backup_" + new Date().toISOString().split('T')[0] + ".json");
        document.body.appendChild(dl); dl.click(); dl.remove();
        this.showToast("Backup downloaded!", "success");
    },
    importData(input) {
        const file = input.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if(imported.subjects) { DB.data = imported; DB.save(); this.showToast("Data restored!", "success"); setTimeout(()=>location.reload(), 1000); }
            } catch(e) { this.showToast("Invalid File", "error"); }
        };
        reader.readAsText(file);
    },
    resetData() { if(confirm("Wipe ALL data?")) { localStorage.removeItem(DB_KEY); location.reload(); } },

    // --- VIEWS ---
    handleFabClick() { this.view === 'home' ? this.openModal('add-subject-modal') : this.openModal('chapter-modal'); },

    renderHome() {
        this.view = 'home'; this.currentTab = 'home'; this.activeSubjectId = null; this.checkMiniPlayer();
        const container = document.getElementById('main-content');
        if(!container) return;
        const userName = DB.data.user ? DB.data.user.firstName : 'Student';
        const subs = DB.data.subjects;
        const totalChaps = Object.values(DB.data.chapters).flat().length;
        const dailyTime = DB.getStats('daily');
        
        let html = `
            <div class="max-w-5xl mx-auto fade-in-up pb-20">
                <div class="mb-8">
                    <h2 class="text-4xl font-bold mb-1">${this.getGreeting()}, <span class="text-gradient">${userName}</span></h2>
                    <p class="text-slate-400">Ready to crush your goals today?</p>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 delay-100">
                    <div class="glass-panel p-4 rounded-2xl"><div class="text-slate-400 text-xs font-bold uppercase mb-1">Subjects</div><div class="text-2xl font-bold text-white">${subs.length}</div></div>
                    <div class="glass-panel p-4 rounded-2xl"><div class="text-slate-400 text-xs font-bold uppercase mb-1">Chapters</div><div class="text-2xl font-bold text-white">${totalChaps}</div></div>
                    <div class="glass-panel p-4 rounded-2xl"><div class="text-emerald-400 text-xs font-bold uppercase mb-1">Studied Today</div><div class="text-2xl font-bold text-white">${this.formatTime(dailyTime)}</div></div>
                    <div class="glass-panel p-4 rounded-2xl"><div class="text-amber-400 text-xs font-bold uppercase mb-1">Streak</div><div class="text-2xl font-bold text-white">${DB.data.streak.current} Days</div></div>
                </div>
                <div class="glass-panel p-5 rounded-2xl mb-8 border border-white/5">
                    <h3 class="text-sm font-bold uppercase text-slate-400 mb-3">Activity Map</h3>
                    <div id="heatmap-container" class="heatmap-grid overflow-x-auto pb-2 custom-scrollbar"></div>
                </div>
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold">Your Subjects</h3>
                    <button onclick="App.openModal('add-subject-modal')" class="bg-indigo-600 px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-500">New</button>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pb-20">
        `;
        if(subs.length === 0) html += `<div class="col-span-full py-16 text-center border border-dashed border-slate-700 rounded-3xl bg-slate-800/30"><button onclick="App.openModal('add-subject-modal')" class="text-indigo-400 font-bold">Create First Subject</button></div>`;
        else {
            subs.forEach(s => {
                const cCount = (DB.data.chapters[s.id]||[]).length;
                const barColor = s.progress >= 75 ? 'bg-emerald-500' : (s.progress >= 40 ? 'bg-amber-500' : 'bg-rose-500');
                const txtColor = s.progress >= 75 ? 'text-emerald-400' : (s.progress >= 40 ? 'text-amber-400' : 'text-rose-400');
                html += `
                    <div onclick="App.renderDetail('${s.id}')" class="glass-panel p-6 rounded-2xl cursor-pointer glass-card-hover group relative overflow-hidden">
                        <div class="flex justify-between items-start mb-6">
                            <div class="bg-slate-800 w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-white group-hover:bg-indigo-600 transition-colors"><i class="fas fa-book"></i></div>
                            <button onclick="event.stopPropagation(); App.deleteSubject('${s.id}')" class="text-slate-600 hover:text-red-400 transition-colors z-10 p-2"><i class="fas fa-trash-alt"></i></button>
                        </div>
                        <h3 class="font-bold text-lg text-white mb-1 truncate">${s.name}</h3>
                        <p class="text-xs text-slate-500 mb-4">${cCount} Chapters</p>
                        <div class="flex items-end justify-between">
                            <div class="w-full mr-4"><div class="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden"><div class="h-full ${barColor} transition-all duration-1000" style="width: ${s.progress}%"></div></div></div>
                            <span class="text-sm font-bold ${txtColor}">${s.progress}%</span>
                        </div>
                    </div>
                `;
            });
        }
        html += `</div></div>`;
        container.innerHTML = html;
        setTimeout(() => this.renderHeatmap(), 100);
    },

    renderHeatmap() {
        const container = document.getElementById('heatmap-container'); if(!container) return;
        const today = new Date(); const mapData = {};
        DB.data.sessions.forEach(s => { if(!mapData[s.date]) mapData[s.date] = 0; mapData[s.date] += s.duration; });
        let html = '';
        for(let i=0; i<365; i++) {
            const d = new Date(); d.setDate(today.getDate() - (364 - i));
            const dateStr = getLocalDateStr(d); const count = mapData[dateStr] || 0;
            let cls = 'heatmap-cell';
            if(count > 3600) cls += ' l4'; else if(count > 1800) cls += ' l3'; else if(count > 600) cls += ' l2'; else if(count > 0) cls += ' l1';
            html += `<div class="${cls}" title="${dateStr}: ${Math.round(count/60)}m"></div>`;
        }
        container.innerHTML = html;
    },

    renderDetail(subId) {
        this.view = 'detail'; this.activeSubjectId = subId;
        const sub = DB.data.subjects.find(s => s.id === subId); const container = document.getElementById('main-content');
        if(!sub) return this.renderHome();
        container.innerHTML = `
            <div class="max-w-5xl mx-auto fade-in-up h-full flex flex-col">
                <div class="flex items-center gap-4 mb-6">
                    <button onclick="App.renderHome()" class="p-3 bg-slate-800 rounded-xl hover:bg-slate-700"><i class="fas fa-arrow-left"></i></button>
                    <div class="flex-1"><h2 class="text-2xl font-bold text-white">${sub.name}</h2><p class="text-xs text-slate-400">Detailed View</p></div>
                    <div class="text-right bg-slate-800/50 px-4 py-2 rounded-xl border border-white/5"><div class="text-[10px] text-slate-400 uppercase tracking-wider">Progress</div><div class="text-xl font-bold text-indigo-400">${sub.progress}%</div></div>
                </div>
                <div class="flex p-1 bg-slate-800/50 rounded-xl mb-6 w-full md:w-fit border border-white/5">
                    <button onclick="App.switchTab('chapters')" id="tab-chapters" class="px-6 py-2 rounded-lg text-sm font-medium transition-all text-white bg-indigo-600 shadow-lg">Chapters</button>
                    <button onclick="App.switchTab('timer')" id="tab-timer" class="px-6 py-2 rounded-lg text-sm font-medium transition-all text-slate-400 hover:text-white">Timer</button>
                    <button onclick="App.switchTab('analytics')" id="tab-analytics" class="px-6 py-2 rounded-lg text-sm font-medium transition-all text-slate-400 hover:text-white">Analytics</button>
                </div>
                <div id="tab-content" class="flex-1 overflow-y-auto custom-scrollbar pb-20"></div>
            </div>
        `;
        this.switchTab('chapters');
    },

    switchTab(tab) {
        this.currentTab = tab; this.checkMiniPlayer();
        ['chapters','timer','analytics'].forEach(t => {
            const btn = document.getElementById(`tab-${t}`);
            if(btn) btn.className = t === tab ? "px-6 py-2 rounded-lg text-sm font-medium transition-all text-white bg-indigo-600 shadow-lg" : "px-6 py-2 rounded-lg text-sm font-medium transition-all text-slate-400 hover:text-white hover:bg-white/5";
        });
        const content = document.getElementById('tab-content'); if(!content) return;
        
        if(tab === 'chapters') {
            const chaps = DB.data.chapters[this.activeSubjectId] || [];
            let html = `
                <div class="flex gap-2 mb-4">
                    <input type="text" id="new-chap-name" class="glass-input flex-1 p-3 rounded-xl" placeholder="Chapter Name...">
                    <button onclick="App.addInlineChapter()" class="bg-indigo-600 px-4 rounded-xl font-bold text-white hover:bg-indigo-500"><i class="fas fa-plus"></i></button>
                </div>
                <div class="space-y-2">
            `;
            if(chaps.length === 0) html += `<p class="text-center text-slate-500 mt-10">No chapters yet.</p>`;
            chaps.forEach(c => {
                const isBad = c.status === 'bad'; const isGood = c.status === 'good'; const isExc = c.status === 'excellent';
                html += `
                    <div class="glass-panel p-4 rounded-xl flex justify-between items-center group cursor-pointer hover:bg-slate-800 transition-colors" onclick="App.openStatusModal('${c.id}', '${c.name.replace(/'/g, "\\'")}')">
                        <span class="font-medium flex-1">${c.name}</span>
                        <div class="flex gap-2 items-center">
                            <div class="w-3 h-3 rounded-full ${isBad?'bg-rose-500':'bg-slate-700'}"></div>
                            <div class="w-3 h-3 rounded-full ${isGood?'bg-amber-500':'bg-slate-700'}"></div>
                            <div class="w-3 h-3 rounded-full ${isExc?'bg-emerald-500':'bg-slate-700'}"></div>
                            <button onclick="event.stopPropagation(); App.deleteChapter('${c.id}')" class="ml-2 text-slate-600 hover:text-red-500 p-2"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
            content.innerHTML = html;
        } else if (tab === 'timer') {
            content.innerHTML = `
                <div class="flex flex-col items-center justify-center h-[350px]">
                    <div class="flex bg-slate-800 p-1 rounded-xl mb-8">
                        <button onclick="App.setTimerMode('stopwatch')" id="mode-stopwatch" class="px-4 py-1 rounded-lg text-sm font-bold ${!this.pomodoroMode ? 'bg-slate-600 text-white' : 'text-slate-400'}">Stopwatch</button>
                        <button onclick="App.setTimerMode('pomodoro')" id="mode-pomodoro" class="px-4 py-1 rounded-lg text-sm font-bold ${this.pomodoroMode ? 'bg-indigo-600 text-white' : 'text-slate-400'}">Pomodoro</button>
                    </div>
                    <div id="main-timer-display" class="text-7xl font-mono font-bold text-white mb-8 drop-shadow-2xl transition-all duration-300">00:00:00</div>
                    <div class="flex gap-4">
                        <button id="btn-play" onclick="App.startTimer()" class="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center text-2xl hover:scale-110 transition-transform shadow-lg"><i class="fas fa-play ml-1"></i></button>
                        <button id="btn-pause" onclick="App.pauseTimer()" class="hidden w-16 h-16 rounded-full bg-amber-500 flex items-center justify-center text-2xl hover:scale-110 transition-transform shadow-lg"><i class="fas fa-pause"></i></button>
                        <button id="btn-stop" onclick="App.stopTimer()" class="group relative w-16 h-16 rounded-full bg-rose-600 flex items-center justify-center text-2xl hover:scale-110 transition-transform shadow-lg"><i class="fas fa-stop"></i></button>
                    </div>
                    <p class="mt-8 text-slate-400 text-sm" id="timer-status-text">Focus Mode Active</p>
                </div>
            `;
            this.updateTimerUI(); this.updateButtons();
        } else if (tab === 'analytics') {
            const daily = DB.getStats('daily', this.activeSubjectId); const weekly = DB.getStats('weekly', this.activeSubjectId); const monthly = DB.getStats('monthly', this.activeSubjectId);
            const history = DB.getHistory(this.activeSubjectId);
            const chaps = DB.data.chapters[this.activeSubjectId] || [];
            const counts = { excellent: 0, good: 0, bad: 0 }; chaps.forEach(c => counts[c.status]++);
            let html = `
                <div class="grid grid-cols-3 gap-3 mb-6">
                    <div class="glass-panel p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-center"><div class="text-emerald-400 text-[10px] font-bold uppercase tracking-wider">Today</div><div class="text-xl font-bold text-white">${this.formatTime(daily)}</div></div>
                    <div class="glass-panel p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-center"><div class="text-amber-400 text-[10px] font-bold uppercase tracking-wider">Week</div><div class="text-xl font-bold text-white">${this.formatTime(weekly)}</div></div>
                    <div class="glass-panel p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 text-center"><div class="text-indigo-400 text-[10px] font-bold uppercase tracking-wider">Month</div><div class="text-xl font-bold text-white">${this.formatTime(monthly)}</div></div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div class="glass-panel p-6 rounded-2xl border border-white/5"><h3 class="text-sm font-bold uppercase text-slate-400 mb-6 flex items-center gap-2"><i class="fas fa-chart-pie"></i> Ratio</h3><div class="h-64 relative"><canvas id="chart-doughnut"></canvas></div></div>
                    <div class="glass-panel p-6 rounded-2xl border border-white/5"><h3 class="text-sm font-bold uppercase text-slate-400 mb-4">History</h3><div class="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
            `;
            if(history.length === 0) html += `<div class="p-4 text-center text-slate-500 text-sm bg-slate-800/50 rounded-xl">No study sessions recorded yet.</div>`;
            else history.forEach(h => { html += `<div class="glass-panel p-3 rounded-xl flex justify-between items-center"><div><div class="text-sm font-bold text-white">${h.fullDate.split(',')[0]}</div><div class="text-xs text-slate-400">${h.fullDate.split(',')[1]}</div></div><div class="text-emerald-400 font-bold bg-emerald-400/10 px-3 py-1 rounded-lg">${this.formatTime(h.duration)}</div></div>`; });
            html += `</div></div></div></div>`; content.innerHTML = html;
            setTimeout(() => {
                const ctx = document.getElementById('chart-doughnut');
                if(ctx && typeof Chart !== 'undefined') new Chart(ctx, { type: 'doughnut', data: { labels: ['Done', 'Learn', 'Todo'], datasets: [{ data: [counts.excellent, counts.good, counts.bad], backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } } } });
            }, 50);
        }
    },

    setTimerMode(mode) {
        if(this.isTimerRunning) { if(!confirm("Timer is running. Stop current session?")) return; this.stopTimer(); }
        this.pomodoroMode = (mode === 'pomodoro'); this.elapsedTime = 0; this.startTime = null; this.switchTab('timer');
    },

    startTimer() {
        if(this.isTimerRunning) return;
        this.isTimerRunning = true; this.startTime = Date.now(); this.vibrate(50);
        if(this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            this.updateTimerUI();
            if(this.pomodoroMode) {
                const current = Math.floor((Date.now() - this.startTime) / 1000) + this.elapsedTime;
                const remaining = this.pomodoroTime - current;
                if(remaining <= 0) { this.vibrate([200, 100, 200]); this.stopTimer(); this.showToast("Pomodoro Complete!", "success"); this.triggerConfetti(); }
            }
        }, 1000);
        this.updateButtons(); this.checkMiniPlayer();
    },
    
    pauseTimer() { if(!this.isTimerRunning) return; this.isTimerRunning = false; this.elapsedTime += Math.floor((Date.now() - this.startTime) / 1000); clearInterval(this.timerInterval); this.updateButtons(); this.checkMiniPlayer(); },
    
    stopTimer() {
        this.isTimerRunning = false; clearInterval(this.timerInterval);
        let total = this.elapsedTime;
        if(this.startTime && document.getElementById('btn-pause') && !document.getElementById('btn-pause').classList.contains('hidden')) total += Math.floor((Date.now() - this.startTime) / 1000);
        if(total > 5) { DB.logSession(this.activeSubjectId, total); this.showToast(`Session Saved: ${this.formatTime(total)}`, "success"); this.elapsedTime = 0; this.startTime = null; if(this.currentTab === 'timer') document.getElementById('main-timer-display').innerText="00:00:00"; document.getElementById('mini-timer-display').innerText = "00:00:00"; if(this.currentTab === 'analytics') this.switchTab('analytics'); }
        else { this.elapsedTime = 0; this.startTime = null; if(this.currentTab === 'timer') this.updateTimerUI(); }
        this.updateButtons(); this.checkMiniPlayer();
    },
    
    updateTimerUI() {
        let current = 0; if(this.isTimerRunning) current = Math.floor((Date.now() - this.startTime) / 1000);
        const total = this.elapsedTime + current; let displayTime = total;
        if(this.pomodoroMode) { displayTime = this.pomodoroTime - total; if(displayTime < 0) displayTime = 0; }
        const h = String(Math.floor(displayTime / 3600)).padStart(2, '0'); const m = String(Math.floor((displayTime % 3600) / 60)).padStart(2, '0'); const s = String(Math.floor(displayTime % 60)).padStart(2, '0');
        const str = this.pomodoroMode && h==='00' ? `${m}:${s}` : `${h}:${m}:${s}`;
        const md = document.getElementById('main-timer-display'); if(md) md.innerText = str;
        const mmd = document.getElementById('mini-timer-display'); if(mmd) mmd.innerText = str;
        const ml = document.getElementById('mini-timer-label'); if(ml) ml.innerText = this.pomodoroMode ? 'Pomodoro' : 'Focus Mode';
    },
    
    updateButtons() {
        const play = document.getElementById('btn-play'), pause = document.getElementById('btn-pause'), mPlay = document.getElementById('mini-btn-play'), mPause = document.getElementById('mini-btn-pause');
        if(this.isTimerRunning) { if(play) { play.classList.add('hidden'); pause.classList.remove('hidden'); } if(mPlay) { mPlay.classList.add('hidden'); mPause.classList.remove('hidden'); } }
        else { if(play) { play.classList.remove('hidden'); pause.classList.add('hidden'); } if(mPlay) { mPlay.classList.remove('hidden'); mPause.classList.add('hidden'); } }
    },
    
    checkMiniPlayer() { const mini = document.getElementById('mini-timer'); if(!mini) return; const active = this.elapsedTime > 0 || this.isTimerRunning; if(active && this.currentTab !== 'timer') mini.classList.remove('hidden'); else mini.classList.add('hidden'); },
    addInlineChapter() { const n = document.getElementById('new-chap-name').value; if(n && n.trim() !== "") { DB.addChapter(this.activeSubjectId, n); this.switchTab('chapters'); } },
    addManualChapter() { const n = document.getElementById('inp-chapter-name').value; if(n) { this.pendingChapters.push(n); this.renderPendingChapters(); document.getElementById('inp-chapter-name').value=''; } },
    renderPendingChapters() { const list = document.getElementById('chapter-edit-list'); if(!list) return; list.innerHTML = this.pendingChapters.map((n, i) => `<div class="flex items-center gap-3 bg-slate-800 p-3 rounded-lg mt-2"><i class="fas fa-circle text-[6px] text-indigo-500"></i><span class="flex-1 text-sm">${n}</span><button onclick="App.pendingChapters.splice(${i},1); App.renderPendingChapters()" class="text-red-400"><i class="fas fa-times"></i></button></div>`).join(''); },
    saveChaptersBatch() { this.pendingChapters.forEach(n => { if(n.trim()) DB.addChapter(this.activeSubjectId, n); }); this.pendingChapters=[]; this.closeModal('chapter-modal'); this.switchTab('chapters'); },
    async processOCR(input) { const f = input.files[0]; if(!f) return; const loading = document.getElementById('ocr-loading'); if(loading) loading.classList.remove('hidden'); try { if(typeof Tesseract === 'undefined') throw new Error("Tesseract not loaded"); const { data: { text } } = await Tesseract.recognize(f, 'eng'); const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3); this.pendingChapters = [...this.pendingChapters, ...lines]; this.renderPendingChapters(); } catch(e) { this.showToast('OCR Error', 'error'); } finally { if(loading) loading.classList.add('hidden'); input.value=''; } },
    deleteChapter(id) { if(confirm("Delete chapter?")) { DB.deleteChapter(this.activeSubjectId, id); this.switchTab('chapters'); } },
    openStatusModal(id, name) { this.activeChapterId = id; document.getElementById('status-modal-title').innerHTML = `Update: <span class="text-indigo-400">${name}</span>`; this.openModal('status-modal'); },
    updateChapterStatus(s) { DB.updateChapter(this.activeSubjectId, this.activeChapterId, s); this.closeModal('status-modal'); this.switchTab('chapters'); },
    createSubject() { const n = document.getElementById('inp-subject-name').value; if(n) { DB.addSubject(n); this.closeModal('add-subject-modal'); this.renderHome(); } },
    deleteSubject(id) { if(confirm("Delete subject and history?")) { DB.deleteSubject(id); this.renderHome(); } },
    openModal(id) { if(id==='add-subject-modal') document.getElementById('inp-subject-name').value = ''; if(id==='chapter-modal') { document.getElementById('inp-chapter-name').value = ''; this.pendingChapters = []; this.renderPendingChapters(); } document.getElementById(id).classList.remove('hidden'); },
    closeModal(id) { document.getElementById(id).classList.add('hidden'); },
    initThreeJS() {
        const c = document.getElementById('bg-canvas'); if(!c || typeof THREE === 'undefined') return;
        const s = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
        const r = new THREE.WebGLRenderer({canvas:c, alpha:true}); r.setSize(window.innerWidth, window.innerHeight);
        const g = new THREE.IcosahedronGeometry(1,0); const m = new THREE.MeshBasicMaterial({color:0x6366f1, wireframe:true, opacity:0.05, transparent:true});
        const shapes=[]; for(let i=0;i<8;i++) { const mesh=new THREE.Mesh(g,m); mesh.position.set((Math.random()-0.5)*15,(Math.random()-0.5)*15,(Math.random()-0.5)*10); s.add(mesh); shapes.push({m:mesh,s:Math.random()*0.002}); }
        cam.position.z=8; function anim(){ requestAnimationFrame(anim); shapes.forEach(i=>{i.m.rotation.x+=i.s;i.m.rotation.y+=i.s}); r.render(s,cam); } anim();
        window.addEventListener('resize', () => { cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix(); r.setSize(window.innerWidth, window.innerHeight); });
    }
};

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.init()); else App.init();
