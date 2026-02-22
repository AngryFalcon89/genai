// --- DOM Elements ---
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const filePreview = document.getElementById('file-preview');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const fileRemove = document.getElementById('file-remove');
const uploadBtn = document.getElementById('upload-btn');
const courseInput = document.getElementById('timetable-course');
const branchInput = document.getElementById('timetable-branch');
const semesterInput = document.getElementById('timetable-semester');
const processingState = document.getElementById('processing-state');
const resultMessage = document.getElementById('result-message');
const timetablesContainer = document.getElementById('timetables-container');
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const modalTitle = document.getElementById('modal-title');
const modalDesc = document.getElementById('modal-desc');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');

let selectedFile = null;
let pendingDeleteId = null;

// ========== Navigation ==========
document.querySelectorAll('.admin-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        document.querySelectorAll('.admin-nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
        document.getElementById(`section-${section}`).classList.add('active');
        if (section === 'view') loadTimetables();
    });
});
sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

// ========== Upload ==========
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault(); uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) selectFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length > 0) selectFile(fileInput.files[0]); });

function selectFile(file) {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) { showResult('error', '❌ Unsupported file type.'); return; }
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    filePreview.style.display = 'flex'; uploadZone.style.display = 'none';
    uploadBtn.disabled = false; resultMessage.style.display = 'none';
}
function formatBytes(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
fileRemove.addEventListener('click', clearFile);
function clearFile() { selectedFile = null; fileInput.value = ''; filePreview.style.display = 'none'; uploadZone.style.display = ''; uploadBtn.disabled = true; }

uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    const course = courseInput.value.trim();
    const branch = branchInput.value.trim();
    const semester = semesterInput.value.trim();

    uploadBtn.disabled = true; uploadBtn.style.display = 'none';
    filePreview.style.display = 'none'; processingState.style.display = 'flex';
    resultMessage.style.display = 'none';

    const fd = new FormData();
    fd.append('file', selectedFile);
    if (course) fd.append('course', course);
    if (branch) fd.append('branch', branch);
    if (semester) fd.append('semester', semester);

    try {
        const res = await fetch('/api/admin/timetable', { method: 'POST', body: fd });
        const data = await res.json();
        if (res.ok && data.success) {
            showResult('success', `✅ ${data.message} — ${data.data.entries.length} entries extracted.`);
            courseInput.value = ''; branchInput.value = ''; semesterInput.value = ''; clearFile();
        } else { showResult('error', `❌ ${data.error || 'Upload failed.'}`); clearFile(); }
    } catch (err) { showResult('error', `❌ Network error: ${err.message}`); clearFile(); }
    processingState.style.display = 'none'; uploadBtn.style.display = '';
});

function showResult(type, msg) { resultMessage.className = `result-message ${type}`; resultMessage.textContent = msg; resultMessage.style.display = 'flex'; }

// ========== View Timetables ==========
async function loadTimetables() {
    timetablesContainer.innerHTML = '<div class="status-loading"><div class="processing-spinner"></div><span>Loading timetables...</span></div>';
    try {
        const res = await fetch('/api/admin/timetable');
        const data = await res.json();
        if (data.active && data.timetables.length > 0) {
            timetablesContainer.innerHTML = '';
            for (const tt of data.timetables) timetablesContainer.appendChild(buildTimetableCard(tt));
        } else {
            timetablesContainer.innerHTML = '<div class="status-empty"><span class="status-empty-icon">📭</span><h3>No timetables uploaded</h3><p>Upload a timetable from the "Upload Timetable" section.</p></div>';
        }
    } catch (err) {
        timetablesContainer.innerHTML = `<div class="status-empty"><span class="status-empty-icon">⚠️</span><h3>Failed to load</h3><p>${err.message}</p></div>`;
    }
}

