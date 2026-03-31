/**
 * TPRM Security Assistant – Frontend Application
 * Communicates with the AWS Lambda backend via API Gateway.
 */

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────
  const CONFIG_KEY = 'tprm_api_endpoint';
  let API_ENDPOINT = localStorage.getItem(CONFIG_KEY) || '';

  // ── State ────────────────────────────────────────────────
  let conversationHistory = [];
  let isLoading = false;

  // ── DOM refs ─────────────────────────────────────────────
  const messagesContainer = document.getElementById('messagesContainer');
  const messagesList      = document.getElementById('messagesList');
  const userInput         = document.getElementById('userInput');
  const sendBtn           = document.getElementById('sendBtn');
  const typingIndicator   = document.getElementById('typingIndicator');
  const welcomeState      = document.getElementById('welcomeState');
  const newChatBtn        = document.getElementById('newChatBtn');
  const menuBtn           = document.getElementById('menuBtn');
  const sidebar           = document.querySelector('.sidebar');
  const apiEndpointInput  = document.getElementById('apiEndpoint');
  const saveConfigBtn     = document.getElementById('saveConfig');
  const toast             = document.getElementById('toast');

  // ── Init ─────────────────────────────────────────────────
  apiEndpointInput.value = API_ENDPOINT;

  userInput.addEventListener('input', () => {
    autoResize(userInput);
    sendBtn.disabled = userInput.value.trim() === '' || isLoading;
  });

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);
  newChatBtn.addEventListener('click', clearConversation);
  menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
  saveConfigBtn.addEventListener('click', saveApiConfig);

  // Topic and suggestion buttons (delegated)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-prompt]');
    if (btn) {
      const prompt = btn.dataset.prompt;
      userInput.value = prompt;
      autoResize(userInput);
      sendBtn.disabled = false;
      userInput.focus();
    }
  });

  // Close sidebar when clicking outside on mobile
  messagesContainer.addEventListener('click', () => {
    if (window.innerWidth < 768) sidebar.classList.remove('open');
  });

  // ── Core functions ────────────────────────────────────────

  async function handleSend() {
    const text = userInput.value.trim();
    if (!text || isLoading) return;

    if (!API_ENDPOINT) {
      showToast('Please configure the API endpoint in the sidebar.', 'error');
      apiEndpointInput.focus();
      return;
    }

    hideWelcome();
    appendMessage('user', text);
    conversationHistory.push({ role: 'user', content: text });

    userInput.value = '';
    autoResize(userInput);
    sendBtn.disabled = true;
    setLoading(true);

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversationHistory }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data.error || `HTTP ${response.status}`;
        appendMessage('assistant', errMsg, true);
        // Don't add error to conversation history
        return;
      }

      const assistantContent = data.content;
      conversationHistory.push({ role: 'assistant', content: assistantContent });
      appendMessage('assistant', assistantContent);

    } catch (err) {
      appendMessage('assistant', `Network error: ${err.message}. Please check the API endpoint and CORS configuration.`, true);
    } finally {
      setLoading(false);
      sendBtn.disabled = userInput.value.trim() === '';
      scrollToBottom();
    }
  }

  function appendMessage(role, content, isError = false) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}-message`;

    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${role}-avatar`;
    avatar.innerHTML = role === 'user'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

    const body = document.createElement('div');
    body.className = 'message-body';

    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = role === 'user' ? 'You' : 'TPRM Assistant';

    const contentEl = document.createElement('div');
    contentEl.className = `message-content${isError ? ' error' : ''}`;
    contentEl.innerHTML = isError ? escapeHtml(content) : renderMarkdown(content);

    body.appendChild(roleLabel);
    body.appendChild(contentEl);
    messageEl.appendChild(avatar);
    messageEl.appendChild(body);
    messagesList.appendChild(messageEl);
    scrollToBottom();
  }

  function setLoading(loading) {
    isLoading = loading;
    typingIndicator.classList.toggle('hidden', !loading);
    if (loading) scrollToBottom();
  }

  function hideWelcome() {
    if (welcomeState) welcomeState.style.display = 'none';
  }

  function clearConversation() {
    conversationHistory = [];
    messagesList.innerHTML = '';
    if (welcomeState) welcomeState.style.display = '';
    userInput.value = '';
    autoResize(userInput);
    sendBtn.disabled = true;
  }

  function saveApiConfig() {
    const val = apiEndpointInput.value.trim();
    if (!val) {
      showToast('Please enter an API endpoint URL.', 'error');
      return;
    }
    API_ENDPOINT = val;
    localStorage.setItem(CONFIG_KEY, val);
    showToast('API endpoint saved.', 'success');
  }

  // ── Helpers ───────────────────────────────────────────────

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  let toastTimer = null;
  function showToast(msg, type = '') {
    toast.textContent = msg;
    toast.className = `toast${type ? ' ' + type : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast hidden'; }, 3500);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Minimal Markdown renderer (no external deps).
   * Handles: headings, bold, italic, code blocks, inline code,
   * unordered/ordered lists, blockquotes, horizontal rules, tables, paragraphs.
   */
  function renderMarkdown(text) {
    // Escape HTML first, then selectively unescape for markdown constructs
    let html = text;

    // Code blocks (fenced)
    html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
      `<pre><code>${escapeHtml(code.trim())}</code></pre>`
    );

    // Inline code
    html = html.replace(/`([^`\n]+)`/g, (_, code) =>
      `<code>${escapeHtml(code)}</code>`
    );

    // Headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Horizontal rule
    html = html.replace(/^---+$/gm, '<hr>');

    // Blockquote
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Bold & italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Tables (basic)
    html = html.replace(/(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)*)/g, (match) => {
      const lines = match.trim().split('\n').filter(l => l.trim());
      if (lines.length < 2) return match;
      const headers = lines[0].split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const rows = lines.slice(2).map(line => {
        const cells = line.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    });

    // Unordered lists
    html = html.replace(/((?:^[-*+] .+\n?)+)/gm, (match) => {
      const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[-*+] /, '').trim()}</li>`).join('');
      return `<ul>${items}</ul>`;
    });

    // Ordered lists
    html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (match) => {
      const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '').trim()}</li>`).join('');
      return `<ol>${items}</ol>`;
    });

    // Paragraphs (wrap lines not already in block tags)
    html = html.replace(/^(?!<[hupobtr]|<\/|$)(.+)$/gm, '<p>$1</p>');

    // Clean up consecutive empty lines
    html = html.replace(/\n{3,}/g, '\n\n');

    return html;
  }
})();
