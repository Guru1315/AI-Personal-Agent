/* ═══════════════════════════════════════════════════════════════
   PlanAI – AI Personal Planner  |  app.js
   Features: Onboarding, AI Plan Generation (Gemini + local),
             Calendar view, Auto-reschedule, Streak tracker
═══════════════════════════════════════════════════════════════ */

'use strict';

// ── SVG gradient definition (injected once) ────────────────────
(function injectSVGDefs() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML = `<defs>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>`;
    document.body.prepend(svg);
})();

// ── Constants ─────────────────────────────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLAN_COLORS = [
    { bg: 'rgba(124,58,237,0.2)', border: '#7c3aed', text: '#a855f7' },
    { bg: 'rgba(6,182,212,0.2)', border: '#06b6d4', text: '#22d3ee' },
    { bg: 'rgba(236,72,153,0.2)', border: '#ec4899', text: '#f472b6' },
    { bg: 'rgba(16,185,129,0.2)', border: '#10b981', text: '#34d399' },
    { bg: 'rgba(245,158,11,0.2)', border: '#f59e0b', text: '#fbbf24' },
];
const GEMINI_MODEL_DEFAULT = 'gemini-3.6-flash';

// ── State ─────────────────────────────────────────────────────
let state = {
    user: { name: '', apiKey: '', sessionMins: 25, geminiModel: 'gemini-3.6-flash' },
    weekHours: { Sun: 2, Mon: 3, Tue: 3, Wed: 3, Thu: 3, Fri: 2, Sat: 4 },
    commitments: [],
    plans: [],
    streak: 0,
    lastCheckedDate: null,
    onboardStep: 1,
    currentPlanId: null,
    selectedCalDay: null,
    pendingPlanData: null,
    pendingReschedule: null,
    reschedulePlanId: null,
};

// ── Persistence ────────────────────────────────────────────────
function saveState() {
    localStorage.setItem('planai_state', JSON.stringify(state));
}
function loadState() {
    try {
        const s = localStorage.getItem('planai_state');
        if (s) state = { ...state, ...JSON.parse(s) };
    } catch (e) { /* ignore */ }
}

