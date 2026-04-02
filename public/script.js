
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatMessages = document.getElementById('chat-messages');
const sendBtn = document.getElementById('send-btn');
const sessionList = document.getElementById('session-list');
const newChatBtn = document.getElementById('new-chat-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const uploadBtn = document.getElementById('upload-btn');
const fileUploadInput = document.getElementById('file-upload-input');

let currentSessionId = localStorage.getItem('currentSessionId') || null;
let pendingDeleteSessionId = null;
let pendingDeleteElement = null;

// --- Time Formatting ---
function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- UI Helpers ---
function getWelcomeScreen() {
    return document.getElementById('welcome-screen');
}

function hideWelcomeScreen() {
    const welcomeScreen = getWelcomeScreen();
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }
}

function addMessage(text, isUser, options = [], time = null) {
    // Hide welcome screen when first message appears
    hideWelcomeScreen();

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(isUser ? 'user-message' : 'bot-message');

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    let copyBtn = null;

    if (isUser) {
        contentDiv.textContent = text;
    } else {
        const rawHtml = marked.parse(text, { gfm: true, breaks: true });
        contentDiv.innerHTML = DOMPurify.sanitize(rawHtml);

        // Add copy button for bot messages
        copyBtn = document.createElement('button');
        copyBtn.classList.add('copy-btn');
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
        copyBtn.title = 'Copy message';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
                }, 2000);
            });
        });
    }

    messageDiv.appendChild(contentDiv);

    // Append copy button outside the content card (bot messages only)
    if (copyBtn) {
        messageDiv.appendChild(copyBtn);
    }

    // Add option chips if provided (only for bot messages)
    if (!isUser && options.length > 0) {
        const optionsDiv = createOptionChips(options);
        contentDiv.appendChild(optionsDiv);
    }

    // Add timestamp
    const timeDiv = document.createElement('div');
    timeDiv.classList.add('message-time');
    timeDiv.textContent = time || formatTime(new Date());
    messageDiv.appendChild(timeDiv);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createOptionChips(options) {
    const container = document.createElement('div');
    container.classList.add('message-options');

    options.forEach(option => {
        const chip = document.createElement('button');
        chip.classList.add('option-chip');
        chip.textContent = option;
        chip.addEventListener('click', () => {
            sendMessage(option);
            // Disable all chips in this group after one is clicked
            container.querySelectorAll('.option-chip').forEach(c => {
                c.disabled = true;
                c.style.opacity = '0.4';
                c.style.cursor = 'default';
            });
            // Highlight the selected chip
            chip.style.opacity = '1';
            chip.style.background = 'var(--primary-light)';
            chip.style.borderColor = 'var(--primary)';
            chip.style.color = 'var(--accent)';
        });
        container.appendChild(chip);
    });

    return container;
}