// ========== Timetable Card ==========
function buildTimetableCard(tt) {
    const card = document.createElement('div');
    card.className = 'timetable-card';
    card.dataset.id = tt.id;

    const uploadDate = new Date(tt.uploadedAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // Header with editable metadata
    const displayName = tt.branch || 'Untitled Timetable';
    card.innerHTML = `
        <div class="timetable-card-header">
            <div class="timetable-card-info">
                <div class="timetable-card-dot"></div>
                <div style="min-width:0">
                    <div class="timetable-card-metadata">
                        <span class="meta-edit" data-field="course" title="Click to edit course">${esc(tt.course) || '<em>No Course</em>'}</span> • 
                        <span class="meta-edit branch" data-field="branch" title="Click to edit branch">${esc(tt.branch) || '<em>No Branch</em>'}</span> • 
                        <span class="meta-edit" data-field="semester" title="Click to edit semester">Sem ${esc(tt.semester) || '<em>?</em>'}</span>
                    </div>
                    <div class="timetable-card-meta">${tt.entries.length} entries • Uploaded ${uploadDate}</div>
                </div>
            </div>
            <div class="timetable-card-actions">
                <button class="timetable-card-edit-toggle">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Edit Data
                </button>
                <button class="timetable-card-delete" data-id="${tt.id}" data-name="${esc(displayName)}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                    Delete
                </button>
            </div>
        </div>`;

    // Grid view & Action Bar
    const gridWrapper = document.createElement('div');
    gridWrapper.className = 'weekly-grid-wrapper';

    const actionBar = document.createElement('div');
    actionBar.className = 'edit-actions-bar';
    actionBar.innerHTML = `
        <div class="edit-actions-info">Editing grid directly. Click events to edit, drag right edge to extend time.</div>
        <div style="display:flex; gap:8px;">
            <button class="btn-cancel" style="background:none; border:none; color:var(--text-muted); cursor:pointer;">Cancel</button>
            <button class="btn-primary">Save Changes</button>
        </div>
    `;

    let isEditing = false;
    let draftEntries = [];

    const legend = document.createElement('div');
    legend.className = 'grid-legend';
    legend.innerHTML = '<div class="legend-item"><div class="legend-dot lecture"></div>Lecture</div><div class="legend-item"><div class="legend-dot lab"></div>Lab</div><div class="legend-item"><div class="legend-dot tutorial"></div>Tutorial</div>';

    const renderGridState = () => {
        gridWrapper.innerHTML = '';
        gridWrapper.appendChild(buildWeeklyGrid(isEditing ? draftEntries : tt.entries, isEditing, (newEntries) => {
            draftEntries = newEntries;
            renderGridState(); // Re-render live
        }));
        legend.style.display = isEditing ? 'none' : 'flex';
        actionBar.classList.toggle('visible', isEditing);
    };

    renderGridState();

    card.appendChild(gridWrapper);
    card.appendChild(legend);
    card.appendChild(actionBar);

    // --- Event Handlers ---

    // Editable metadata (click to input)
    card.querySelectorAll('.meta-edit').forEach(el => bindMetaClick(el, tt, el.dataset.field));

    // Edit toggle
    const editBtn = card.querySelector('.timetable-card-edit-toggle');
    editBtn.addEventListener('click', () => {
        if (!isEditing) {
            isEditing = true;
            draftEntries = mergeConsecutiveEntries(JSON.parse(JSON.stringify(tt.entries)));
            editBtn.style.display = 'none';
            renderGridState();
        }
    });

    actionBar.querySelector('.btn-cancel').addEventListener('click', () => {
        if (!confirm('Discard all unsaved changes to this timetable?')) return;
        isEditing = false;
        editBtn.style.display = '';
        renderGridState();
    });

    actionBar.querySelector('.btn-primary').addEventListener('click', async () => {
        const btn = actionBar.querySelector('.btn-primary');
        btn.textContent = 'Saving...'; btn.disabled = true;
        try {
            const res = await fetch(`/api/admin/timetable/${tt.id}/entries`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: draftEntries })
            });
            if (res.ok) {
                tt.entries = JSON.parse(JSON.stringify(draftEntries));
                isEditing = false;
                editBtn.style.display = '';
                renderGridState();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to save');
            }
        } catch (e) { alert('Network error'); }
        btn.textContent = 'Save Changes'; btn.disabled = false;
    });

    // Delete
    card.querySelector('.timetable-card-delete').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        pendingDeleteId = btn.dataset.id;
        modalTitle.textContent = `Delete "${btn.dataset.name}"?`;
        confirmModalOverlay.classList.add('visible');
    });

    return card;
}

function bindMetaClick(el, tt, field) {
    el.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'timetable-meta-input';
        let currentVal = tt[field] || '';
        input.value = currentVal;
        el.replaceWith(input);
        input.focus(); input.select();

        const save = async () => {
            const newVal = input.value.trim();
            if (newVal !== tt[field]) {
                try {
                    await fetch(`/api/admin/timetable/${tt.id}/metadata`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ [field]: newVal })
                    });
                    tt[field] = newVal;
                } catch (e) { console.error(e); }
            }
            const newEl = document.createElement('span');
            newEl.className = field === 'branch' ? 'meta-edit branch' : 'meta-edit';
            newEl.dataset.field = field;
            newEl.title = `Click to edit ${field}`;
            if (field === 'semester') {
                newEl.innerHTML = `Sem ${esc(tt.semester) || '<em>?</em>'}`;
            } else {
                newEl.innerHTML = esc(tt[field]) || `<em>No ${field.charAt(0).toUpperCase() + field.slice(1)}</em>`;
            }
            input.replaceWith(newEl);
            bindMetaClick(newEl, tt, field);
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = currentVal; input.blur(); } });
    });
}

