// @ts-nocheck
(function () {
    const vscode = acquireVsCodeApi();

    const chatContainer = document.getElementById('chat-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const clearBtn = document.getElementById('clear-btn');
    const ragBtn = document.getElementById('rag-btn');
    const terminalBtn = document.getElementById('terminal-btn');
    const micBtn = document.getElementById('mic-btn');
    const fileInput = document.getElementById('file-input');
    const attachBtn = document.getElementById('attach-btn');
    const previewAttachments = document.getElementById('preview-attachments');
    const atSuggestionsMenu = document.getElementById('at-suggestions-menu');

    let attachedImages = [];
    let recognition = null;
    let isRecording = false;
    let currentUtterance = null;
    let currentStreamingBubble = null;
    let currentStreamingContent = '';
    let atSuggestions = [];
    let selectedSuggestionIdx = 0;

    // 1. Audio Nativo: Speech-to-Text (STT)
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            micBtn.style.display = 'none';
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'es-ES';
        recognition.continuous = true;
        recognition.interimResults = true;

        let finalTranscript = '';

        recognition.onstart = () => {
            isRecording = true;
            micBtn.classList.add('active-mic');
            micBtn.title = 'Escuchando... Haz clic para detener el dictado.';
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript + ' ';
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            messageInput.value = (finalTranscript + interimTranscript).trim();
            autoResizeTextarea();
        };

        recognition.onerror = () => stopSpeechRecognition();
        recognition.onend = () => stopSpeechRecognition();
    }

    function toggleSpeechRecognition() {
        if (!recognition) initSpeechRecognition();
        if (!recognition) return;

        if (isRecording) {
            recognition.stop();
        } else {
            try {
                recognition.start();
            } catch (err) {
                console.error('Error iniciando STT:', err);
            }
        }
    }

    function stopSpeechRecognition() {
        isRecording = false;
        micBtn.classList.remove('active-mic');
        micBtn.title = 'Dictado por voz (Español)';
    }

    // 2. Audio Nativo: Text-to-Speech (TTS)
    function speakText(text, btnElement) {
        if (!window.speechSynthesis) return;

        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            if (btnElement) btnElement.classList.remove('tts-speaking');
            return;
        }

        const cleanText = text
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .replace(/```[\s\S]*?```/g, ' [Fragmento de código omitido] ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/[*#_>-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!cleanText) return;

        currentUtterance = new SpeechSynthesisUtterance(cleanText);
        currentUtterance.lang = 'es-ES';
        currentUtterance.rate = 1.05;

        const voices = window.speechSynthesis.getVoices();
        const spanishVoice = voices.find(v => v.lang.startsWith('es'));
        if (spanishVoice) {
            currentUtterance.voice = spanishVoice;
        }

        if (btnElement) btnElement.classList.add('tts-speaking');

        currentUtterance.onend = () => {
            if (btnElement) btnElement.classList.remove('tts-speaking');
        };

        currentUtterance.onerror = () => {
            if (btnElement) btnElement.classList.remove('tts-speaking');
        };

        window.speechSynthesis.speak(currentUtterance);
    }

    // 3. Manejo de Imágenes Adjuntas
    function handleImageFiles(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                attachedImages.push(e.target.result);
                renderAttachmentPreviews();
            };
            reader.readAsDataURL(file);
        });
    }

    function renderAttachmentPreviews() {
        previewAttachments.innerHTML = '';
        attachedImages.forEach((imgBase64, idx) => {
            const chip = document.createElement('div');
            chip.className = 'preview-chip';
            chip.innerHTML = `
                <img src="${imgBase64}" alt="Adjunto ${idx + 1}" />
                <button class="remove-chip" title="Eliminar">&times;</button>
            `;
            chip.querySelector('.remove-chip').addEventListener('click', () => {
                attachedImages.splice(idx, 1);
                renderAttachmentPreviews();
            });
            previewAttachments.appendChild(chip);
        });
    }

    // 4. Formateador con soporte para <think> de DeepSeek R1, Markdown y bloques de código
    function formatMessageContent(rawText) {
        if (!rawText) return '';

        let text = rawText;

        // Procesar bloques <think>...</think> completos o en progreso durante streaming
        text = text.replace(/<think>([\s\S]*?)<\/think>/g, (match, thought) => {
            return `###THINK_START###${thought.trim()}###THINK_END###`;
        });

        if (text.includes('<think>') && !text.includes('###THINK_END###')) {
            text = text.replace(/<think>([\s\S]*)/g, (match, thought) => {
                return `###THINK_START###${thought.trim()}###THINK_END###`;
            });
        }

        let escaped = escapeHtml(text);

        // Renderizar acordeón desplegable para <think>
        escaped = escaped.replace(/###THINK_START###([\s\S]*?)###THINK_END###/g, (match, thought) => {
            return `<details class="think-accordion" open>
                <summary>🧠 Cadena de Razonamiento (DeepSeek R1)</summary>
                <div class="think-content">${thought.replace(/\n/g, '<br/>')}</div>
            </details>`;
        });

        // Formatear bloques de código ```...```
        escaped = escaped.replace(/```([a-zA-Z]*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
            return `<div class="code-block-wrapper">${langLabel}<pre><code>${code}</code></pre></div>`;
        });

        // Código inline `...`
        escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

        // MEJORA: Soporte básico de Markdown para los mensajes del agente
        // Headers H1, H2, H3
        escaped = escaped.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        escaped = escaped.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        escaped = escaped.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Negritas **texto** y __texto__
        escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        escaped = escaped.replace(/__([^_]+)__/g, '<strong>$1</strong>');

        // Itálicas *texto* y _texto_
        escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        escaped = escaped.replace(/_([^_]+)_/g, '<em>$1</em>');

        // Listas con viñetas (- item o * item)
        escaped = escaped.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
        escaped = escaped.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

        // Listas numeradas (1. item)
        escaped = escaped.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

        // Saltos de línea solo donde no hay bloques HTML
        escaped = escaped.replace(/(?<!>)\n(?!<)/g, '<br/>');

        return escaped;
    }

    // 5. Renderizado de Mensajes en el Chat
    function appendMessage(role, content, model, images) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${role}`;

        let headerHtml = '';
        if (role === 'agent') {
            let modelBadgeClass = 'qwen';
            let modelLabel = model || 'Qwen Coder';
            if (modelLabel.toLowerCase().includes('deepseek')) {
                modelBadgeClass = 'deepseek';
            } else if (modelLabel.toLowerCase().includes('vision') || modelLabel.toLowerCase().includes('llama')) {
                modelBadgeClass = 'vision';
            }

            headerHtml = `
                <div class="message-header">
                    <span class="model-badge ${modelBadgeClass}">🤖 ${modelLabel}</span>
                    <button class="btn-icon tts-btn" title="Escuchar respuesta">🔊</button>
                </div>
            `;
        } else if (role === 'user') {
            headerHtml = `<div class="message-header"><span style="opacity:0.7">Tú</span></div>`;
        }

        let imagesHtml = '';
        if (images && images.length > 0) {
            imagesHtml = '<div class="message-images">';
            images.forEach(img => {
                imagesHtml += `<img class="attached-img-preview" src="${img.startsWith('data:') ? img : 'data:image/png;base64,' + img}" />`;
            });
            imagesHtml += '</div>';
        }

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = `${imagesHtml}${formatMessageContent(content)}`;

        wrapper.innerHTML = headerHtml;
        wrapper.appendChild(bubble);

        const ttsBtn = wrapper.querySelector('.tts-btn');
        if (ttsBtn) {
            ttsBtn.addEventListener('click', () => speakText(content, ttsBtn));
        }

        chatContainer.appendChild(wrapper);
        scrollToBottom();
    }

    // 6. Streaming Token-by-Token
    function handleStreamStart(model) {
        currentStreamingContent = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper agent';

        let modelBadgeClass = 'qwen';
        let modelLabel = model || 'Qwen Coder';
        if (modelLabel.toLowerCase().includes('deepseek')) {
            modelBadgeClass = 'deepseek';
        } else if (modelLabel.toLowerCase().includes('vision') || modelLabel.toLowerCase().includes('llama')) {
            modelBadgeClass = 'vision';
        }

        wrapper.innerHTML = `
            <div class="message-header">
                <span class="model-badge ${modelBadgeClass}">🤖 ${modelLabel}</span>
                <button class="btn-icon tts-btn" title="Escuchar respuesta" style="display:none;">🔊</button>
            </div>
            <div class="message-bubble streaming-cursor"></div>
        `;

        currentStreamingBubble = wrapper.querySelector('.message-bubble');
        chatContainer.appendChild(wrapper);
        scrollToBottom();
    }

    function handleStreamToken(token) {
        currentStreamingContent += token;
        if (currentStreamingBubble) {
            currentStreamingBubble.innerHTML = formatMessageContent(currentStreamingContent);
            scrollToBottom();
        }
    }

    function handleStreamEnd(finalContent, toolCalls) {
        if (currentStreamingBubble) {
            currentStreamingBubble.classList.remove('streaming-cursor');
            const hasTools = (toolCalls && toolCalls.length > 0);
            const fullText = (typeof finalContent === 'string') ? finalContent : currentStreamingContent;

            if (!fullText.trim() && hasTools) {
                const wrapper = currentStreamingBubble.closest('.message-wrapper');
                if (wrapper) {
                    wrapper.remove();
                }
            } else {
                currentStreamingBubble.innerHTML = formatMessageContent(fullText);
                const ttsBtn = currentStreamingBubble.parentElement?.querySelector('.tts-btn');
                if (ttsBtn && fullText.trim()) {
                    ttsBtn.style.display = 'inline-flex';
                    ttsBtn.addEventListener('click', () => speakText(fullText, ttsBtn));
                }
            }
        }
        currentStreamingBubble = null;
        currentStreamingContent = '';
        scrollToBottom();
    }

    // 7. Badges de Herramientas y Diffs
    function appendToolBadge(toolName, status, message, args) {
        const card = document.createElement('div');
        card.className = 'tool-badge-card';

        let tagText = status.toUpperCase();
        let icon = status === 'running' ? '⏳' : (status === 'success' ? '✅' : '❌');

        card.innerHTML = `
            <div class="tool-badge-header">
                <span><strong>${icon} ${toolName}</strong></span>
                <span class="badge-tag ${status}">${tagText}</span>
            </div>
            <div class="tool-details" style="display: ${status === 'running' ? 'block' : 'none'};">
                ${args ? `<strong>Args:</strong> ${JSON.stringify(args, null, 2)}\n\n` : ''}<strong>Salida:</strong> ${escapeHtml(message)}
            </div>
        `;

        card.querySelector('.tool-badge-header').addEventListener('click', () => {
            const details = card.querySelector('.tool-details');
            details.style.display = details.style.display === 'none' ? 'block' : 'none';
        });

        chatContainer.appendChild(card);
        scrollToBottom();
    }

    function appendDiffPreview(filePath, oldText, newText) {
        const container = document.createElement('div');
        container.className = 'diff-container';
        container.innerHTML = `
            <div class="diff-header">
                <span>📝 Modificación: ${escapeHtml(filePath)}</span>
                <button class="btn-icon open-diff-btn" title="Abrir pestaña nativa de diferencias">🔍 Ver Diff Nativo</button>
            </div>
            <div class="diff-body">
                <div class="diff-del">- ${escapeHtml(oldText)}</div>
                <div class="diff-add">+ ${escapeHtml(newText)}</div>
            </div>
        `;

        container.querySelector('.open-diff-btn').addEventListener('click', () => {
            vscode.postMessage({
                type: 'openNativeDiff',
                filePath: filePath,
                oldText: oldText,
                newText: newText
            });
        });

        chatContainer.appendChild(container);
        scrollToBottom();
    }

    // 8. Autocompletado con @
    function checkForAtMention() {
        const val = messageInput.value;
        const cursor = messageInput.selectionStart;
        const textBeforeCursor = val.slice(0, cursor);
        const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_\-\.\/]*)$/);

        if (atMatch) {
            const query = atMatch[1];
            vscode.postMessage({
                type: 'requestAtSuggestions',
                query: query
            });
        } else {
            hideAtMenu();
        }
    }

    function renderAtMenu(items) {
        atSuggestions = items;
        selectedSuggestionIdx = 0;

        if (!items || items.length === 0) {
            hideAtMenu();
            return;
        }

        atSuggestionsMenu.innerHTML = '';
        items.forEach((item, idx) => {
            const el = document.createElement('div');
            el.className = `suggestion-item ${idx === 0 ? 'active' : ''}`;
            el.innerHTML = `
                <span class="suggestion-label">${escapeHtml(item.label)}</span>
                <span class="suggestion-detail">${escapeHtml(item.detail)}</span>
            `;
            el.addEventListener('click', () => applyAtSuggestion(item));
            atSuggestionsMenu.appendChild(el);
        });

        atSuggestionsMenu.style.display = 'block';
    }

    function hideAtMenu() {
        atSuggestionsMenu.style.display = 'none';
        atSuggestions = [];
    }

    function applyAtSuggestion(item) {
        const val = messageInput.value;
        const cursor = messageInput.selectionStart;
        const textBeforeCursor = val.slice(0, cursor);
        const textAfterCursor = val.slice(cursor);

        const newTextBefore = textBeforeCursor.replace(/@[a-zA-Z0-9_\-\.\/]*$/, item.insertText + ' ');
        messageInput.value = newTextBefore + textAfterCursor;
        hideAtMenu();
        messageInput.focus();
        autoResizeTextarea();
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function autoResizeTextarea() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    function sendMessage() {
        const text = messageInput.value.trim();
        if (!text && attachedImages.length === 0) return;

        const payloadImages = [...attachedImages];

        vscode.postMessage({
            type: 'sendMessage',
            value: text,
            images: payloadImages
        });

        messageInput.value = '';
        attachedImages = [];
        hideAtMenu();
        renderAttachmentPreviews();
        autoResizeTextarea();

        if (isRecording) stopSpeechRecognition();
    }

    // 9. Event Listeners de UI
    sendBtn.addEventListener('click', sendMessage);

    messageInput.addEventListener('keydown', (e) => {
        if (atSuggestionsMenu.style.display === 'block' && atSuggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedSuggestionIdx = (selectedSuggestionIdx + 1) % atSuggestions.length;
                updateSelectedSuggestion();
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedSuggestionIdx = (selectedSuggestionIdx - 1 + atSuggestions.length) % atSuggestions.length;
                updateSelectedSuggestion();
                return;
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                applyAtSuggestion(atSuggestions[selectedSuggestionIdx]);
                return;
            } else if (e.key === 'Escape') {
                hideAtMenu();
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    function updateSelectedSuggestion() {
        const items = atSuggestionsMenu.querySelectorAll('.suggestion-item');
        items.forEach((el, idx) => {
            el.classList.toggle('active', idx === selectedSuggestionIdx);
            if (idx === selectedSuggestionIdx) {
                el.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    messageInput.addEventListener('input', () => {
        autoResizeTextarea();
        checkForAtMention();
    });

    clearBtn.addEventListener('click', () => vscode.postMessage({ type: 'clearChat' }));
    ragBtn.addEventListener('click', () => vscode.postMessage({ type: 'indexWorkspace' }));
    terminalBtn.addEventListener('click', () => vscode.postMessage({ type: 'analyzeTerminal' }));
    micBtn.addEventListener('click', toggleSpeechRecognition);
    attachBtn.addEventListener('click', () => fileInput.click());

    // FIX: Botón cancelar ahora envía cancelAgent al backend
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'cancelAgent' });
            cancelBtn.style.display = 'none';
        });
    }

    fileInput.addEventListener('change', (e) => {
        if (e.target.files) handleImageFiles(e.target.files);
    });

    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files) handleImageFiles(e.dataTransfer.files);
    });

    // 10. Recepción de Mensajes desde VS Code
    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
            case 'addMessage':
                appendMessage(msg.role, msg.content, msg.model, msg.images);
                break;
            case 'streamStart':
                handleStreamStart(msg.model);
                break;
            case 'streamToken':
                handleStreamToken(msg.token);
                break;
            case 'streamEnd':
                handleStreamEnd(msg.content, msg.toolCalls);
                break;
            case 'clearChat':
                chatContainer.innerHTML = '';
                break;
            case 'toolBadge':
                appendToolBadge(msg.toolName, msg.status, msg.message, msg.args);
                break;
            case 'diffPreview':
                appendDiffPreview(msg.filePath, msg.oldText, msg.newText);
                break;
            case 'atSuggestionsResponse':
                renderAtMenu(msg.items);
                break;
            case 'agentStatus':
                if (msg.status === 'busy') {
                    sendBtn.disabled = true;
                    sendBtn.innerHTML = '⏳';
                    // FIX: Mostrar botón cancelar cuando el agente está trabajando
                    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
                } else {
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = '➤';
                    // FIX: Ocultar botón cancelar cuando termina
                    if (cancelBtn) cancelBtn.style.display = 'none';
                }
                break;
            case 'ragStatus':
                appendToolBadge('RAG Indexer', msg.status === 'ready' ? 'success' : (msg.status === 'error' ? 'error' : 'running'), msg.message);
                break;
        }
    });

    initSpeechRecognition();
    vscode.postMessage({ type: 'ready' });
})();