function showTypingIndicator() {
    const indicatorDiv = document.createElement('div');
    indicatorDiv.classList.add('message', 'bot-message', 'typing-indicator-container');
    indicatorDiv.innerHTML = `
        <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    chatMessages.appendChild(indicatorDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return indicatorDiv;
}

function clearChat() {
    chatMessages.innerHTML = '';
    // Re-create welcome screen
    const welcome = document.createElement('div');
    welcome.id = 'welcome-screen';
    welcome.className = 'welcome-screen';
    welcome.innerHTML = `
        <div class="welcome-icon">🎓</div>
        <h2>Hey there! I'm ZHCET Buddy 👋</h2>
        <p>Your friendly academic advisor for Zakir Husain College of Engineering & Technology. I can help you with courses, rules, grading, and everything ZHCET!</p>
        <div class="quick-start">
            <h3>What would you like to know?</h3>
            <div class="option-chips" id="welcome-chips">
                <button class="option-chip" data-message="📋 Show me course structures">📋 Course Structures</button>
                <button class="option-chip" data-message="📖 Tell me about rules and ordinances">📖 Rules & Ordinances</button>
                <button class="option-chip" data-message="📊 Explain the grading system">📊 Grading System</button>
                <button class="option-chip" data-message="🏫 Tell me about ZHCET">🏫 About ZHCET</button>
                <button class="option-chip" data-message="🎓 What are the promotion rules?">🎓 Promotion Rules</button>
                <button class="option-chip" data-message="📚 Tell me about the library">📚 Library Info</button>
                <button class="option-chip upload-chip" id="welcome-upload-chip">📄 Upload Registration Card</button>
            </div>
        </div>
    `;
    chatMessages.appendChild(welcome);
    bindWelcomeChips();
    bindWelcomeUploadChip();
}

function bindWelcomeChips() {
    document.querySelectorAll('#welcome-chips .option-chip:not(.upload-chip), #welcome-screen .option-chip:not(.upload-chip)').forEach(chip => {
        chip.addEventListener('click', () => {
            const message = chip.getAttribute('data-message');
            if (message) sendMessage(message);
        });
    });
}

function bindWelcomeUploadChip() {
    document.querySelectorAll('#welcome-upload-chip, .welcome-upload-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            fileUploadInput.click();
        });
    });
}

// --- Textarea Auto-Resize ---
function autoResizeTextarea() {
    userInput.style.height = 'auto';
    const maxHeight = 150;
    userInput.style.height = Math.min(userInput.scrollHeight, maxHeight) + 'px';
}

// --- Session Logic ---

async function loadSessions() {
    try {
        const res = await fetch('/api/sessions');
        if (!res.ok) return;
        const sessions = await res.json();

        sessionList.innerHTML = '';
        sessions.forEach(session => {
            const div = document.createElement('div');
            div.className = `session-item ${session.id === currentSessionId ? 'active' : ''}`;

            const title = document.createElement('span');
            title.textContent = session.title;

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-session-btn';
            deleteBtn.type = 'button';
            deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
            deleteBtn.title = 'Delete chat';
            deleteBtn.addEventListener('click', (e) => requestDeleteSession(e, session.id, div));

            div.onclick = (e) => {
                if (e.target === deleteBtn) return;
                loadSession(session.id);
            };
            div.appendChild(title);
            div.appendChild(deleteBtn);
            sessionList.appendChild(div);
        });
    } catch (e) {
        console.error("Failed to load sessions:", e);
    }
}

async function loadSession(sessionId) {
    currentSessionId = sessionId;
    localStorage.setItem('currentSessionId', sessionId);

    // Update active class in sidebar
    document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
    loadSessions();

    // Close sidebar on mobile
    closeSidebar();

    try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) return;
        const history = await res.json();

        chatMessages.innerHTML = '';

        if (history.length === 0) {
            clearChat();
        } else {
            // Hide welcome screen
            hideWelcomeScreen();

            history.forEach(msg => {
                if (msg.role === 'system') return;
                addMessage(msg.content, msg.role === 'user');
            });
        }
    } catch (e) {
        console.error("Failed to load chat history:", e);
    }
}

// --- Custom Delete Modal ---

function requestDeleteSession(event, sessionId, element) {
    event.stopPropagation();
    pendingDeleteSessionId = sessionId;
    pendingDeleteElement = element;
    confirmModalOverlay.classList.add('visible');
}

function closeConfirmModal() {
    confirmModalOverlay.classList.remove('visible');
    pendingDeleteSessionId = null;
    pendingDeleteElement = null;
}

async function executeDelete() {
    const sessionId = pendingDeleteSessionId;
    const element = pendingDeleteElement;
    closeConfirmModal();

    if (!sessionId) return;

    // Animate the session item sliding out
    if (element) {
        element.classList.add('deleting');
        await new Promise(resolve => setTimeout(resolve, 350));
    }

    try {
        await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
        if (currentSessionId === sessionId) {
            createNewChat();
        } else {
            loadSessions();
        }
    } catch (e) {
        console.error("Failed to delete session:", e);
    }
}

function createNewChat() {
    currentSessionId = null;
    localStorage.removeItem('currentSessionId');
    clearChat();
    loadSessions();
    closeSidebar();
}

// --- Sidebar helpers ---

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
}

function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('visible');
}

// --- Send Message ---

async function sendMessage(message) {
    if (!message.trim()) return;

    // UI Updates
    addMessage(message, true);
    userInput.value = '';
    userInput.style.height = 'auto';
    userInput.disabled = true;
    sendBtn.disabled = true;

    const typingIndicator = showTypingIndicator();

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                sessionId: currentSessionId
            })
        });

        const data = await res.json().catch(() => ({ error: 'Invalid server response' }));
        typingIndicator.remove();

        if (!res.ok || data.error) {
            addMessage(data.error, false);
        } else {
            addMessage(data.response, false, data.options || []);

            if (!currentSessionId && data.sessionId) {
                currentSessionId = data.sessionId;
                localStorage.setItem('currentSessionId', currentSessionId);
                loadSessions();
            }
        }
    } catch (error) {
        typingIndicator.remove();
        addMessage('Oops! Something went wrong connecting to the server. Please try again. 😅', false);
    } finally {
        userInput.disabled = false;
        sendBtn.disabled = false;
        uploadBtn.disabled = false;
        userInput.focus();
    }
}

// --- File Upload ---

function addImageMessage(file) {
    hideWelcomeScreen();

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', 'user-message');

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content', 'upload-message');

    const isPdf = file.type === 'application/pdf';

    if (isPdf) {
        const pdfIcon = document.createElement('div');
        pdfIcon.classList.add('upload-pdf-icon');
        pdfIcon.textContent = '📑';
        contentDiv.appendChild(pdfIcon);
    } else {
        const imgPreview = document.createElement('img');
        imgPreview.classList.add('upload-preview');
        imgPreview.src = URL.createObjectURL(file);
        imgPreview.alt = 'Registration Card';
        contentDiv.appendChild(imgPreview);
    }

    const fileName = document.createElement('span');
    fileName.classList.add('upload-filename');
    fileName.textContent = `📄 ${file.name}`;

    contentDiv.appendChild(fileName);
    messageDiv.appendChild(contentDiv);

    const timeDiv = document.createElement('div');
    timeDiv.classList.add('message-time');
    timeDiv.textContent = formatTime(new Date());
    messageDiv.appendChild(timeDiv);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function handleFileUpload(file) {
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
        addMessage('Please upload an image (JPEG, PNG, WebP) or PDF of your registration card. 📸', false);
        return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
        addMessage('File is too large. Please upload an image under 10MB. 📏', false);
        return;
    }

    // Show image preview
    addImageMessage(file);

    // Disable inputs
    userInput.disabled = true;
    sendBtn.disabled = true;
    uploadBtn.disabled = true;

    const typingIndicator = showTypingIndicator();

    try {
        const formData = new FormData();
        formData.append('file', file);
        if (currentSessionId) {
            formData.append('sessionId', currentSessionId);
        }

        const res = await fetch('/api/chat/upload', {
            method: 'POST',
            body: formData
        });

        const data = await res.json().catch(() => ({ error: 'Invalid server response' }));
        typingIndicator.remove();

        if (!res.ok || data.error) {
            addMessage(data.error || 'Failed to process the registration card. Please try again. 😅', false);
        } else {
            // Show the validation response from the LLM
            addMessage(data.validationResponse, false, data.options || []);

            if (!currentSessionId && data.sessionId) {
                currentSessionId = data.sessionId;
                localStorage.setItem('currentSessionId', currentSessionId);
                loadSessions();
            }
        }
    } catch (error) {
        typingIndicator.remove();
        addMessage('Oops! Something went wrong processing your registration card. Please try again. 😅', false);
    } finally {
        userInput.disabled = false;
        sendBtn.disabled = false;
        uploadBtn.disabled = false;
        userInput.focus();
        // Reset file input
        fileUploadInput.value = '';
    }
}

// --- Event Listeners ---

newChatBtn.addEventListener('click', createNewChat);

sidebarToggle.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
});

sidebarOverlay.addEventListener('click', closeSidebar);

// Confirm modal events
confirmCancelBtn.addEventListener('click', closeConfirmModal);
confirmDeleteBtn.addEventListener('click', executeDelete);
confirmModalOverlay.addEventListener('click', (e) => {
    if (e.target === confirmModalOverlay) closeConfirmModal();
});

// Escape key closes modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && confirmModalOverlay.classList.contains('visible')) {
        closeConfirmModal();
    }
});

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = userInput.value.trim();
    if (message) sendMessage(message);
});

// Textarea: Enter to send, Shift+Enter for newline
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const message = userInput.value.trim();
        if (message) sendMessage(message);
    }
});

// Auto-resize textarea on input
userInput.addEventListener('input', autoResizeTextarea);

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 &&
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        e.target !== sidebarToggle &&
        e.target !== sidebarOverlay) {
        closeSidebar();
    }
});

// Chip hover glow tracking
document.addEventListener('mousemove', (e) => {
    const chips = document.querySelectorAll('.option-chip');
    chips.forEach(chip => {
        const rect = chip.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        chip.style.setProperty('--mouse-x', x + '%');
        chip.style.setProperty('--mouse-y', y + '%');
    });
});

// --- Initial Load ---

bindWelcomeChips();
bindWelcomeUploadChip();

if (currentSessionId) {
    loadSession(currentSessionId);
} else {
    loadSessions();
}

// --- Upload Button Events ---

uploadBtn.addEventListener('click', () => {
    fileUploadInput.click();
});

fileUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file);
});

// --- Drag and Drop ---

const chatContainer = document.querySelector('.chat-container');

chatContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    chatContainer.classList.add('drag-over');
});

chatContainer.addEventListener('dragleave', (e) => {
    e.preventDefault();
    chatContainer.classList.remove('drag-over');
});

chatContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    chatContainer.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
});
