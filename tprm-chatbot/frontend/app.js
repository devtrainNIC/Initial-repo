/**
 * TPRM Security Assistant – Frontend Application
 *
 * Handles:
 *  - Multi-turn chat with citation display (sources from Bedrock KB)
 *  - Document upload (presigned S3 POST via /upload-url)
 *  - Document listing and deletion (via /documents)
 *  - Drag-and-drop file upload UI
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  const CONFIG_KEY = 'tprm_api_base';
  let API_BASE = localStorage.getItem(CONFIG_KEY) || '';  // e.g. https://xxx.execute-api.../prod

  const API = {
    chat:      () => `${API_BASE}/chat`,
    uploadUrl: (filename, contentType) =>
      `${API_BASE}/upload-url?filename=${encodeURIComponent(filename)}&content_type=${encodeURIComponent(contentType)}`,
    documents: () => `${API_BASE}/documents`,
    deleteDoc: (key) => `${API_BASE}/documents?key=${encodeURIComponent(key)}`,
  };

  // ── State ────────────────────────────────────────────────────────────────────
  let conversationHistory = [];
  let isLoading = false;
  let uploadQueue = [];

  // ── DOM ──────────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const messagesContainer = $('messagesContainer');
  const messagesList      = $('messagesList');
  const userInput         = $('userInput');
  const sendBtn           = $('sendBtn');
  const typingIndicator   = $('typingIndicator');
  const welcomeState      = $('welcomeState');
  const newChatBtn        = $('newChatBtn');
  const menuBtn           = $('menuBtn');
  const sidebar           = $('sidebar');
  const apiEndpointInput  = $('apiEndpoint');
  const saveConfigBtn     = $('saveConfig');
  const toast             = $('toast');
  const kbBadge           = $('kbBadge');
  const kbStatusNote      = $('kbStatusNote');
  const kbStatusText      = $('kbStatusText');
  const docCountBadge     = $('docCountBadge');
  const dropZone          = $('dropZone');
  const fileInput         = $('fileInput');
  const uploadQueueEl     = $('uploadQueue');
  const docList           = $('docList');
  const refreshDocsBtn    = $('refreshDocsBtn');

  // ── Init ─────────────────────────────────────────────────────────────────────
  apiEndpointInput.value = API_BASE;

  // Chat input
  userInput.addEventListener('input', () => {
    autoResize(userInput);
    sendBtn.disabled = !userInput.value.trim() || isLoading;
  });
  userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) handleSend(); }
  });
  sendBtn.addEventListener('click', handleSend);
  newChatBtn.addEventListener('click', clearConversation);

  // Sidebar toggle
  menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
  messagesContainer.addEventListener('click', () => {
    if (window.innerWidth < 768) sidebar.classList.remove('open');
  });

  // Config save
  saveConfigBtn.addEventListener('click', saveApiConfig);

  // Tab switching
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Topic / suggestion quick-prompts
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-prompt]');
    if (btn) {
      userInput.value = btn.dataset.prompt;
      autoResize(userInput);
      sendBtn.disabled = false;
      // Switch to chat view if on mobile
      switchTab('chat');
      userInput.focus();
    }
  });

  // Drag & drop
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener('change', () => {
    handleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  refreshDocsBtn.addEventListener('click', loadDocuments);

  // Auto-load docs if API is configured
  if (API_BASE) loadDocuments();

  // ── Tab switching ────────────────────────────────────────────────────────────
  function switchTab(tab) {
    document.querySelectorAll('.sidebar-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab)
    );
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === `panel${capitalize(tab)}`)
    );
    if (tab === 'docs') loadDocuments();
  }

  // ── Chat ─────────────────────────────────────────────────────────────────────
  async function handleSend() {
    const text = userInput.value.trim();
    if (!text || isLoading) return;
    if (!API_BASE) { showToast('Set the API Base URL in sidebar config first.', 'error'); return; }

    hideWelcome();
    appendUserMessage(text);
    conversationHistory.push({ role: 'user', content: text });

    userInput.value = '';
    autoResize(userInput);
    sendBtn.disabled = true;
    setLoading(true);

    try {
      const res  = await fetch(API.chat(), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: conversationHistory }),
      });
      const data = await res.json();

      if (!res.ok) {
        appendAssistantMessage(data.error || `HTTP ${res.status}`, [], true);
        return;
      }

      conversationHistory.push({ role: 'assistant', content: data.content });
      appendAssistantMessage(data.content, data.sources || []);

      // Show KB badge if this response used the knowledge base
      if (data.kb_enabled) {
        kbBadge.classList.remove('hidden');
        kbStatusNote.style.display = 'flex';
        kbStatusText.textContent =
          data.sources && data.sources.length
            ? `Answered using ${data.sources.length} document excerpt(s) from your knowledge base.`
            : 'Knowledge base active – no matching excerpts found for this question.';
      }

    } catch (err) {
      appendAssistantMessage(`Network error: ${err.message}`, [], true);
    } finally {
      setLoading(false);
      sendBtn.disabled = !userInput.value.trim();
      scrollToBottom();
    }
  }

  function appendUserMessage(text) {
    const el = buildMessageEl('user', text, []);
    messagesList.appendChild(el);
    scrollToBottom();
  }

  function appendAssistantMessage(content, sources, isError = false) {
    const el = buildMessageEl('assistant', content, sources, isError);
    messagesList.appendChild(el);
    scrollToBottom();
  }

  function buildMessageEl(role, content, sources, isError = false) {
    const wrap = document.createElement('div');
    wrap.className = `message ${role}-message`;

    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${role}-avatar`;
    avatar.innerHTML = role === 'user'
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

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

    // Source citations
    if (sources && sources.length) {
      const citEl = document.createElement('div');
      citEl.className = 'citations';
      citEl.innerHTML = '<span class="citations-label">Sources</span>' +
        sources.map(s =>
          `<span class="citation-chip" title="Relevance: ${s.score}">${escapeHtml(s.filename)}</span>`
        ).join('');
      body.appendChild(citEl);
    }

    wrap.appendChild(avatar);
    wrap.appendChild(body);
    return wrap;
  }

  function setLoading(v) {
    isLoading = v;
    typingIndicator.classList.toggle('hidden', !v);
    if (v) scrollToBottom();
  }

  function hideWelcome() {
    if (welcomeState) welcomeState.style.display = 'none';
  }

  function clearConversation() {
    conversationHistory = [];
    messagesList.innerHTML = '';
    if (welcomeState) welcomeState.style.display = '';
    kbBadge.classList.add('hidden');
    userInput.value = '';
    autoResize(userInput);
    sendBtn.disabled = true;
  }

  // ── Document upload ──────────────────────────────────────────────────────────
  const ALLOWED_EXT = new Set(['.pdf','.docx','.doc','.txt','.csv','.html','.htm','.md']);
  const EXT_MIME = {
    '.pdf':  'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc':  'application/msword',
    '.txt':  'text/plain',
    '.csv':  'text/csv',
    '.html': 'text/html',
    '.htm':  'text/html',
    '.md':   'text/markdown',
  };

  function getExt(name) {
    const m = name.match(/\.[^.]+$/);
    return m ? m[0].toLowerCase() : '';
  }

  function handleFiles(files) {
    if (!API_BASE) { showToast('Set the API Base URL first.', 'error'); return; }
    const valid = files.filter(f => {
      const ext = getExt(f.name);
      if (!ALLOWED_EXT.has(ext)) { showToast(`${f.name}: unsupported type`, 'error'); return false; }
      if (f.size > 50 * 1024 * 1024) { showToast(`${f.name}: exceeds 50 MB limit`, 'error'); return false; }
      return true;
    });
    if (!valid.length) return;

    uploadQueueEl.classList.remove('hidden');
    valid.forEach(file => uploadFile(file));
  }

  async function uploadFile(file) {
    const ext      = getExt(file.name);
    const mimeType = EXT_MIME[ext] || 'application/octet-stream';
    const itemId   = 'uq-' + Date.now() + '-' + Math.random().toString(36).slice(2);

    // Add item to queue UI
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.id = itemId;
    item.innerHTML = `
      <div class="upload-item-info">
        <span class="upload-item-name">${escapeHtml(file.name)}</span>
        <span class="upload-item-size">${humanSize(file.size)}</span>
      </div>
      <div class="upload-progress-bar"><div class="upload-progress-fill" style="width:0%"></div></div>
      <span class="upload-status pending">Preparing…</span>`;
    uploadQueueEl.appendChild(item);

    const fill   = item.querySelector('.upload-progress-fill');
    const status = item.querySelector('.upload-status');

    const setStatus = (text, cls) => {
      status.textContent = text;
      status.className = `upload-status ${cls}`;
    };
    const setProgress = (pct) => { fill.style.width = pct + '%'; };

    try {
      // 1. Get presigned POST URL from backend
      setStatus('Getting upload URL…', 'pending');
      const urlRes  = await fetch(API.uploadUrl(file.name, mimeType));
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Failed to get upload URL');

      const { url, fields, key } = urlData;

      // 2. POST directly to S3 using presigned POST fields
      setStatus('Uploading…', 'pending');
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);  // file must be last

      await uploadWithProgress(url, formData, pct => setProgress(pct));

      setProgress(100);
      setStatus(`Uploaded → ${key.split('/')[0]}/`, 'success');

      // 3. Refresh document list after a short delay (indexing is async)
      setTimeout(loadDocuments, 1500);
      showToast(`${file.name} uploaded. Indexing in progress…`, 'success');

    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
      showToast(`Upload failed: ${err.message}`, 'error');
    }

    // Remove from queue UI after a few seconds
    setTimeout(() => item.remove(), 8000);
  }

  function uploadWithProgress(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`S3 upload failed: HTTP ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
      xhr.send(formData);
    });
  }

  // ── Document listing ─────────────────────────────────────────────────────────
  async function loadDocuments() {
    if (!API_BASE) return;
    docList.innerHTML = '<p class="doc-empty">Loading…</p>';
    try {
      const res  = await fetch(API.documents());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load documents');
      renderDocList(data.documents || []);
    } catch (err) {
      docList.innerHTML = `<p class="doc-empty error">Error: ${escapeHtml(err.message)}</p>`;
    }
  }

  function renderDocList(docs) {
    // Update badge
    if (docs.length > 0) {
      docCountBadge.textContent = docs.length;
      docCountBadge.classList.remove('hidden');
    } else {
      docCountBadge.classList.add('hidden');
    }

    if (!docs.length) {
      docList.innerHTML = '<p class="doc-empty">No documents yet. Upload your SOC 2 reports, policies, and questionnaires above.</p>';
      return;
    }

    // Group by folder
    const groups = {};
    docs.forEach(d => {
      const g = d.folder || 'other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(d);
    });

    docList.innerHTML = '';
    Object.entries(groups).forEach(([folder, items]) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'doc-group';
      groupEl.innerHTML = `<div class="doc-group-header"><span class="folder-chip ${folder}">${folder}/</span><span class="doc-group-count">${items.length}</span></div>`;
      items.forEach(doc => {
        const row = document.createElement('div');
        row.className = 'doc-row';
        row.innerHTML = `
          <div class="doc-row-info">
            <span class="doc-icon">${extIcon(doc.extension)}</span>
            <div>
              <span class="doc-name" title="${escapeHtml(doc.key)}">${escapeHtml(doc.filename)}</span>
              <span class="doc-meta">${doc.size_human} · ${doc.last_modified}</span>
            </div>
          </div>
          <button class="icon-btn delete-btn" data-key="${escapeHtml(doc.key)}" title="Delete">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>`;
        row.querySelector('.delete-btn').addEventListener('click', () => deleteDocument(doc.key, doc.filename));
        groupEl.appendChild(row);
      });
      docList.appendChild(groupEl);
    });
  }

  async function deleteDocument(key, filename) {
    if (!confirm(`Delete "${filename}"?\nThis will also remove it from the knowledge base on next sync.`)) return;
    try {
      const res  = await fetch(API.deleteDoc(key), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      showToast(`Deleted: ${filename}`, 'success');
      loadDocuments();
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  function extIcon(ext) {
    const icons = {
      '.pdf':  '📄', '.docx': '📝', '.doc': '📝',
      '.txt':  '📃', '.csv':  '📊', '.html': '🌐',
      '.htm':  '🌐', '.md':   '📋',
    };
    return icons[ext] || '📄';
  }

  // ── Config ───────────────────────────────────────────────────────────────────
  function saveApiConfig() {
    const val = apiEndpointInput.value.trim().replace(/\/$/, '');
    if (!val) { showToast('Enter a valid API base URL.', 'error'); return; }
    API_BASE = val;
    localStorage.setItem(CONFIG_KEY, val);
    showToast('API base URL saved.', 'success');
    loadDocuments();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function scrollToBottom() {
    requestAnimationFrame(() => { messagesContainer.scrollTop = messagesContainer.scrollHeight; });
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function humanSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  let toastTimer = null;
  function showToast(msg, type = '') {
    toast.textContent = msg;
    toast.className = `toast${type ? ' ' + type : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast hidden'; }, 4000);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /**
   * Minimal Markdown renderer – no external dependencies.
   * Handles: headings, bold/italic, code blocks, inline code, lists,
   *          blockquotes, tables, horizontal rules, paragraphs.
   */
  function renderMarkdown(text) {
    let html = text;

    // Fenced code blocks
    html = html.replace(/```[\w]*\n?([\s\S]*?)```/g,
      (_, code) => `<pre><code>${escapeHtml(code.trim())}</code></pre>`);

    // Inline code
    html = html.replace(/`([^`\n]+)`/g,
      (_, code) => `<code>${escapeHtml(code)}</code>`);

    // Headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

    // HR
    html = html.replace(/^---+$/gm, '<hr>');

    // Blockquote
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Bold+italic, bold, italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g,      '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g,           '<em>$1</em>');

    // Tables
    html = html.replace(/(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)*)/g, match => {
      const lines = match.trim().split('\n').filter(l => l.trim());
      if (lines.length < 2) return match;
      const heads = lines[0].split('|').filter(c => c.trim())
        .map(c => `<th>${c.trim()}</th>`).join('');
      const rows = lines.slice(2).map(line =>
        `<tr>${line.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('')}</tr>`
      ).join('');
      return `<table><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>`;
    });

    // Unordered lists
    html = html.replace(/((?:^[-*+] .+\n?)+)/gm, match => {
      const items = match.trim().split('\n')
        .map(l => `<li>${l.replace(/^[-*+] /, '').trim()}</li>`).join('');
      return `<ul>${items}</ul>`;
    });

    // Ordered lists
    html = html.replace(/((?:^\d+\. .+\n?)+)/gm, match => {
      const items = match.trim().split('\n')
        .map(l => `<li>${l.replace(/^\d+\. /, '').trim()}</li>`).join('');
      return `<ol>${items}</ol>`;
    });

    // Paragraphs
    html = html.replace(/^(?!<[hupobtr]|<\/|$)(.+)$/gm, '<p>$1</p>');

    return html;
  }
})();
