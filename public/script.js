
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatMessages = document.getElementById('chat-messages');
const sendBtn = document.getElementById('send-btn');
const sessionList = document.getElementById('session-list');
const newChatBtn = document.getElementById('new-chat-btn');

let currentSessionId = localStorage.getItem('currentSessionId') || null;

// --- UI Helpers ---

function addMessage(text, isUser) {
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
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
    chatMessages.innerHTML = `
        <div class="message bot-message">
            <div class="message-content">
                Hello! I am your Academic Registration Advisor. How can I help you today?
            </div>
        </div>
    `;
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
    // (Ideally we find the element by ID, but simple re-render is fine for now)
    loadSessions();

    try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const history = await res.json();

        chatMessages.innerHTML = ''; // Clear current

        if (history.length === 0) {
            clearChat();
        } else {
            history.forEach(msg => {
                // Skip system messages
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
            createNewChat(); // Reset if current deleted
        } else {
            loadSessions(); // Just refresh list
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
}

// --- Event Listeners ---

newChatBtn.addEventListener('click', createNewChat);

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = userInput.value.trim();
    if (!message) return;

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
            addMessage(data.response, false);

            // Setup new session ID if it was null
            if (!currentSessionId && data.sessionId) {
                currentSessionId = data.sessionId;
                localStorage.setItem('currentSessionId', currentSessionId);
                loadSessions(); // Refresh sidebar to show new chat
            }
        }
    } catch (error) {
        typingIndicator.remove();
        addMessage('Error connecting to server.', false);
    } finally {
        userInput.disabled = false;
        sendBtn.disabled = false;
        userInput.focus();
    }
});

// Initial Load
if (currentSessionId) {
    loadSession(currentSessionId);
} else {
    loadSessions();
}
window.deleteSession = deleteSession; // Expose to global scope for onclick