// ── Utility ────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function today() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, n) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}
function diffDays(a, b) {
    return Math.round((new Date(a) - new Date(b)) / 86400000);
}
function fmtDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
function toast(msg, type = 'info', icon = '') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icon || icons[type]}</span><span>${msg}</span>`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
}
function greetingByHour() {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
}

// ── Onboarding ─────────────────────────────────────────────────
function renderHoursGrid(containerId, isSmall = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    DAYS.forEach(day => {
        const wrap = document.createElement('div');
        wrap.className = 'day-hour-block';
        wrap.innerHTML = `
      <div class="day-label">${day}</div>
      <input class="hour-input" type="number" min="0" max="12" step="0.5"
        id="hour-${containerId}-${day}" value="${state.weekHours[day] ?? 2}" />
    `;
        container.appendChild(wrap);
        wrap.querySelector('input').addEventListener('input', e => {
            state.weekHours[day] = parseFloat(e.target.value) || 0;
        });
    });
}

function initOnboarding() {
    renderHoursGrid('hours-grid');

    // Session opts
    document.querySelectorAll('#step-2 .session-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#step-2 .session-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.user.sessionMins = parseInt(btn.dataset.mins);
        });
    });

    // Quick-add commitments
    document.querySelectorAll('.quick-chip').forEach(btn => {
        btn.addEventListener('click', () => addCommitment(btn.dataset.task));
    });
    document.getElementById('add-task-btn').addEventListener('click', () => {
        const inp = document.getElementById('task-name-input');
        if (inp.value.trim()) { addCommitment(inp.value.trim()); inp.value = ''; }
    });
    document.getElementById('task-name-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('add-task-btn').click();
    });

    // Steps nav
    document.getElementById('step1-next').addEventListener('click', () => {
        const name = document.getElementById('user-name').value.trim();
        if (!name) { toast('Please enter your name', 'error'); return; }
        state.user.name = name;
        state.user.apiKey = document.getElementById('gemini-key').value.trim();
        goToStep(2);
    });
    document.getElementById('step2-next').addEventListener('click', () => goToStep(3));
    document.getElementById('step2-back').addEventListener('click', () => goToStep(1));
    document.getElementById('step3-next') && document.getElementById('step3-next').addEventListener('click', () => { });
    document.getElementById('step3-back').addEventListener('click', () => goToStep(2));
    document.getElementById('step3-finish').addEventListener('click', finishOnboarding);
}

function addCommitment(task) {
    if (state.commitments.includes(task)) return;
    state.commitments.push(task);
    renderCommitmentChips();
}
function removeCommitment(task) {
    state.commitments = state.commitments.filter(t => t !== task);
    renderCommitmentChips();
}
function renderCommitmentChips() {
    const container = document.getElementById('task-chips');
    container.innerHTML = '';
    state.commitments.forEach(task => {
        const chip = document.createElement('div');
        chip.className = 'task-chip';
        chip.innerHTML = `<span>${task}</span><button class="remove-chip" title="Remove">✕</button>`;
        chip.querySelector('.remove-chip').addEventListener('click', () => removeCommitment(task));
        container.appendChild(chip);
    });
}

function goToStep(n) {
    [1, 2, 3].forEach(i => {
        document.getElementById(`step-${i}`)?.classList.toggle('hidden', i !== n);
        document.querySelector(`.step[data-step="${i}"]`)?.classList.toggle('active', i <= n);
    });
    state.onboardStep = n;
}

function finishOnboarding() {
    saveState();
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    initApp();
}

// ── App initialization ─────────────────────────────────────────
function initApp() {
    updateStreakIfNeeded();
    renderSidebar();
    renderDashboard();
    initNav();
    initChat();
    initModals();
    initSettings();
    document.getElementById('reset-btn').addEventListener('click', resetPlanner);
    document.getElementById('go-to-chat-btn')?.addEventListener('click', () => switchView('chat'));
    document.getElementById('new-plan-btn')?.addEventListener('click', () => switchView('chat'));
    document.getElementById('back-to-plans')?.addEventListener('click', () => switchView('plans'));
    document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('today-date').textContent = fmtDate(today());
    document.getElementById('greeting-time').textContent = greetingByHour();
    document.getElementById('greeting-name').textContent = state.user.name || 'there';
    checkMissedAlert();
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('open');
    sb.classList.toggle('collapsed');
}

// ── Streak logic ───────────────────────────────────────────────
function updateStreakIfNeeded() {
    const t = today();
    if (state.lastCheckedDate === t) return;
    if (state.lastCheckedDate && diffDays(t, state.lastCheckedDate) === 1) {
        const yest = addDays(t, -1);
        if (hadCompletedTaskOn(yest)) {
            state.streak = (state.streak || 0) + 1;
        } else {
            state.streak = 0;
        }
    } else if (!state.lastCheckedDate) {
        state.streak = 0;
    } else if (diffDays(t, state.lastCheckedDate) > 1) {
        state.streak = 0;
    }
    state.lastCheckedDate = t;
    saveState();
}
function hadCompletedTaskOn(dateStr) {
    return state.plans.some(p =>
        p.schedule.some(day => day.date === dateStr && day.sessions.some(s => s.done))
    );
}
function recordTodayStreak() {
    if (hadCompletedTaskOn(today())) {
        state.streak = Math.max(state.streak, 1);
        saveState();
        renderSidebar();
    }
}

function renderSidebar() {
    document.getElementById('sidebar-name').textContent = state.user.name || 'You';
    document.getElementById('sidebar-avatar').textContent = (state.user.name || 'Y')[0].toUpperCase();
    document.getElementById('streak-count').textContent = state.streak;
}

// ── Navigation ─────────────────────────────────────────────────
function initNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
}

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

    const viewEl = document.getElementById(`view-${viewId}`);
    if (viewEl) {
        viewEl.classList.remove('hidden');
        // Special flex handling for chat
        if (viewId === 'chat') {
            viewEl.style.display = 'flex';
        } else {
            viewEl.style.display = '';
        }
    }
    const navBtn = document.getElementById(`nav-${viewId}`) || document.querySelector(`[data-view="${viewId}"]`);
    if (navBtn) navBtn.classList.add('active');

    const titles = { dashboard: 'Dashboard', plans: 'My Plans', chat: 'AI Chat', settings: 'Settings', 'plan-detail': 'Plan Detail' };
    document.getElementById('topbar-title').textContent = titles[viewId] || 'PlanAI';

    if (viewId === 'plans') renderPlans();
    if (viewId === 'dashboard') renderDashboard();
    if (viewId === 'settings') renderSettings();
}

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard() {
    const t = today();
    let todayTasks = [];
    let totalDone = 0, totalAll = 0;

    state.plans.forEach((plan, pi) => {
        const color = PLAN_COLORS[pi % PLAN_COLORS.length];
        plan.schedule.forEach(day => {
            if (day.date === t) {
                day.sessions.forEach(s => {
                    todayTasks.push({ ...s, planName: plan.name, planId: plan.id, dayDate: day.date, color });
                });
            }
            day.sessions.forEach(s => {
                totalAll++;
                if (s.done) totalDone++;
            });
        });
    });

    const activePlans = state.plans.filter(p => !isPlanComplete(p)).length;
    const doneTodayCount = todayTasks.filter(s => s.done).length;
    const pendingTodayCount = todayTasks.filter(s => !s.done).length;
    const overallPct = totalAll ? Math.round(totalDone / totalAll * 100) : 0;

    document.getElementById('stat-plans').textContent = activePlans;
    document.getElementById('stat-done').textContent = doneTodayCount;
    document.getElementById('stat-pending').textContent = pendingTodayCount;
    document.getElementById('stat-progress').textContent = overallPct + '%';
    document.getElementById('ring-percent').textContent = overallPct + '%';
    document.getElementById('today-count').textContent = `${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''}`;

    // Progress ring
    const circumference = 314;
    const offset = circumference - (overallPct / 100) * circumference;
    document.getElementById('ring-fill').style.strokeDashoffset = offset;

    // Today's tasks list
    const list = document.getElementById('today-tasks-list');
    if (todayTasks.length === 0) {
        list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✨</div>
      <p>No tasks scheduled for today. Use AI Chat to create a plan!</p>
      <button class="btn-primary small" id="go-to-chat-btn2">Start Planning →</button>
    </div>`;
        document.getElementById('go-to-chat-btn2')?.addEventListener('click', () => switchView('chat'));
    } else {
        list.innerHTML = '';
        todayTasks.forEach(task => {
            const item = document.createElement('div');
            item.className = `task-item${task.done ? ' done' : ''}`;
            item.innerHTML = `
        <button class="task-check${task.done ? ' checked' : ''}" data-id="${task.id}" data-plan="${task.planId}" data-date="${task.dayDate}"></button>
        <div class="task-title">${task.title}</div>
        <div class="task-meta">${task.duration} min</div>
        <span class="task-plan-tag" style="background:${task.color.bg};color:${task.color.text};border:1px solid ${task.color.border}">${task.planName}</span>
      `;
            item.querySelector('.task-check').addEventListener('click', () => toggleTaskDone(task.planId, task.dayDate, task.id));
            list.appendChild(item);
        });
    }

    // Breakdown
    const breakdown = document.getElementById('plan-breakdown');
    breakdown.innerHTML = '';
    state.plans.forEach((plan, pi) => {
        const color = PLAN_COLORS[pi % PLAN_COLORS.length];
        const all = plan.schedule.flatMap(d => d.sessions).length;
        const done = plan.schedule.flatMap(d => d.sessions).filter(s => s.done).length;
        const pct = all ? Math.round(done / all * 100) : 0;
        const row = document.createElement('div');
        row.className = 'breakdown-row';
        row.innerHTML = `
      <span class="breakdown-label" title="${plan.name}">${plan.name}</span>
      <div class="breakdown-bar-wrap">
        <div class="breakdown-bar" style="width:${pct}%;background:${color.text}"></div>
      </div>
      <span class="breakdown-pct">${pct}%</span>
    `;
        breakdown.appendChild(row);
    });
}