// ========== Weekly Grid (Days as ROWS, Time as COLUMNS) ==========

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = { Monday: 'MON', Tuesday: 'TUE', Wednesday: 'WED', Thursday: 'THU', Friday: 'FRI', Saturday: 'SAT' };

function buildWeeklyGrid(entries, isEditing = false, onChange = null) {
    // 1. Collect all unique time boundaries sorted
    // If editing, seed standard boundaries so empty grids have structure
    const boundarySet = new Set(isEditing ? [530, 580, 630, 680, 730, 780] : []);
    for (const e of entries) {
        boundarySet.add(parseTimeMin(e.start_time));
        boundarySet.add(parseTimeMin(e.end_time));
    }
    const boundaries = [...boundarySet].sort((a, b) => a - b);
    if (boundaries.length < 2) {
        const p = document.createElement('p');
        p.textContent = 'No schedule entries.'; p.style.cssText = 'padding:24px;color:var(--text-muted);text-align:center;';
        return p;
    }

    const numPeriods = boundaries.length - 1;
    const bIndex = new Map();
    boundaries.forEach((b, i) => bIndex.set(b, i));

    const daySet = new Set(entries.map(e => e.day));
    let activeDays = DAYS.filter(d => daySet.has(d));
    if (activeDays.length === 0 || isEditing) activeDays = [...DAYS];

    const grid = document.createElement('div');
    grid.className = 'weekly-grid';
    grid.style.gridTemplateColumns = `90px repeat(${numPeriods}, minmax(80px, 1fr))`;

    // Header row
    grid.innerHTML = '<div class="grid-header day-col">Day</div>';
    for (let i = 0; i < numPeriods; i++) {
        const startLabel = minToTimeStr(boundaries[i]);
        const endLabel = minToTimeStr(boundaries[i + 1]);
        grid.innerHTML += `<div class="grid-header">${compactTime(startLabel)}<br>${compactTime(endLabel)}</div>`;
    }

    // Days rows
    for (const day of activeDays) {
        const dayLabel = document.createElement('div');
        dayLabel.className = 'grid-day-label';
        dayLabel.textContent = DAY_SHORT[day] || day.substring(0, 3).toUpperCase();
        grid.appendChild(dayLabel);

        const dayEntries = entries.filter(e => e.day === day);
        const occupied = new Array(numPeriods).fill(false);

        const placements = [];
        for (const entry of dayEntries) {
            const startMin = parseTimeMin(entry.start_time);
            const endMin = parseTimeMin(entry.end_time);
            const colStart = bIndex.get(startMin);
            const colEnd = bIndex.get(endMin);
            if (colStart === undefined || colEnd === undefined || colStart >= colEnd) continue;
            placements.push({ entry, colStart, colEnd });
            for (let c = colStart; c < colEnd; c++) occupied[c] = true;
        }

        const dayRow = document.createElement('div');
        dayRow.className = 'grid-day-row';
        if (isEditing) dayRow.classList.add('editing');
        dayRow.style.gridColumn = `2 / ${numPeriods + 2}`;
        dayRow.style.display = 'grid';
        dayRow.style.gridTemplateColumns = `repeat(${numPeriods}, minmax(80px, 1fr))`;
        dayRow.style.gap = '1px';

        for (const { entry, colStart, colEnd } of placements) {
            const span = colEnd - colStart;
            const tc = getTypeClass(entry.type);
            const ev = document.createElement('div');
            ev.className = `grid-event ${tc}`;
            ev.style.gridColumn = `${colStart + 1} / ${colEnd + 1}`;
            ev.innerHTML = `<span class="event-code">${esc(entry.course_code) || ''}</span><span class="event-title">${esc(entry.course_title) || ''}</span>`;
            if (!isEditing) ev.title = `${entry.course_code} — ${entry.course_title}\n${entry.start_time} – ${entry.end_time}\n${entry.type}`;

            if (isEditing) {
                ev.classList.add('editing');

                const handleLeft = document.createElement('div');
                handleLeft.className = 'resize-handle left';
                handleLeft.onmousedown = (e) => startResize(e, handleLeft, ev, entry, colStart, colEnd, boundaries, numPeriods, entries, onChange, true);
                ev.appendChild(handleLeft);

                const handleRight = document.createElement('div');
                handleRight.className = 'resize-handle';
                handleRight.onmousedown = (e) => startResize(e, handleRight, ev, entry, colStart, colEnd, boundaries, numPeriods, entries, onChange, false);
                ev.appendChild(handleRight);

                ev.onclick = (e) => {
                    if (e.target === handleRight || handleRight.contains(e.target) || e.target === handleLeft || handleLeft.contains(e.target)) return;
                    showGridPopover(entry, ev, entries, onChange);
                };
            }
            if (span > 1) ev.classList.add('spanning');
            dayRow.appendChild(ev);
        }

        // Empty cells
        for (let c = 0; c < numPeriods; c++) {
            if (!occupied[c]) {
                const empty = document.createElement('div');
                empty.className = 'grid-cell-empty';
                empty.style.gridColumn = `${c + 1} / ${c + 2}`;
                if (isEditing) {
                    empty.classList.add('editing');
                    empty.onclick = () => {
                        const newEntry = {
                            course_code: '', course_title: '', day: day,
                            start_time: minToTimeStr(boundaries[c]),
                            end_time: minToTimeStr(boundaries[c + 1]),
                            type: 'Lecture'
                        };
                        entries.push(newEntry);
                        // render and show popover on next frame after dom updates
                        onChange(entries, true, newEntry);
                    };
                }
                dayRow.appendChild(empty);
            }
        }
        grid.appendChild(dayRow);
    }
    return grid;
}

