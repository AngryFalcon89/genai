
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatMessages = document.getElementById('chat-messages');
const sendBtn = document.getElementById('send-btn');
const sessionList = document.getElementById('session-list');
const newChatBtn = document.getElementById('new-chat-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const welcomeScreen = document.getElementById('welcome-screen');

let currentSessionId = localStorage.getItem('currentSessionId') || null;

// --- UI Helpers ---

function addMessage(text, isUser, options = []) {
    // Hide welcome screen when first message appears
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(isUser ? 'user-message' : 'bot-message');

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');

    if (isUser) {
        contentDiv.textContent = text;
    } else {
        contentDiv.innerHTML = marked.parse(text);
    }

    messageDiv.appendChild(contentDiv);

    // Add option chips if provided (only for bot messages)
    if (!isUser && options.length > 0) {
        const optionsDiv = createOptionChips(options);
        contentDiv.appendChild(optionsDiv);
    }

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
                c.style.opacity = '0.5';
                c.style.cursor = 'default';
            });
            // Highlight the selected chip
            chip.style.opacity = '1';
            chip.style.background = 'var(--primary-light)';
            chip.style.borderColor = 'var(--primary-color)';
            chip.style.color = 'var(--primary-color)';
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
            </div>
        </div>
    `;
    chatMessages.appendChild(welcome);
    bindWelcomeChips();
}

function bindWelcomeChips() {
    document.querySelectorAll('#welcome-chips .option-chip, #welcome-screen .option-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const message = chip.getAttribute('data-message');
            if (message) sendMessage(message);
        });
    });
}

// --- Session Logic ---

async function loadSessions() {
    try {
        const res = await fetch('/api/sessions');
        const sessions = await res.json();

        sessionList.innerHTML = '';
        sessions.forEach(session => {
            const div = document.createElement('div');
            div.className = `session-item ${session.id === currentSessionId ? 'active' : ''}`;
            div.innerHTML = `
                <span>${session.title}</span>
                <button class="delete-session-btn" onclick="deleteSession(event, '${session.id}')">&times;</button>
            `;
            div.onclick = (e) => {
                if (e.target.classList.contains('delete-session-btn')) return;
                loadSession(session.id);
            };
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
    sidebar.classList.remove('open');

    try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const history = await res.json();

        chatMessages.innerHTML = '';

        if (history.length === 0) {
            clearChat();
        } else {
            // Hide welcome screen
            if (welcomeScreen) welcomeScreen.style.display = 'none';
            const ws = document.getElementById('welcome-screen');
            if (ws) ws.style.display = 'none';

            history.forEach(msg => {
                if (msg.role === 'system') return;
                addMessage(msg.content, msg.role === 'user');
            });
        }
    } catch (e) {
        console.error("Failed to load chat history:", e);
    }
}

async function deleteSession(event, sessionId) {
    event.stopPropagation();
    if (!confirm('Delete this chat?')) return;

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
    sidebar.classList.remove('open');
}

// --- Send Message ---

async function sendMessage(message) {
    if (!message.trim()) return;

    // UI Updates
    addMessage(message, true);
    userInput.value = '';
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

        const data = await res.json();
        typingIndicator.remove();

        if (data.error) {
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
        userInput.focus();
    }
}

// --- Event Listeners ---

newChatBtn.addEventListener('click', createNewChat);

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
});

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = userInput.value.trim();
    if (message) sendMessage(message);
});

// Allow Shift+Enter for newlines (future textarea upgrade)
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        // Default submit behavior via form
    }
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 &&
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        e.target !== sidebarToggle) {
        sidebar.classList.remove('open');
    }
});

// --- Initial Load ---

bindWelcomeChips();

if (currentSessionId) {
    loadSession(currentSessionId);
} else {
    loadSessions();
}

window.deleteSession = deleteSession;