function toggleTaskDone(planId, dateStr, sessionId) {
    const plan = state.plans.find(p => p.id === planId);
    if (!plan) return;
    const day = plan.schedule.find(d => d.date === dateStr);
    if (!day) return;
    const session = day.sessions.find(s => s.id === sessionId);
    if (!session) return;
    session.done = !session.done;
    saveState();
    recordTodayStreak();
    renderDashboard();
    if (state.currentPlanId === planId) renderPlanDetail(planId);
}

function isPlanComplete(plan) {
    const all = plan.schedule.flatMap(d => d.sessions);
    return all.length > 0 && all.every(s => s.done);
}

// ── Missed alert ───────────────────────────────────────────────
function checkMissedAlert() {
    const yest = addDays(today(), -1);
    const hasMissed = state.plans.some(p =>
        p.schedule.some(d => d.date === yest && d.sessions.some(s => !s.done))
    );
    document.getElementById('missed-alert').classList.toggle('hidden', !hasMissed);
    document.getElementById('reschedule-btn')?.addEventListener('click', () => showGlobalReschedule());
    document.getElementById('dismiss-alert')?.addEventListener('click', () => {
        document.getElementById('missed-alert').classList.add('hidden');
    });
}

function showGlobalReschedule() {
    // Reschedule all plans with missed tasks
    state.plans.forEach(p => {
        if (hasMissedTasks(p)) performReschedule(p.id);
    });
    document.getElementById('missed-alert').classList.add('hidden');
    toast('Plans rescheduled successfully!', 'success');
    renderDashboard();
    renderPlans();
}

// ── Plans list ─────────────────────────────────────────────────
function renderPlans() {
    const container = document.getElementById('plans-list');
    if (state.plans.length === 0) {
        container.innerHTML = `<div class="empty-state large">
      <div class="empty-icon">📭</div>
      <p>No plans yet. Chat with AI to create your first goal!</p>
      <button class="btn-primary small" id="plans-go-chat">Start with AI Chat →</button>
    </div>`;
        document.getElementById('plans-go-chat')?.addEventListener('click', () => switchView('chat'));
        return;
    }
    container.innerHTML = '';
    state.plans.forEach((plan, idx) => {
        const color = PLAN_COLORS[idx % PLAN_COLORS.length];
        const allSessions = plan.schedule.flatMap(d => d.sessions);
        const doneSessions = allSessions.filter(s => s.done);
        const pct = allSessions.length ? Math.round(doneSessions.length / allSessions.length * 100) : 0;
        const missed = hasMissedTasks(plan);
        const complete = isPlanComplete(plan);

        const statusBadge = complete ? 'badge-complete' : (missed ? 'badge-missed' : 'badge-active');
        const statusText = complete ? '✓ Complete' : (missed ? '⚠ Missed' : '● Active');

        const card = document.createElement('div');
        card.className = 'plan-card';
        card.style.setProperty('--plan-color', color.text);
        card.innerHTML = `
      <div class="plan-card-header">
        <div class="plan-card-title">${plan.name}</div>
        <span class="plan-card-badge ${statusBadge}">${statusText}</span>
      </div>
      <div class="plan-card-meta">
        📅 ${fmtDate(plan.startDate)} → ${fmtDate(plan.endDate)}
        &nbsp;·&nbsp; ${plan.schedule.length} days &nbsp;·&nbsp; ${allSessions.length} sessions
      </div>
      <div class="plan-card-progress">
        <div class="plan-progress-bar">
          <div class="plan-progress-fill" style="width:${pct}%;background:${color.text}"></div>
        </div>
        <div class="plan-progress-label">${doneSessions.length} / ${allSessions.length} sessions done (${pct}%)</div>
      </div>
      <div class="plan-card-actions">
        <button class="plan-action-btn" data-view="${plan.id}">View Plan</button>
        ${missed && !complete ? `<button class="plan-action-btn reschedule-plan-btn" data-id="${plan.id}">🔄 Reschedule</button>` : ''}
        <button class="plan-action-btn danger delete-plan-btn" data-id="${plan.id}">🗑 Delete</button>
      </div>
    `;
        card.querySelector('[data-view]').addEventListener('click', () => openPlanDetail(plan.id));
        card.querySelector('.delete-plan-btn')?.addEventListener('click', e => { e.stopPropagation(); deletePlan(plan.id); });
        card.querySelector('.reschedule-plan-btn')?.addEventListener('click', e => { e.stopPropagation(); showRescheduleModal(plan.id); });
        container.appendChild(card);
    });
}