function minToTimeStr(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
}
function compactTime(t) { return (t || '').replace(':00', '').replace(' ', ''); }
function parseTimeMin(t) {
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return 0;
    let h = +m[1]; const min = +m[2], ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + min;
}
function getTypeClass(t) { const s = (t || '').toLowerCase(); if (s.includes('lab')) return 'lab'; if (s.includes('tut')) return 'tutorial'; return 'lecture'; }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ========== Grid Edit Helpers ==========

function mergeConsecutiveEntries(entries) {
    const byDay = {};
    for (const e of entries) {
        if (!byDay[e.day]) byDay[e.day] = [];
        byDay[e.day].push({ ...e }); // deep enough copy
    }
    const merged = [];
    for (const day of DAYS) {
        if (!byDay[day]) continue;
        const dayEntries = byDay[day].sort((a, b) => parseTimeMin(a.start_time) - parseTimeMin(b.start_time));
        const dayMerged = [];
        for (const entry of dayEntries) {
            if (dayMerged.length > 0) {
                const prev = dayMerged[dayMerged.length - 1];
                if (prev.course_code === entry.course_code &&
                    prev.type === entry.type &&
                    parseTimeMin(prev.end_time) === parseTimeMin(entry.start_time)) {
                    prev.end_time = entry.end_time;
                    continue;
                }
            }
            dayMerged.push(entry);
        }
        merged.push(...dayMerged);
    }
    return merged;
}