function deletePlan(planId) {
    if (!confirm('Delete this plan? This cannot be undone.')) return;
    state.plans = state.plans.filter(p => p.id !== planId);
    saveState();
    renderPlans();
    renderDashboard();
    toast('Plan deleted', 'info');
}

// ── Plan Detail ────────────────────────────────────────────────
function openPlanDetail(planId) {
    state.currentPlanId = planId;
    state.selectedCalDay = null;
    switchView('plan-detail');
    renderPlanDetail(planId);
}

function renderPlanDetail(planId) {
    const plan = state.plans.find(p => p.id === planId);
    if (!plan) return;

    document.getElementById('detail-plan-name').textContent = plan.name;

    const missed = hasMissedTasks(plan);
    document.getElementById('plan-reschedule-bar').classList.toggle('hidden', !missed);
    document.getElementById('plan-reschedule-btn').onclick = () => showRescheduleModal(planId);

    renderCalendar(plan);

    if (state.selectedCalDay) {
        renderDayTasks(plan, state.selectedCalDay);
    } else {
        renderDayTasks(plan, today());
        state.selectedCalDay = today();
    }
}

function renderCalendar(plan) {
    const grid = document.getElementById('detail-calendar');
    grid.innerHTML = '';

    // Day-of-week headers
    DAYS.forEach(d => {
        const h = document.createElement('div');
        h.style.cssText = 'font-size:0.65rem;color:var(--text3);text-align:center;padding:0.2rem;font-weight:600;';
        h.textContent = d;
        grid.appendChild(h);
    });

    // Find first day offset
    const firstDate = new Date(plan.startDate + 'T12:00:00');
    const startDow = firstDate.getDay(); // 0=Sun

    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
        grid.appendChild(Object.assign(document.createElement('div'), { style: '' }));
    }

    const t = today();
    const dayMap = {};
    plan.schedule.forEach(d => dayMap[d.date] = d);

    const endDate = plan.endDate;
    let cur = plan.startDate;
    while (cur <= endDate) {
        const dayData = dayMap[cur];
        const cell = document.createElement('div');
        cell.className = 'cal-day';

        const isToday = cur === t;
        const isPast = cur < t;
        const isFuture = cur > t;
        const hasSessions = dayData && dayData.sessions.length > 0;
        const allDone = hasSessions && dayData.sessions.every(s => s.done);
        const someDone = hasSessions && dayData.sessions.some(s => s.done);
        const isMissed = isPast && hasSessions && !allDone;

        if (!hasSessions) cell.classList.add('no-session');
        if (isToday) cell.classList.add('today');
        if (allDone) cell.classList.add('done');
        if (isMissed) cell.classList.add('missed');
        if (cur === state.selectedCalDay) cell.classList.add('selected');

        const dayNum = new Date(cur + 'T12:00:00').getDate();
        const sessCount = hasSessions ? dayData.sessions.length : 0;
        cell.innerHTML = `
      <div class="cal-day-num">${dayNum}</div>
      ${hasSessions ? `<div class="cal-day-tasks">${sessCount}s</div>` : ''}
    `;

        if (hasSessions) {
            const dot = document.createElement('div');
            dot.className = 'cal-day-dot';
            dot.style.background = allDone ? 'var(--green)' : (isMissed ? 'var(--amber)' : (isToday ? 'var(--cyan)' : 'var(--purple-l)'));
            dot.style.left = '50%'; dot.style.transform = 'translateX(-50%)';
            cell.appendChild(dot);

            cell.addEventListener('click', () => {
                document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
                cell.classList.add('selected');
                state.selectedCalDay = cur;
                renderDayTasks(state.plans.find(p => p.id === state.currentPlanId), cur);
            });
        }

        grid.appendChild(cell);
        cur = addDays(cur, 1);
    }
}

function renderDayTasks(plan, dateStr) {
    const dateEl = document.getElementById('day-tasks-date');
    const listEl = document.getElementById('day-tasks-list');
    dateEl.textContent = fmtDate(dateStr);

    const dayData = plan.schedule.find(d => d.date === dateStr);
    if (!dayData || dayData.sessions.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><p>Rest day — no sessions scheduled.</p></div>';
        return;
    }

    listEl.innerHTML = '';
    dayData.sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = `task-item${session.done ? ' done' : ''}`;
        item.innerHTML = `
      <button class="task-check${session.done ? ' checked' : ''}"></button>
      <div class="task-title">${session.title}</div>
      <div class="task-meta">${session.duration} min</div>
    `;
        item.querySelector('.task-check').addEventListener('click', () => {
            toggleTaskDone(plan.id, dateStr, session.id);
        });
        listEl.appendChild(item);
    });
}

// ── Reschedule logic ───────────────────────────────────────────
function hasMissedTasks(plan) {
    const t = today();
    return plan.schedule.some(d => d.date < t && d.sessions.some(s => !s.done));
}

function showRescheduleModal(planId) {
    const plan = state.plans.find(p => p.id === planId);
    if (!plan) return;

    const missed = [];
    const t = today();
    plan.schedule.forEach(d => {
        if (d.date < t) {
            d.sessions.forEach(s => { if (!s.done) missed.push({ ...s, originalDate: d.date }); });
        }
    });

    if (missed.length === 0) { toast('No missed tasks found!', 'info'); return; }

    // Preview where they'll go
    const rescheduled = computeReschedule(plan, missed);

    state.pendingReschedule = rescheduled;
    state.reschedulePlanId = planId;

    const body = document.getElementById('reschedule-modal-body');
    body.innerHTML = `
    <p style="color:var(--text2);margin-bottom:1rem;font-size:0.88rem;">
      Found <strong style="color:var(--amber)">${missed.length} missed session${missed.length !== 1 ? 's' : ''}</strong>.
      They'll be redistributed into your upcoming free days:
    </p>
    <div class="plan-preview" style="max-height:300px;overflow-y:auto">
      ${rescheduled.map(r => `
        <div class="preview-day">
          <div class="preview-day-header">
            <div class="preview-day-label">${fmtDate(r.date)}</div>
            <div class="preview-day-hours">+${r.added.length} added</div>
          </div>
          <div class="preview-sessions">
            ${r.added.map(s => `
              <span class="preview-session" style="background:rgba(124,58,237,0.15);color:#a855f7;border-color:#7c3aed">
                ${s.title} (${s.duration}min)
              </span>`).join('')}
          </div>
        </div>`).join('')}
    </div>
  `;

    document.getElementById('reschedule-modal').classList.remove('hidden');
}

function computeReschedule(plan, missed) {
    const t = today();
    // Find upcoming days with capacity
    const upcomingDays = plan.schedule.filter(d => d.date >= t);
    const result = [];
    let missedQueue = [...missed];

    for (const day of upcomingDays) {
        if (missedQueue.length === 0) break;
        const dayOfWeek = DAYS[new Date(day.date + 'T12:00:00').getDay()];
        const available = (state.weekHours[dayOfWeek] || 0) * 60;
        const used = day.sessions.reduce((a, s) => a + s.duration, 0);
        let remaining = available - used;
        const added = [];

        while (missedQueue.length > 0 && remaining >= missedQueue[0].duration) {
            const s = missedQueue.shift();
            added.push({ ...s, id: uid() });
            remaining -= s.duration;
        }

        if (added.length) result.push({ date: day.date, added });
    }

    // If still tasks remain, append to last day
    if (missedQueue.length && result.length) {
        result[result.length - 1].added.push(...missedQueue.map(s => ({ ...s, id: uid() })));
    }

    return result;
}

function performReschedule(planId) {
    const plan = state.plans.find(p => p.id === planId);
    if (!plan) return;
    const t = today();
    const missed = [];
    plan.schedule.forEach(d => {
        if (d.date < t) {
            d.sessions.forEach(s => { if (!s.done) missed.push({ ...s, originalDate: d.date }); });
        }
    });
    if (!missed.length) return;

    // Mark original sessions as skipped
    plan.schedule.forEach(d => {
        if (d.date < t) d.sessions = d.sessions.filter(s => s.done);
    });

    const rescheduled = computeReschedule(plan, missed);
    rescheduled.forEach(({ date, added }) => {
        const day = plan.schedule.find(d => d.date === date);
        if (day) day.sessions.push(...added);
    });

    saveState();
}

// ── AI Chat ────────────────────────────────────────────────────
function initChat() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = clamp(input.scrollHeight, 44, 120) + 'px';
    });

    document.querySelectorAll('.example-prompt').forEach(btn => {
        btn.addEventListener('click', () => {
            input.value = btn.dataset.prompt;
            input.dispatchEvent(new Event('input'));
            sendMessage();
        });
    });
}

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    // Hide welcome
    const welcome = document.querySelector('.chat-welcome');
    if (welcome) welcome.style.display = 'none';

    appendBubble('user', msg);
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('send-btn').disabled = true;

    const typingId = showTyping();

    try {
        let planData;
        if (state.user.apiKey) {
            planData = await generatePlanWithGemini(msg);
        } else {
            planData = generatePlanLocally(msg);
            await new Promise(r => setTimeout(r, 1200)); // simulate thinking
        }

        removeTyping(typingId);
        state.pendingPlanData = planData;

        appendBubble('ai', `
      <strong>Great! Here's your personalized plan:</strong><br/><br/>
      📋 <strong>${planData.name}</strong><br/>
      📅 ${planData.totalDays} days &nbsp;·&nbsp; ${planData.totalSessions} sessions &nbsp;·&nbsp; ~${planData.dailyMins} min/day<br/><br/>
      ${planData.summary}<br/><br/>
      I've taken into account your available hours and commitments. Want me to save this plan?
    `);

        // Show confirm buttons
        appendConfirmRow();

    } catch (err) {
        removeTyping(typingId);
        appendBubble('ai', `Sorry, I ran into an issue: ${err.message}. Falling back to smart local planning...`);
        state.pendingPlanData = generatePlanLocally(msg);
        appendConfirmRow();
    }

    document.getElementById('send-btn').disabled = false;
    scrollChatToBottom();
}

function appendBubble(role, html) {
    const msgs = document.getElementById('chat-messages');
    const wrap = document.createElement('div');
    wrap.className = `chat-bubble ${role}`;
    wrap.innerHTML = `
    <div class="bubble-label">${role === 'user' ? 'You' : '✦ PlanAI'}</div>
    <div class="bubble-inner">${html}</div>
  `;
    msgs.appendChild(wrap);
    scrollChatToBottom();
}