function startResize(e, handle, ev, entry, initialColStart, initialColEnd, boundaries, numPeriods, allEntries, onChange, isLeft = false) {
    e.stopPropagation(); e.preventDefault();
    handle.classList.add('active');
    const startX = e.clientX;
    const dayRow = ev.parentElement;
    const colWidth = dayRow.offsetWidth / numPeriods;

    const onMove = (me) => {
        const deltaX = me.clientX - startX;
        let colsToAdd = Math.round(deltaX / colWidth);

        if (isLeft) {
            let newColStart = initialColStart + colsToAdd;
            if (newColStart >= initialColEnd) newColStart = initialColEnd - 1;
            if (newColStart < 0) newColStart = 0;
            ev.style.gridColumn = `${newColStart + 1} / ${initialColEnd + 1}`;
            ev.dataset.newStart = newColStart;
        } else {
            let newColEnd = initialColEnd + colsToAdd;
            if (newColEnd <= initialColStart) newColEnd = initialColStart + 1;
            if (newColEnd > numPeriods) newColEnd = numPeriods;
            ev.style.gridColumn = `${initialColStart + 1} / ${newColEnd + 1}`;
            ev.dataset.newEnd = newColEnd;
        }
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('active');

        if (isLeft) {
            const newStartIndex = parseInt(ev.dataset.newStart);
            if (!isNaN(newStartIndex) && newStartIndex !== initialColStart) {
                entry.start_time = minToTimeStr(boundaries[newStartIndex]);
                onChange(allEntries);
            } else {
                ev.style.gridColumn = `${initialColStart + 1} / ${initialColEnd + 1}`;
            }
        } else {
            const newEndIndex = parseInt(ev.dataset.newEnd);
            if (!isNaN(newEndIndex) && newEndIndex !== initialColEnd) {
                entry.end_time = minToTimeStr(boundaries[newEndIndex]);
                onChange(allEntries);
            } else {
                ev.style.gridColumn = `${initialColStart + 1} / ${initialColEnd + 1}`;
            }
        }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

let activePopover = null;
function showGridPopover(entry, targetEl, allEntries, onChange) {
    if (activePopover) { activePopover.overlay.click(); }

    // Extract unique courses for suggestions
    const knownCourses = {};
    for (const e of allEntries) {
        const c = (e.course_code || '').trim().toUpperCase();
        if (c && !knownCourses[c] && e.course_title) {
            knownCourses[c] = e.course_title;
        }
    }

    const datalistId = `dl-${Date.now()}`;
    const dlOpts = Object.keys(knownCourses).map(c => `<option value="${esc(c)}">${esc(knownCourses[c])}</option>`).join('');

    const pop = document.createElement('div');
    pop.className = 'grid-popover';

    const overlay = document.createElement('div');
    overlay.className = 'grid-popover-overlay';
    overlay.onclick = () => { pop.remove(); overlay.remove(); activePopover = null; };

    pop.innerHTML = `
        <div class="popover-header">
            Edit Class
            <button class="close-btn" type="button">&times;</button>
        </div>
        <div class="row">
            <div class="input-group" style="flex:1">
                <label>Code</label>
                <input type="text" id="pop-code" list="${datalistId}" value="${esc(entry.course_code || '')}" placeholder="e.g. CS101" autocomplete="off">
                <datalist id="${datalistId}">${dlOpts}</datalist>
            </div>
            <div class="input-group" style="flex:1">
                <label>Type</label>
                <select id="pop-type">
                    <option value="Lecture" ${entry.type === 'Lecture' ? 'selected' : ''}>Lecture</option>
                    <option value="Lab" ${entry.type === 'Lab' ? 'selected' : ''}>Lab</option>
                    <option value="Tutorial" ${entry.type === 'Tutorial' ? 'selected' : ''}>Tutorial</option>
                </select>
            </div>
        </div>
        <div class="input-group">
            <label>Title</label>
            <input type="text" id="pop-title" value="${esc(entry.course_title || '')}" placeholder="e.g. Calculus I">
        </div>
        <div class="popover-actions">
            <button class="btn-delete" type="button">Delete</button>
            <button class="btn-save" type="button">Apply</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(pop);
    activePopover = { pop, overlay };

    const codeInput = pop.querySelector('#pop-code');
    const titleInput = pop.querySelector('#pop-title');

    // Auto-fill title based on code
    codeInput.addEventListener('input', () => {
        const val = codeInput.value.trim().toUpperCase();
        if (knownCourses[val]) {
            titleInput.value = knownCourses[val];
        }
    });

    const rect = targetEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();

    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;

    // Prevent clipping right edge
    if (left + popRect.width > document.documentElement.clientWidth - 16) {
        left = document.documentElement.clientWidth - popRect.width - 16;
        if (left < 16) left = 16;
    }

    // Prevent clipping bottom edge (flip above if necessary)
    if (rect.bottom + popRect.height + 16 > document.documentElement.clientHeight && rect.top > popRect.height + 16) {
        top = rect.top + window.scrollY - popRect.height - 8;
    }

    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    pop.querySelector('.close-btn').onclick = () => overlay.click();

    pop.querySelector('.btn-delete').onclick = () => {
        const newEntries = allEntries.filter(e => e !== entry);
        overlay.click();
        onChange(newEntries);
    };

    pop.querySelector('.btn-save').onclick = () => {
        entry.course_code = codeInput.value.trim();
        entry.course_title = titleInput.value.trim();
        entry.type = pop.querySelector('#pop-type').value;
        // Optionally delete entry.room if it existed before
        delete entry.room;
        overlay.click();
        onChange(allEntries);
    };

    pop.querySelector('#pop-code').focus();
}

// ========== Delete ==========
confirmCancelBtn.addEventListener('click', closeModal);
confirmModalOverlay.addEventListener('click', (e) => { if (e.target === confirmModalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
function closeModal() { confirmModalOverlay.classList.remove('visible'); pendingDeleteId = null; }

confirmDeleteBtn.addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId; closeModal();
    try {
        const res = await fetch(`/api/admin/timetable/${id}`, { method: 'DELETE' });
        if (res.ok) loadTimetables();
    } catch (err) { console.error(err); }
});

// --- Init ---
if (window.location.hash === '#view') document.querySelector('[data-section="view"]').click();