function showTyping() {
    const id = uid();
    const msgs = document.getElementById('chat-messages');
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble ai';
    wrap.id = `typing-${id}`;
    wrap.innerHTML = `
    <div class="bubble-label">✦ PlanAI</div>
    <div class="typing-indicator">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>`;
    msgs.appendChild(wrap);
    scrollChatToBottom();
    return id;
}
function removeTyping(id) {
    document.getElementById(`typing-${id}`)?.remove();
}
function scrollChatToBottom() {
    const msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
}

function appendConfirmRow() {
    const msgs = document.getElementById('chat-messages');
    const row = document.createElement('div');
    row.className = 'chat-bubble ai';
    row.innerHTML = `
    <div class="bubble-inner" style="display:flex;gap:0.6rem;flex-wrap:wrap">
      <button class="btn-primary small" id="chat-save-plan">Save This Plan ✓</button>
      <button class="btn-ghost small" id="chat-preview-plan">Preview Details</button>
      <button class="btn-ghost small" id="chat-regenerate">Regenerate</button>
    </div>
  `;
    msgs.appendChild(row);
    document.getElementById('chat-save-plan').addEventListener('click', () => {
        if (state.pendingPlanData) { savePlan(state.pendingPlanData); row.remove(); }
    });
    document.getElementById('chat-preview-plan').addEventListener('click', () => {
        if (state.pendingPlanData) showPlanModal(state.pendingPlanData);
    });
    document.getElementById('chat-regenerate').addEventListener('click', () => {
        row.remove();
        appendBubble('ai', 'Sure! Tell me more details or just re-send your goal and I\'ll generate a different plan.');
    });
    scrollChatToBottom();
}

// ── Gemini API ─────────────────────────────────────────────────
async function generatePlanWithGemini(userMessage) {
    const systemPrompt = buildSystemPrompt();
    const prompt = `${systemPrompt}

User request: "${userMessage}"

Respond ONLY with valid JSON in this exact structure (no markdown, no extra text):
{
  "name": "Short plan name",
  "goal": "One sentence description of the goal",
  "summary": "2-3 sentences summarizing the approach",
  "totalDays": <number>,
  "dailyMins": <number>,
  "schedule": [
    {
      "dayOffset": <0-based day number>,
      "focus": "What this day focuses on",
      "sessions": [
        { "title": "Session title", "duration": <minutes>, "type": "study|practice|review|rest" }
      ]
    }
  ]
}`;

    const model = state.user.geminiModel || GEMINI_MODEL_DEFAULT;
    const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.user.apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
            })
        }
    );

    if (!resp.ok) throw new Error(`Gemini API error: ${resp.status}`);
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return buildPlanFromGeminiResponse(parsed);
}

function buildSystemPrompt() {
    const hoursStr = DAYS.map(d => `${d}: ${state.weekHours[d]}h`).join(', ');
    const commitStr = state.commitments.length
        ? state.commitments.join('; ')
        : 'None specified';
    return `You are an expert AI study planner. Create a realistic, detailed study plan.
User profile:
- Name: ${state.user.name}
- Available hours per day of week: ${hoursStr}
- Preferred session length: ${state.user.sessionMins} minutes
- Existing commitments: ${commitStr}
- Today's date: ${today()}

RULES:
- Never schedule more than the user's available hours for that day of week
- Respect session length preference
- Include rest days as needed
- Start with lighter sessions, ramp up intensity, end with review
- Be specific and actionable with session titles
- Total days must match the deadline mentioned`;
}

function buildPlanFromGeminiResponse(parsed) {
    const startDate = today();
    const schedule = [];

    parsed.schedule.forEach(dayPlan => {
        const dateStr = addDays(startDate, dayPlan.dayOffset);
        const dow = DAYS[new Date(dateStr + 'T12:00:00').getDay()];
        const availMins = (state.weekHours[dow] || 0) * 60;
        const totalReq = dayPlan.sessions.reduce((a, s) => a + s.duration, 0);

        // Scale sessions if over capacity
        const scale = totalReq > availMins && availMins > 0 ? availMins / totalReq : 1;
        const sessions = dayPlan.sessions.map(s => ({
            id: uid(),
            title: s.title,
            duration: Math.round(s.duration * scale),
            type: s.type || 'study',
            done: false
        }));

        schedule.push({ date: dateStr, focus: dayPlan.focus, sessions });
    });

    const allSessions = schedule.flatMap(d => d.sessions);
    return {
        name: parsed.name,
        goal: parsed.goal,
        summary: parsed.summary,
        startDate,
        endDate: schedule.length ? schedule[schedule.length - 1].date : startDate,
        totalDays: schedule.length,
        totalSessions: allSessions.length,
        dailyMins: parsed.dailyMins || state.user.sessionMins,
        schedule
    };
}

// ── Local plan generator (no API) ──────────────────────────────
function generatePlanLocally(message) {
    const msg = message.toLowerCase();

    // Parse days from message
    let days = 18;
    const dayMatch = msg.match(/(\d+)\s*(day|week|month)/);
    if (dayMatch) {
        const num = parseInt(dayMatch[1]);
        const unit = dayMatch[2];
        days = unit === 'week' ? num * 7 : unit === 'month' ? num * 30 : num;
    }
    days = clamp(days, 3, 90);

    // Determine subject/goal type
    const subjects = {
        'exam|test|quiz|math|science|history|biology|chemistry|physics|exam': {
            name: 'Exam Prep Plan',
            phases: ['Foundation', 'Core concepts', 'Practice problems', 'Review & mock tests', 'Final revision']
        },
        'guitar|piano|music|instrument|song': {
            name: 'Music Practice Plan',
            phases: ['Basics', 'Technique', 'Songs practice', 'Performance prep', 'Polish']
        },
        'run|jog|5k|marathon|fitness|exercise|workout': {
            name: 'Fitness Training Plan',
            phases: ['Base building', 'Endurance', 'Speed work', 'Peak training', 'Taper']
        },
        'thesis|essay|write|book|paper|word': {
            name: 'Writing Plan',
            phases: ['Research & outline', 'First draft', 'Second draft', 'Editing', 'Final polish']
        },
        'code|program|learn|javascript|python|app|project': {
            name: 'Learning Plan',
            phases: ['Fundamentals', 'Core skills', 'Projects', 'Advanced topics', 'Review & portfolio']
        }
    };

    let planMeta = { name: 'Personal Goal Plan', phases: ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Final'] };
    for (const [keywords, meta] of Object.entries(subjects)) {
        if (keywords.split('|').some(k => msg.includes(k))) { planMeta = meta; break; }
    }

    const sessionMins = state.user.sessionMins;
    const startDate = today();
    const schedule = [];

    // Generate schedule
    for (let i = 0; i < days; i++) {
        const dateStr = addDays(startDate, i);
        const dow = DAYS[new Date(dateStr + 'T12:00:00').getDay()];
        const availHours = state.weekHours[dow] || 0;

        if (availHours <= 0) { schedule.push({ date: dateStr, focus: 'Rest Day', sessions: [] }); continue; }

        const maxSessions = Math.floor((availHours * 60) / sessionMins);
        const numSessions = clamp(maxSessions, 1, 3);

        // Phase-based focus
        const phaseIdx = Math.floor((i / days) * planMeta.phases.length);
        const phase = planMeta.phases[Math.min(phaseIdx, planMeta.phases.length - 1)];

        const sessions = [];
        for (let j = 0; j < numSessions; j++) {
            const sessionTitles = getSessionTitles(phase, j, numSessions, planMeta.name, msg);
            sessions.push({ id: uid(), title: sessionTitles, duration: sessionMins, type: getSessionType(j, numSessions), done: false });
        }

        schedule.push({ date: dateStr, focus: phase, sessions });
    }

    const allSessions = schedule.flatMap(d => d.sessions);
    const endDate = schedule.length ? schedule[schedule.length - 1].date : startDate;

    return {
        name: planMeta.name,
        goal: message,
        summary: `A ${days}-day personalized plan tailored to your schedule. Starts with foundations, builds up progressively, and finishes with review sessions.`,
        startDate,
        endDate,
        totalDays: schedule.length,
        totalSessions: allSessions.length,
        dailyMins: sessionMins,
        schedule
    };
}

function getSessionType(idx, total) {
    if (idx === total - 1) return 'review';
    if (idx === 0) return 'study';
    return 'practice';
}

function getSessionTitles(phase, sessionIdx, totalSessions, planName, msg) {
    const examTitles = {
        'Foundation': ['Read textbook chapters', 'Make summary notes', 'Watch lecture videos'],
        'Core concepts': ['Study formulas & theory', 'Worked examples', 'Concept map creation'],
        'Practice problems': ['Past paper questions', 'Timed exercises', 'Problem solving drills'],
        'Review & mock tests': ['Full mock exam', 'Review mistakes', 'Weak areas focus'],
        'Final revision': ['Quick recap notes', 'Final review', 'Relaxation & prep']
    };
    const fitnessTitles = {
        'Base building': ['Easy 20-min jog', 'Stretching & warmup', 'Walk/run intervals'],
        'Endurance': ['30-min steady run', 'Long slow run', 'Active recovery'],
        'Speed work': ['Interval sprints', '400m repeats', 'Tempo run'],
        'Peak training': ['Long run', 'Race simulation', 'Strength training'],
        'Taper': ['Easy short run', 'Rest & stretching', 'Mental prep']
    };
    const writingTitles = {
        'Research & outline': ['Literature review', 'Create outline', 'Gather sources'],
        'First draft': ['Write intro', 'Draft body sections', 'Write conclusion'],
        'Second draft': ['Revise structure', 'Improve arguments', 'Add evidence'],
        'Editing': ['Grammar & style check', 'Citations formatting', 'Peer review feedback'],
        'Final polish': ['Final proofread', 'Format & submit', 'Backup & archive']
    };

    const allTitles = { ...examTitles, ...fitnessTitles, ...writingTitles };
    const titles = allTitles[phase];
    if (titles && titles[sessionIdx]) return titles[sessionIdx];

    return `${phase} – Session ${sessionIdx + 1}`;
}

// ── Plan modal ─────────────────────────────────────────────────
function showPlanModal(planData) {
    document.getElementById('modal-title').textContent = planData.name;
    const body = document.getElementById('modal-body');
    body.innerHTML = `
    <p style="color:var(--text2);margin-bottom:1rem;font-size:0.88rem;">${planData.summary}</p>
    <div style="display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
      <span style="font-size:0.82rem;color:var(--purple-l)">📅 ${planData.totalDays} days</span>
      <span style="font-size:0.82rem;color:var(--cyan-l)">🗓 ${planData.totalSessions} sessions</span>
      <span style="font-size:0.82rem;color:var(--text2)">⏱ ~${planData.dailyMins} min/day</span>
    </div>
    <div class="plan-preview" style="max-height:320px;overflow-y:auto">
      ${planData.schedule.filter(d => d.sessions.length > 0).slice(0, 10).map(d => `
        <div class="preview-day">
          <div class="preview-day-header">
            <div class="preview-day-label">${fmtDate(d.date)} – ${d.focus}</div>
          </div>
          <div class="preview-sessions">
            ${d.sessions.map(s => `
              <span class="preview-session" style="background:rgba(124,58,237,0.15);color:#a855f7;border-color:#7c3aed">
                ${s.title} (${s.duration}min)
              </span>`).join('')}
          </div>
        </div>`).join('')}
      ${planData.schedule.filter(d => d.sessions.length > 0).length > 10
            ? `<p style="color:var(--text3);font-size:0.78rem;text-align:center;margin-top:0.5rem">...and ${planData.schedule.filter(d => d.sessions.length > 0).length - 10} more days</p>`
            : ''}
    </div>
  `;
    document.getElementById('plan-modal').classList.remove('hidden');
}

function initModals() {
    document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('plan-modal').classList.add('hidden');
    });
    document.getElementById('modal-confirm').addEventListener('click', () => {
        if (state.pendingPlanData) {
            savePlan(state.pendingPlanData);
            document.getElementById('plan-modal').classList.add('hidden');
        }
    });
    document.getElementById('modal-cancel').addEventListener('click', () => {
        document.getElementById('plan-modal').classList.add('hidden');
        appendBubble('ai', 'No problem! Tell me more details and I\'ll generate a better plan.');
    });

    document.getElementById('reschedule-modal-close').addEventListener('click', () => {
        document.getElementById('reschedule-modal').classList.add('hidden');
    });
    document.getElementById('reschedule-cancel').addEventListener('click', () => {
        document.getElementById('reschedule-modal').classList.add('hidden');
    });
    document.getElementById('reschedule-confirm').addEventListener('click', () => {
        if (state.pendingReschedule && state.reschedulePlanId) {
            applyReschedule(state.reschedulePlanId, state.pendingReschedule);
            document.getElementById('reschedule-modal').classList.add('hidden');
            toast('Plan rescheduled successfully! 🔄', 'success');
            renderDashboard();
            renderPlans();
            if (state.currentPlanId === state.reschedulePlanId) renderPlanDetail(state.reschedulePlanId);
        }
    });

    // Close modals on overlay click
    ['plan-modal', 'reschedule-modal'].forEach(id => {
        document.getElementById(id).addEventListener('click', e => {
            if (e.target === document.getElementById(id)) {
                document.getElementById(id).classList.add('hidden');
            }
        });
    });
}

function applyReschedule(planId, rescheduled) {
    const plan = state.plans.find(p => p.id === planId);
    if (!plan) return;
    const t = today();

    // Remove undone past sessions
    plan.schedule.forEach(d => {
        if (d.date < t) d.sessions = d.sessions.filter(s => s.done);
    });

    // Add rescheduled sessions
    rescheduled.forEach(({ date, added }) => {
        const day = plan.schedule.find(d => d.date === date);
        if (day) day.sessions.push(...added);
    });

    saveState();
}

// ── Save plan ──────────────────────────────────────────────────
function savePlan(planData) {
    const plan = {
        id: uid(),
        name: planData.name,
        goal: planData.goal,
        summary: planData.summary,
        startDate: planData.startDate,
        endDate: planData.endDate,
        createdAt: new Date().toISOString(),
        schedule: planData.schedule
    };

    state.plans.push(plan);
    state.pendingPlanData = null;
    saveState();

    toast(`Plan "${plan.name}" saved! 🎉`, 'success', '🎉');
    renderDashboard();
    switchView('plans');
    renderPlans();
}

// ── Settings ───────────────────────────────────────────────────
function renderSettings() {
    document.getElementById('settings-name').value = state.user.name || '';
    document.getElementById('settings-api-key').value = state.user.apiKey || '';
    const modelSel = document.getElementById('settings-model');
    if (modelSel) modelSel.value = state.user.geminiModel || 'gemini-2.5-flash';
    renderHoursGrid('settings-hours-grid', true);

    // Session opts
    document.querySelectorAll('#settings-session-opts .session-opt').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.mins) === state.user.sessionMins);
        btn.addEventListener('click', () => {
            document.querySelectorAll('#settings-session-opts .session-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.user.sessionMins = parseInt(btn.dataset.mins);
        });
    });
}

function initSettings() {
    document.getElementById('save-settings-btn').addEventListener('click', () => {
        state.user.name = document.getElementById('settings-name').value.trim() || state.user.name;
        state.user.apiKey = document.getElementById('settings-api-key').value.trim();
        const modelSel = document.getElementById('settings-model');
        if (modelSel) state.user.geminiModel = modelSel.value;
        saveState();
        renderSidebar();
        document.getElementById('greeting-name').textContent = state.user.name;
        toast('Settings saved!', 'success');
    });
}

// ── Reset ──────────────────────────────────────────────────────
function resetPlanner() {
    if (!confirm('Reset all data? This will delete all your plans and settings.')) return;
    localStorage.removeItem('planai_state');
    location.reload();
}

// ── Bootstrap ──────────────────────────────────────────────────
function bootstrap() {
    loadState();

    // If already onboarded, go straight to app
    if (state.user.name) {
        document.getElementById('onboarding-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        initApp();
    } else {
        initOnboarding();
    }
}

bootstrap();
