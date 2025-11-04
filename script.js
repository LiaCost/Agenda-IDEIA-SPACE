// ==================== VARIAVEIS GLOBAIS / ESTADO ====================
let currentUser = localStorage.getItem('currentUser') || '';
let activities = JSON.parse(localStorage.getItem('activities')) || [];
let executions = JSON.parse(localStorage.getItem('executions')) || [];
let executingActivity = null;
const stopwatchIntervals = {};
let dueCheckerInterval = null;	
let alertCheckerInterval = null;
let currentTaskToStart = null;
let currentTaskToComplete = { taskId: null, success: null };
let currentReportInstanceId = null;
let notificationLog = JSON.parse(localStorage.getItem('notificationLog')) || [];
let isNotificationPanelOpen = false;
let parsedData = null; 
let headerRow = null; 


// ==================== PERSISTÊNCIA E INICIALIZAÇÃO ====================

function persistAll() {
    localStorage.setItem('currentUser', currentUser);
    if (executingActivity) {
        const index = executions.findIndex(e => e.instanceId === executingActivity.instanceId);
        if (index !== -1) {
            executions[index] = executingActivity;
        }
    }
    localStorage.setItem('activities', JSON.stringify(activities));
    localStorage.setItem('executions', JSON.stringify(executions));
    localStorage.setItem('notificationLog', JSON.stringify(notificationLog));
}

function loadState() {
    const shiftActiveISO = localStorage.getItem('shiftActiveISO');
    if (shiftActiveISO) {
        executingActivity = executions.find(e => e.status === 'ativo' && e.shiftStart === shiftActiveISO);
    }
    
    if (activities.length > 0) {
        document.getElementById('loadedContainer').classList.remove('hidden');
    }

    renderHeaderStatus();
    renderExecutionInstances();
    updateStats();
    renderActivityPreview();	
    renderNotificationLog();

    // Tenta carregar a aba ativa salva, senão, mostra 'cadastro'
    const activeTabId = localStorage.getItem('activeTabId') || 'cadastro';
    const activeTabButton = document.querySelector(`.tab-btn[onclick*='${activeTabId}']`);
    if (activeTabButton) {
        showTab(activeTabId, activeTabButton);
    } else {
        // Garante que a primeira aba ('cadastro') esteja ativa por padrão
        showTab('cadastro', document.querySelector(".tab-btn[onclick*='cadastro']"));
    }


    if (executingActivity && executingActivity.tasks) {
        executingActivity.tasks.forEach(task => {
            if (task._stopwatchRunning) {
                startStopwatch(task.id);	
            }
        });
        if (executingActivity.instanceId) {
            selectExecutionInstance(executingActivity.instanceId);
        }
    }

    startScheduledChecker();
    startAlertChecker();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('evidenceFileInput').addEventListener('change', addPhotosToEvidenceModal);
    loadState();
});

// ==================== UTILITY FUNCTIONS & NOTIFICATIONS ====================

/**
 * @description Exibe notificação pop-up e registra no log.
 */
function showNotification(message, duration = 3000, type = 'default') {
    notificationLog.unshift({
        timestamp: new Date().toISOString(),
        message: message,
        type: type,
        read: false
    });
    notificationLog = notificationLog.slice(0, 50);	
    persistAll();	
    renderNotificationLog();

    const el = document.createElement('div');
    el.className = `notification ${type}`;
    
    document.body.appendChild(el);
    el.textContent = message;

    setTimeout(() => {
        el.remove();
    }, duration);
}

function renderNotificationLog() {
    const logEl = document.getElementById('notificationLog');
    const countEl = document.getElementById('notificationCount');
    
    logEl.innerHTML = '';
    
    const unreadCount = notificationLog.filter(item => !item.read).length;

    if (unreadCount > 0) {
        countEl.textContent = unreadCount;
        countEl.style.display = 'flex'; // Usando flex para centralizar o número no badge
    } else {
        countEl.textContent = 0;
        countEl.style.display = 'none';
    }

    if (notificationLog.length === 0) {
        logEl.innerHTML = `<div class="small" style="opacity: 0.7;">Nenhum alerta recente.</div>`;
        return;
    }

    notificationLog.forEach(item => {
        const time = new Date(item.timestamp).toLocaleTimeString();
        const typeClass = item.type === 'warning' ? 'warning' : item.type === 'critical' ? 'critical' : '';
        
        logEl.innerHTML += `
            <div class="alert-item ${typeClass}" style="${item.read ? 'opacity: 0.7; font-weight: 400;' : 'font-weight: 700;'}">
                <div class="small">${time} ${item.read ? '(Lido)' : ''}</div>
                <div class="small">${item.message}</div>
            </div>
        `;
    });
}

function toggleNotificationPanel() {
    const panel = document.getElementById('notificationPanel');
    isNotificationPanelOpen = !isNotificationPanelOpen;

    if (isNotificationPanelOpen) {
        panel.classList.add('open');
        notificationLog.forEach(item => item.read = true);
        persistAll();
        renderNotificationLog();
    } else {
        panel.classList.remove('open');
    }
}

function clearNotificationLog() {
    notificationLog = [];
    persistAll();
    renderNotificationLog();
    showNotification('Log de notificações limpo.', 2000);
}


function showTab(tabId, clickedButton) {
    // 1. Esconde todo o conteúdo e remove a classe 'active' de todos os botões
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    // 2. Mostra o conteúdo da aba correta e ativa o botão
    document.getElementById(tabId).classList.add('active');
    if (clickedButton) {
        clickedButton.classList.add('active');
        // Salva a aba ativa no localStorage
        localStorage.setItem('activeTabId', tabId);
    } else {
         document.querySelector(`.tab-btn[onclick*='${tabId}']`)?.classList.add('active');
         localStorage.setItem('activeTabId', tabId);
    }
    
    // 3. Renderiza o conteúdo dinâmico ao mudar de aba
    if (tabId === 'execucao') {
        renderExecutionInstances();
        
        if (executingActivity) {
            selectExecutionInstance(executingActivity.instanceId);
        }
    } else if (tabId === 'relatorios') {
        renderAllReports();
    }
}

function escapeHtml(str) { return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function formatSeconds(sec) {	
    const totalSecs = Math.floor(sec);
    const mm = Math.floor(totalSecs / 60);	
    const ss = totalSecs % 60;	
    const hh = Math.floor(mm / 60);
    const disp_mm = mm % 60;
    if (hh > 0) {
        return `${String(hh).padStart(2,'0')}:${String(disp_mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    }
    return `${String(disp_mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;	
}

function timeToSeconds(timeStr) {
    const parts = timeStr.match(/\((\d{2}):(\d{2})\)/);
    if (parts) {
        const hours = parseInt(parts[1], 10);
        const minutes = parseInt(parts[2], 10);
        return (hours * 3600) + (minutes * 60);
    }
    return null;
}

function timeToTotalSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2) {	
        return (parts[0] * 3600) + (parts[1] * 60);	
    }
    return 0;
}

function secondsToHHMM(totalSeconds) {
    const totalSecs = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(totalSecs / 60);
    const hh = Math.floor(mm / 60);
    const disp_mm = mm % 60;
    return `${String(hh).padStart(2, '0')}:${String(disp_mm).padStart(2, '0')}`;
}

function timeStrToFutureDate(timeStr) {
    const [hh, mm] = timeStr.split(':').map(p => parseInt(p, 10));
    const now = new Date();
    let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);

    if (targetDate.getTime() <= now.getTime()) {
        targetDate.setDate(targetDate.getDate() + 1);
    }
    return targetDate;
}


// ==================== CONTROLE DE USUÁRIO E TURNO ====================

function renderHeaderStatus() {
    const shiftActiveISO = localStorage.getItem('shiftActiveISO');
    const shiftStatusEl = document.getElementById('shiftStatus');
    const btnStart = document.getElementById('btnStartShift');
    const btnEnd = document.getElementById('btnEndShift');
    
    if (shiftActiveISO) {
        const operatorName = executingActivity ? executingActivity.operator : 'N/A';
        shiftStatusEl.textContent = `Turno ATIVO desde: ${new Date(shiftActiveISO).toLocaleString()} (Operador: ${operatorName})`;
        btnStart.disabled = true;
        btnEnd.disabled = false;
    } else {
        shiftStatusEl.textContent = 'Turno encerrado ou não iniciado.';
        btnStart.disabled = activities.length === 0;
        btnEnd.disabled = true;
    }
}

function startShift() {
    if (localStorage.getItem('shiftActiveISO')) {
        showNotification('Já existe um turno ativo! Encerre o anterior primeiro.', 3000);
        return;
    }

    if (activities.length === 0) {
        showNotification('Importe as atividades (planilha) primeiro.', 3000);
        document.querySelector('.tab-btn').click();
        return;
    }

    const startTime = new Date().toISOString();
    localStorage.setItem('shiftActiveISO', startTime);
    
    executingActivity = {
        instanceId: `INST-${Date.now()}`,
        operator: currentUser || 'N/A',
        shiftStart: startTime,
        shiftEnd: null,
        status: 'ativo',
        tasks: activities.map(t => ({
            ...t,
            id: `TASK-${Date.now()}-${Math.random()}`,
            status: 'pendente',
            runtimeSeconds: 0,
            targetSeconds: 0,	
            scheduledAlertISO: null,	
            scheduledLimitISO: null,
            timeMode: 'manual',	
            _stopwatchRunning: false,
            _stopwatchStart: null,
            completed: false,
            completedAt: null,
            photos: [],
            operatorTask: '',
            observation: '',
            due: false,
            alerted: false,	
            dueSeconds: timeToSeconds(t['T + (hh:mm)'])
        }))
    };
    executions.push(executingActivity);
    persistAll();

    renderHeaderStatus();
    
    selectExecutionInstance(executingActivity.instanceId);	
    
    const execButton = document.querySelector(".tab-btn[onclick*='execucao']");
    showTab('execucao', execButton);

    updateStats();
    
    showNotification('Turno iniciado! Agora, inicie a primeira tarefa com o seu ID.', 3000);
}

function openEndShiftConfirmation() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) {
        showNotification('Nenhum turno ativo para encerrar.', 3000);
        return;
    }
    
    const nonCompleted = executingActivity.tasks.filter(t => !t.completed).length;
    
    if (nonCompleted === 0) {
        confirmEndShift(false);
        return;
    }

    document.getElementById('pendingTaskMessage').innerHTML = `Ainda há **${nonCompleted} tarefas** não concluídas. Deseja encerrar o turno e gerar o relatório mesmo assim?`;
    document.getElementById('confirmEndShiftModal').classList.remove('hidden');
}

function closeEndShiftConfirmation() {
    document.getElementById('confirmEndShiftModal').classList.add('hidden');
}

function confirmEndShift(wasForced) {
    closeEndShiftConfirmation();
    
    if (executingActivity === null) return;

    executingActivity.tasks.forEach(task => {
        if (task._stopwatchRunning) {
            pauseStopwatch(task.id);	
        }
    });

    executingActivity.shiftEnd = new Date().toISOString();
    executingActivity.status = 'concluido';
    localStorage.removeItem('shiftActiveISO');

    persistAll();
    executingActivity = null;
    
    renderHeaderStatus();
    updateStats();	
    
    const reportButton = document.querySelector(".tab-btn[onclick*='relatorios']");
    showTab('relatorios', reportButton);

    showNotification('Turno encerrado com sucesso. Relatório gerado!', 4000);
}

function endShift() {
    openEndShiftConfirmation();
}

function clearAllData() {
    document.getElementById('confirmClearDataModal').classList.remove('hidden');
}

function closeClearDataConfirmation() {
    document.getElementById('confirmClearDataModal').classList.add('hidden');
}

function confirmClearAllData() {
    closeClearDataConfirmation();
    localStorage.clear();
    location.reload();	
}

// ==================== LÓGICA DO CRONÓMETRO E FLUXO DE TAREFAS ====================

function initiateTaskWithOperatorID(taskId) {
    currentTaskToStart = taskId;
    const task = executingActivity.tasks.find(t => t.id === taskId);

    document.getElementById('taskNameDisplay').textContent = task ? task['Event / Action'] : '';
    
    const modalInput = document.getElementById('modalOperatorIdInput');
    modalInput.value = currentUser;

    const timeModeSelect = document.getElementById('timeModeSelect');
    const countdownInput = document.getElementById('countdownTimeInput');
    const scheduledAlertInput = document.getElementById('scheduledAlertTimeInput');
    const scheduledLimitInput = document.getElementById('scheduledLimitTimeInput');
    
    const defaultTimeStr = task['T + (hh:mm)'] || '00:00';	
    const defaultSeconds = timeToTotalSeconds(defaultTimeStr);

    if (task.timeMode === 'countdown' && task.targetSeconds > 0) {
        timeModeSelect.value = 'countdown';
        countdownInput.value = secondsToHHMM(task.targetSeconds);
    } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
         timeModeSelect.value = 'scheduled';
         scheduledAlertInput.value = new Date(task.scheduledAlertISO).toTimeString().slice(0, 5);
         scheduledLimitInput.value = new Date(task.scheduledLimitISO).toTimeString().slice(0, 5);
    } else {
         timeModeSelect.value = 'manual';
         countdownInput.value = secondsToHHMM(defaultSeconds) || '00:10';	
         
         const alertTime = timeStrToFutureDate(secondsToHHMM(defaultSeconds) || '12:30');
         const limitTime = new Date(alertTime.getTime() + 60 * 60 * 1000);

         scheduledAlertInput.value = alertTime.toTimeString().slice(0, 5);
         scheduledLimitInput.value = limitTime.toTimeString().slice(0, 5);
    }

    updateTimeModeDisplay();
    
    document.getElementById('startTaskModal').classList.remove('hidden');
    modalInput.focus();
}

function updateTimeModeDisplay() {
    const mode = document.getElementById('timeModeSelect').value;
    const countdownGroup = document.getElementById('countdownTimeGroup');
    const scheduledGroup = document.getElementById('scheduledTimeGroup');
    
    countdownGroup.classList.add('hidden');
    scheduledGroup.classList.add('hidden');
    document.getElementById('countdownTimeInput').required = false;
    
    document.getElementById('scheduledAlertTimeInput').required = false;
    document.getElementById('scheduledLimitTimeInput').required = false;

    
    if (mode === 'countdown') {
        countdownGroup.classList.remove('hidden');
        document.getElementById('countdownTimeInput').required = true;
        setTimeout(() => document.getElementById('countdownTimeInput').focus(), 100);

    } else if (mode === 'scheduled') {
        scheduledGroup.classList.remove('hidden');
        document.getElementById('scheduledAlertTimeInput').required = true;
        document.getElementById('scheduledLimitTimeInput').required = true;
        
        setTimeout(() => document.getElementById('scheduledAlertTimeInput').focus(), 100);
    }
}


function closeTaskStartModal() {
    document.getElementById('startTaskModal').classList.add('hidden');
    currentTaskToStart = null;
}

function confirmTaskStart() {
    const modalInput = document.getElementById('modalOperatorIdInput');
    const operatorId = modalInput.value.trim();
    const timeMode = document.getElementById('timeModeSelect').value;

    if (operatorId === '') {
        showNotification('O ID do operador é obrigatório para iniciar a tarefa.', 3000, 'critical');
        return;
    }
    
    const taskId = currentTaskToStart;
    const task = executingActivity.tasks.find(t => t.id === taskId);
    
    if (!task) {
        closeTaskStartModal();
        return;
    }
    
    let targetSecs = 0;
    let scheduledAlertISO = null;
    let scheduledLimitISO = null;

    if (timeMode === 'countdown') {
        const countdownTime = document.getElementById('countdownTimeInput').value;	
        targetSecs = timeToTotalSeconds(countdownTime);
        if (targetSecs === 0) {
             showNotification('A duração máxima (HH:MM) deve ser maior que 0.', 3000, 'warning');
             return;
        }
    } else if (timeMode === 'scheduled') {
        const alertTimeStr = document.getElementById('scheduledAlertTimeInput').value;
        const limitTimeStr = document.getElementById('scheduledLimitTimeInput').value;

        const alertDate = timeStrToFutureDate(alertTimeStr);
        const limitDate = timeStrToFutureDate(limitTimeStr);

        if (limitDate.getTime() <= alertDate.getTime()) {
            showNotification('O Horário limite deve ser posterior ao horário de alerta.', 3000, 'warning');
            return;
        }

        scheduledAlertISO = alertDate.toISOString();
        scheduledLimitISO = limitDate.toISOString();
        
        targetSecs = Math.floor((limitDate.getTime() - alertDate.getTime()) / 1000);	
    }
    
    task.timeMode = timeMode;
    task.targetSeconds = targetSecs;	
    task.scheduledAlertISO = scheduledAlertISO;
    task.scheduledLimitISO = scheduledLimitISO;
    
    currentUser = operatorId;
    localStorage.setItem('currentUser', currentUser);

    task.operatorTask = operatorId;
    
    if (executingActivity.operator === 'N/A' || executingActivity.operator === '') {
         executingActivity.operator = operatorId;
         renderHeaderStatus();	
    }
    
    startStopwatch(taskId);

    closeTaskStartModal();
}

function startStopwatch(taskId) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    if (task.dueSeconds !== null) {
        const now = new Date();
        const shiftStart = new Date(executingActivity.shiftStart);
        const elapsedShiftSeconds = Math.floor((now.getTime() - shiftStart.getTime()) / 1000);

        if (elapsedShiftSeconds < task.dueSeconds && task.status === 'pendente') {
            const diff = task.dueSeconds - elapsedShiftSeconds;
            const mm = Math.floor(diff / 60);
            const ss = diff % 60;
            showNotification(`ERRO: Faltam ${mm}min e ${ss}s para o horário de início agendado (${task['Event / Action']}).`, 5000, 'warning');
            return;
        }
    }

    const currentlyRunning = executingActivity.tasks.find(t => t._stopwatchRunning);
    if (currentlyRunning && currentlyRunning.id !== taskId) {
        showNotification(`A tarefa '${currentlyRunning['Event / Action']}' já está em execução. Pause-a primeiro.`, 5000, 'warning');
        return;
    }
    
    if (task._stopwatchRunning) {	
        showNotification('Cronómetro já em execução para esta tarefa.');	
        return;	
    }
    
    task._stopwatchRunning = true;
    task._stopwatchStart = new Date().getTime();	
    task.status = 'em execução';
    task.due = false;	

    persistAll();

    updateExecutionTaskUI(taskId);

    stopwatchIntervals[taskId] = setInterval(() => {
        const now = new Date().getTime();
        const sessionElapsedSeconds = Math.floor((now - task._stopwatchStart) / 1000);
        const totalElapsed = (task.runtimeSeconds || 0) + sessionElapsedSeconds;
        
        const el = document.getElementById(`timer-${taskId}`);
        if (!el) return;

        let elapsedText = '';
        let targetText = '';
        let elapsedColor = '';


        if (task.timeMode === 'countdown') {
            const timeLeft = task.targetSeconds - totalElapsed;
            const displayTime = formatSeconds(Math.abs(timeLeft));
            
            elapsedText = timeLeft >= 0 ? `Restante: ${displayTime}` : `ATRASO: ${displayTime}`;
            elapsedColor = timeLeft >= 0 ? '#F27EBE' : '#f44336';
            
            const targetTime = secondsToHHMM(task.targetSeconds);
            targetText = `Máximo: ${targetTime} (Regressiva)`;

        } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
            const scheduledTime = new Date(task.scheduledLimitISO).getTime();
            const timeLeftMs = scheduledTime - now;
            const timeLeftSeconds = Math.floor(timeLeftMs / 1000);
            const displayTime = formatSeconds(Math.abs(timeLeftSeconds));
            
            elapsedText = timeLeftSeconds >= 0 ? `Faltam: ${displayTime}` : `ATRASO: ${displayTime}`;
            elapsedColor = timeLeftSeconds >= 0 ? '#F27EBE' : '#f44336';
            
            const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            targetText = `Janela: ${alertTimeStr} - ${limitTimeStr} (Programado)`;

        } else {
            const displayTime = formatSeconds(totalElapsed);
            
            elapsedText = `Decorrido: ${displayTime}`;
            elapsedColor = '#F27EBE';
            targetText = `Previsão: ${task['T + (hh:mm)'] || '--:--'} (Manual)`;
        }

        el.querySelector('.elapsed').textContent = elapsedText;
        el.querySelector('.elapsed').style.color = elapsedColor;
        el.querySelector('.target').textContent = targetText;

    }, 1000);
}

function pauseStopwatch(taskId) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task || !task._stopwatchRunning) return;
    
    clearInterval(stopwatchIntervals[taskId]);
    delete stopwatchIntervals[taskId];
    
    const sessionDurationSeconds = Math.floor((new Date().getTime() - task._stopwatchStart) / 1000);

    task.runtimeSeconds = (task.runtimeSeconds || 0) + sessionDurationSeconds;

    task._stopwatchRunning = false;
    task._stopwatchStart = null;
    task.status = 'pendente';	
    
    persistAll();
    updateExecutionTaskUI(taskId);
    showNotification(`Tarefa pausada: ${task['Event / Action']}.`, 2000, 'warning');
}

function stopAndComplete(taskId, success) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    if (task._stopwatchRunning) {
        pauseStopwatch(taskId);
    }
    
    openEvidenceModal(taskId, success);
}

function checkScheduledAlerts() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) return;

    const now = new Date().getTime();
    let changed = false;

    executingActivity.tasks.forEach(t => {
        if (!t.completed && t.timeMode === 'scheduled' && t.scheduledAlertISO) {
            const alertTime = new Date(t.scheduledAlertISO).getTime();	
            
            if (now >= alertTime && !t.alerted) {
                t.alerted = true;
                changed = true;
                showNotification(`ALERTA: Tarefa "${t['Event / Action']}" atingiu o horário programado!`, 10000, 'critical');
            }
        }
    });

    if (changed) {
        persistAll();
        renderExecutionTasks();
    }
}

function startAlertChecker() {
    if (alertCheckerInterval) clearInterval(alertCheckerInterval);
    alertCheckerInterval = setInterval(checkScheduledAlerts, 5000);	
}

function openEvidenceModal(taskId, success) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    currentTaskToComplete = { taskId, success };
    
    document.getElementById('evidenceModalTaskName').textContent = task['Event / Action'];
    document.getElementById('evidenceModalObservation').value = task.observation || '';	

    const btn = document.getElementById('evidenceSubmitButton');
    btn.textContent = success ? 'Concluir com SUCESSO' : 'Concluir com FALHA';
    btn.style.background = success ? '#4CAF50' : '#f44336';
    
    renderEvidencePhotoPreview(task.photos);

    document.getElementById('evidenceModal').classList.remove('hidden');
    document.getElementById('evidenceModalObservation').focus();
}

function closeEvidenceModal() {
    document.getElementById('evidenceModal').classList.add('hidden');
    currentTaskToComplete = { taskId: null, success: null };
    document.getElementById('evidenceFileInput').value = '';	
}

function renderEvidencePhotoPreview(photos) {
    const previewEl = document.getElementById('evidencePhotoPreview');
    previewEl.innerHTML = '';
    photos.forEach((dataURL, index) => {
        
        // Elemento com estilos inline mantidos APENAS porque são injetados no DOM para visualização do usuário
        // e não podem ser facilmente removidos sem reescrever a renderização de imagens.
        const photoContainerHtml = `
            <div style="position: relative; display: inline-block;">
                <img src="${dataURL}" class="img-preview" style="display:block; margin-right:5px; max-width:80px; max-height:60px; border-radius:4px;">
                <button class="btn-small btn-secondary" onclick="removePhotoFromEvidenceModal('${currentTaskToComplete.taskId}', ${index})" style="position: absolute; top: 0; right: 0; padding: 2px 4px; background: rgba(244, 67, 54, 0.8); color: #fff; line-height: 1; font-size: 10px; transform: none;">❌</button>
            </div>
        `;
        previewEl.insertAdjacentHTML('beforeend', photoContainerHtml);
    });

    const addButton = document.querySelector('#evidenceModal .btn-secondary');
    const maxPhotos = 3;
    if (photos.length >= maxPhotos) {
        addButton.setAttribute('disabled', 'disabled');
        addButton.textContent = `Limite de ${maxPhotos} fotos atingido`;
    } else {
        addButton.removeAttribute('disabled');
        addButton.textContent = 'Adicionar foto';
    }
}

function addPhotosToEvidenceModal() {
    const taskId = currentTaskToComplete.taskId;
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;
    
    const files = Array.from(document.getElementById('evidenceFileInput').files);
    const maxAllowed = 3 - task.photos.length;
    const filesToAdd = files.slice(0, maxAllowed);
    
    if (filesToAdd.length === 0) {
        document.getElementById('evidenceFileInput').value = '';
        return;
    }

    let filesProcessed = 0;
    const totalFiles = filesToAdd.length;

    filesToAdd.forEach(f => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            task.photos.push(ev.target.result);
            filesProcessed++;

            if (filesProcessed === totalFiles) {
                renderEvidencePhotoPreview(task.photos);	
                persistAll();	
                document.getElementById('evidenceFileInput').value = '';	
            }
        };
        reader.readAsDataURL(f);
    });
}

function removePhotoFromEvidenceModal(taskId, index) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task || index < 0 || index >= task.photos.length) return;
    
    task.photos.splice(index, 1);
    persistAll();
    renderEvidencePhotoPreview(task.photos);
}

function submitEvidenceAndComplete() {
    const { taskId, success } = currentTaskToComplete;
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    const observation = document.getElementById('evidenceModalObservation').value.trim();
    
    if (observation === '') {
        showNotification('A descrição/observação é obrigatória.', 3000, 'warning');
        return;
    }
    
    task.observation = observation;
    
    task.completed = true;
    task.status = success ? 'concluída (sucesso)' : 'concluída (falha)';
    task.success = success;
    if (!task.completedAt) task.completedAt = new Date().toISOString();
    
    task.due = false;	

    persistAll();
    updateExecutionTaskUI(taskId);
    showNotification(`Tarefa finalizada: ${task['Event / Action']} (${success ? 'Sucesso' : 'Falha'})`);
    updateProgress();
    
    closeEvidenceModal();
}

function updateStats() {
    const totalActivities = activities.length;
    const activeExecutions = executions.filter(e => e.status === 'ativo').length;

    const totalActivitiesEl = document.getElementById('totalActivities');
    const activeActivitiesEl = document.getElementById('activeActivities');

    if (totalActivitiesEl) totalActivitiesEl.textContent = totalActivities;
    if (activeActivitiesEl) activeActivitiesEl.textContent = activeExecutions;
}

function renderExecutionInstances() {
    const listEl = document.getElementById('activityList');
    
    listEl.innerHTML = '';
    
    const allExecutions = executions.sort((a, b) => new Date(b.shiftStart) - new Date(a.shiftStart));
    const activeExecutions = allExecutions.filter(e => e.status === 'ativo');

    if (activeExecutions.length === 0 && activities.length > 0 && !localStorage.getItem('shiftActiveISO')) {
        listEl.innerHTML = `<div class="small text-center p-12">Inicie o turno para ver e executar as tarefas importadas.</div>`;
        document.getElementById('executionPanel').classList.add('hidden');
        return;
    }

    if (activeExecutions.length === 0 && activities.length > 0) {
        listEl.innerHTML = `<div class="small text-center p-12">Nenhum turno ativo. Selecione outro turno na aba relatórios.</div>`;
        document.getElementById('executionPanel').classList.add('hidden');
        return;
    }
    
    activeExecutions.forEach(inst => {
        const total = inst.tasks.length;
        const done = inst.tasks.filter(t => t.completed).length;
        const isSelected = executingActivity && executingActivity.instanceId === inst.instanceId;
        const progressPercent = ((done/total)*100).toFixed(0);
        const startTime = new Date(inst.shiftStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        listEl.innerHTML += `
            <div class="activity-card card" onclick="selectExecutionInstance('${inst.instanceId}')" style="${isSelected ? 'transform: translateY(0); border-color:#F20587; border: 2px solid #F20587;' : 'cursor: pointer;'}">
                <div class="fw-700">Turno: ${new Date(inst.shiftStart).toLocaleDateString()}, ${startTime}</div>
                <div class="small">Operador: ${inst.operator}</div>
                <div class="small">Progresso: ${done}/${total} (${progressPercent}%)</div>
            </div>
        `;
    });
}

function selectExecutionInstance(instanceId) {
    executingActivity = executions.find(e => e.instanceId === instanceId);
    if (!executingActivity) return;
    
    const panel = document.getElementById('executionPanel');
    const title = document.getElementById('executionTitle');
    
    const executionFilterEl = document.getElementById('executionFilter');
    if (executionFilterEl) executionFilterEl.value = 'todos';

    title.textContent = `Executando: Turno de ${new Date(executingActivity.shiftStart).toLocaleDateString()} (Operador: ${executingActivity.operator})`;
    panel.classList.remove('hidden');
    
    updateProgress();
    renderExecutionTasks();
    renderExecutionInstances();
}

function updateProgress() {
    if (!executingActivity) return;
    const total = executingActivity.tasks.length;
    const done = executingActivity.tasks.filter(t=>t.completed).length;
    const progressPercent = total > 0 ? ((done / total) * 100).toFixed(0) : 0;
    
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
        progressBar.textContent = `${progressPercent}%`;
    }
}

function renderExecutionTasks() {
    if (!executingActivity) return;

    const listEl = document.getElementById('executionTasks');
    listEl.innerHTML = '';
    
    const filterValue = document.getElementById('executionFilter')?.value || 'todos';

    const filteredTasks = executingActivity.tasks.filter(task => {
        if (task.completed) {
            return filterValue === 'todos' || filterValue === 'concluida';
        }
        if (task._stopwatchRunning) {
            return filterValue === 'todos' || filterValue === 'em execucao';
        }
        if (task.runtimeSeconds > 0 && !task.completed) {
             return filterValue === 'todos' || filterValue === 'pausada';
        }
        if (task.runtimeSeconds === 0 && !task.completed) {
            return filterValue === 'todos' || filterValue === 'nao iniciada' || filterValue === 'pendente';
        }
        return false;
    });

    if (filteredTasks.length === 0) {
        listEl.innerHTML = `<div class="small text-center p-12">Nenhuma tarefa encontrada com o filtro atual.</div>`;
        return;
    }

    filteredTasks.forEach(task => {
        let taskEl = document.getElementById(`task-item-${task.id}`);
        if (!taskEl) {
            taskEl = document.createElement('div');
            taskEl.id = `task-item-${task.id}`;
            listEl.appendChild(taskEl);
        }
        
        updateExecutionTaskUI(task.id);
    });
}

function updateExecutionTaskUI(taskId) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    let taskEl = document.getElementById(`task-item-${taskId}`);
    if (!taskEl) return;

    const isRunning = task._stopwatchRunning;
    const isCompleted = task.completed;
    const isDue = task.due;
    const isAlerted = task.alerted;
    const isPaused = !isRunning && !isCompleted && task.runtimeSeconds > 0;

    let buttonsHtml = '';
    let statusText = '';
    let statusColor = ''; 
    let elapsedText = '';
    let targetText = '';
    let elapsedColor = '';

    // Determine Status, Color, and Buttons
    if (isCompleted) {
        statusText = task.success ? 'CONCLUÍDA (SUCESSO)' : 'CONCLUÍDA (FALHA)';
        statusColor = task.success ? '#4CAF50' : '#f44336';
        buttonsHtml = `
            <button class="btn-small btn-secondary" disabled>Finalizado</button>
            <button class="btn-small" onclick="downloadTaskPDF('${task.id}')">PDF (Unitário)</button>
        `;
    } else if (isRunning) {
        statusText = 'EM EXECUÇÃO';
        statusColor = '#F20587';
        buttonsHtml = `
            <button class="btn-small btn-secondary" onclick="pauseStopwatch('${task.id}')">Pausar</button>
            <button class="btn-small" style="background:#4CAF50" onclick="stopAndComplete('${task.id}', true)">SUCESSO</button>
            <button class="btn-small" style="background:#f44336" onclick="stopAndComplete('${task.id}', false)">FALHA</button>
        `;
    } else if (isPaused) {
        statusText = 'PAUSADA';
        statusColor = '#FFD54F';
        buttonsHtml = `
            <button class="btn-small" onclick="initiateTaskWithOperatorID('${task.id}')">Retomar</button>
            <button class="btn-small" style="background:#4CAF50" onclick="stopAndComplete('${task.id}', true)">SUCESSO</button>
            <button class="btn-small" style="background:#f44336" onclick="stopAndComplete('${task.id}', false)">FALHA</button>
        `;
    } else {
        statusText = isDue ? 'PENDENTE (ATRASADO)' : 'NÃO INICIADA';
        statusColor = isDue ? '#f44336' : '#F27EBE';
        buttonsHtml = `<button class="btn-small" onclick="initiateTaskWithOperatorID('${task.id}')">Iniciar</button>`;
    }
    
    // Determine Time Display
    if (isRunning) {
        elapsedColor = statusColor;
        targetText = `Previsão: ${escapeHtml(task['T + (hh:mm)'] || '--:--')} (Manual)`;
        if (task.timeMode === 'countdown') {
             targetText = `Máximo: ${secondsToHHMM(task.targetSeconds)} (Regressiva)`;
        } else if (task.timeMode === 'scheduled') {
             const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             targetText = `Janela: ${alertTimeStr} - ${limitTimeStr} (Programado)`;
        }

    } else {
        elapsedColor = isCompleted ? '#4CAF50' : (isPaused || isDue ? statusColor : '#F27EBE');
        
        if (task.timeMode === 'countdown' && task.targetSeconds > 0) {
             const timeLeft = task.targetSeconds - (task.runtimeSeconds || 0);
             const displayTime = formatSeconds(Math.abs(timeLeft));
             elapsedText = timeLeft >= 0 ? `Restante: ${displayTime} ${isPaused ? '(Pausado)' : ''}` : `ATRASO: ${displayTime} ${isPaused ? '(Pausado)' : ''}`;
             elapsedColor = timeLeft >= 0 ? elapsedColor : '#f44336';
             const targetTime = secondsToHHMM(task.targetSeconds);
             targetText = `Máximo: ${targetTime} (Regressiva)`;
        } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
             const nowTime = new Date().getTime();
             const scheduledTime = new Date(task.scheduledLimitISO).getTime();
             const timeLeftSeconds = Math.floor((scheduledTime - nowTime) / 1000);
             const displayTime = formatSeconds(Math.abs(timeLeftSeconds));
             elapsedText = timeLeftSeconds >= 0 ? `Faltam: ${displayTime} ${isPaused ? '(Pausado)' : ''}` : `ATRASO: ${displayTime} ${isPaused ? '(Pausado)' : ''}`;
             elapsedColor = timeLeftSeconds >= 0 ? elapsedColor : '#f44336';

             const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             targetText = `Janela: ${alertTimeStr} - ${limitTimeStr} (Programado)`;
        } else {
            elapsedText = `Decorrido: ${formatSeconds(task.runtimeSeconds)}`;
            targetText = `Previsão: ${escapeHtml(task['T + (hh:mm)'] || '--:--')} (Manual)`;
        }
    }
    
    let taskClass = `task-item ${isCompleted ? 'completed' : ''} ${isDue && !isCompleted ? 'task-due' : ''} ${isPaused ? 'task-paused' : ''}`;
    if (isRunning) taskClass = taskClass.replace('task-due', '').replace('task-paused', '');
    
    taskEl.className = taskClass;
    
    taskEl.innerHTML = `
        <div class="task-header">
            <div>
                <h4 class="mb-4" style="color:${isCompleted ? '#F0F0F2' : statusColor};">${escapeHtml(task['Event / Action'])}</h4>
                <div class="small"><strong>Status:</strong> ${statusText}</div>
                <div class="small"><strong>Operador:</strong> ${escapeHtml(task.operatorTask || 'N/A')}</div>
                ${isAlerted && !isCompleted ? `<div class="small fw-700" style="color:#f44336;">ALERTA DE PRAZO!</div>` : ''}
            </div>
            <div class="time-display" id="timer-${task.id}">
                <div class="elapsed fw-700" style="color:${elapsedColor}">${elapsedText}</div>
                <div class="target small">${targetText}</div>
            </div>
        </div>
        <div class="small" style="opacity:0.9;"><strong>Critério:</strong> ${escapeHtml(task['Key Acceptance Criteria'])}</div>
        <div class="btn-group">
            ${buttonsHtml}
        </div>
    `;
}

function filterActivities() {
    renderActivityPreview();
}

function renderActivityPreview() {
    const listEl = document.getElementById('taskPreview');
    const searchInput = document.getElementById('searchActivitiesInput');
    const filterText = searchInput ? searchInput.value.toLowerCase() : '';
    
    const filteredActivities = activities.filter(t =>	
        t['Event / Action'].toLowerCase().includes(filterText) ||
        t['Proc. ID'].toLowerCase().includes(filterText) ||
        filterText === ''
    );

    if (filteredActivities.length === 0) {
        listEl.innerHTML = `<div class="small text-center p-12">Nenhuma atividade corresponde ao filtro.</div>`;
        return;
    }
    
    listEl.innerHTML = filteredActivities.map((t, index) => `
        <div class="task-item" style="border-left-color:#F27EBE; transition:none; transform:none;">
            <h4 class="mb-4">${index + 1}. ${escapeHtml(t['Event / Action'])}</h4>
            <div class="small"><strong>Tempo Previsto:</strong> ${escapeHtml(t['T + (hh:mm)'])}</div>
            <div class="small"><strong>Evento/Grupo:</strong> ${escapeHtml(t.Event)} | <strong>Proc. ID:</strong> ${escapeHtml(t['Proc. ID'])}</div>
            <div class="small"><strong>Critério:</strong> ${escapeHtml(t['Key Acceptance Criteria'])}</div>
        </div>
    `).join('');
    
    document.getElementById('loadedSummary').textContent = `${filteredActivities.length} atividades visíveis (Total: ${activities.length}).`;
}

async function downloadAllImagesZip() {
    if (executions.length === 0) return showNotification('Nenhuma imagem registrada para download.', 2000);

    const zip = new JSZip();
    let fileCount = 0;

    executions.forEach(inst => {
        inst.tasks.forEach(task => {
            task.photos.forEach((dataURL, index) => {
                const base64Data = dataURL.split(',')[1];
                const fileName = `${inst.operator}_${inst.instanceId.split('-')[1]}_${task.id.split('-')[2]}_${index + 1}.png`;
                zip.file(fileName, base64Data, { base64: true });
                fileCount++;
            });
        });
    });

    if (fileCount === 0) return showNotification('Nenhuma imagem registrada para download.', 2000);

    showNotification(`Gerando ZIP com ${fileCount} imagens...`, 2000);
    const content = await zip.generateAsync({ type: "blob" });
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `Evidencias_DITL_${date}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);	
    showNotification('Download do ZIP concluído!', 2000);
}

function onFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        parsedData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (parsedData.length === 0) return showNotification('Arquivo vazio ou inválido.', 3000, 'warning');
        
        headerRow = parsedData.shift();
        
        setupMappingModal();
    };
    reader.readAsArrayBuffer(file);
}

function setupMappingModal() {
    const modal = document.getElementById('mappingModal');
    const requiredMaps = ['mapTime', 'mapProc', 'mapEvent', 'mapAction', 'mapAcceptance'];
    
    requiredMaps.forEach(id => {
         document.getElementById(id).innerHTML = '';
    });

    headerRow.forEach((col, index) => {
        requiredMaps.forEach(id => {
            const selectEl = document.getElementById(id);
            const option = document.createElement('option');
            option.value = index;
            option.textContent = col;
            selectEl.appendChild(option);
        });
    });
    
    requiredMaps.forEach(id => {
        const selectEl = document.getElementById(id);
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '— Não usar —';
        selectEl.prepend(emptyOption);
    });
    
    // Auto-mapping logic
    requiredMaps.forEach(id => {
         const selectEl = document.getElementById(id);
         for (let i = 0; i < selectEl.options.length; i++) {
             const optionText = selectEl.options[i].textContent;
             const index = selectEl.options[i].value;
             if (optionText.includes('T +') && id === 'mapTime') selectEl.value = index;
             if (optionText.includes('Proc.') && id === 'mapProc') selectEl.value = index;
             if (optionText.includes('Event') && id === 'mapEvent') selectEl.value = index;
             if (optionText.includes('Action') && id === 'mapAction') selectEl.value = index;
             if (optionText.includes('Criteria') && id === 'mapAcceptance') selectEl.value = index;
         }
    });


    let previewHtml = '<table><thead><tr>';
    headerRow.forEach(h => previewHtml += `<th>${escapeHtml(h)}</th>`);
    previewHtml += '</tr></thead><tbody>';
    
    parsedData.slice(0, 5).forEach(row => {
        previewHtml += '<tr>';
        row.forEach(cell => previewHtml += `<td>${escapeHtml(cell)}</td>`);
        previewHtml += '</tr>';
    });
    previewHtml += '</tbody></table>';

    document.getElementById('mappingPreview').innerHTML = previewHtml;
    modal.classList.remove('hidden');
}

function confirmImport() {
    const map = {
        'T + (hh:mm)': document.getElementById('mapTime').value,
        'Proc. ID': document.getElementById('mapProc').value,
        'Event': document.getElementById('mapEvent').value,
        'Event / Action': document.getElementById('mapAction').value,
        'Key Acceptance Criteria': document.getElementById('mapAcceptance').value
    };

    activities = parsedData.map(row => ({
        'T + (hh:mm)': row[map['T + (hh:mm)']] || '',
        'Proc. ID': row[map['Proc. ID']] || '',
        'Event': row[map['Event']] || '',
        'Event / Action': row[map['Event / Action']] || '',
        'Key Acceptance Criteria': row[map['Key Acceptance Criteria']] || ''
    })).filter(t => t['Event / Action']);
    
    persistAll();
    cancelMapping();

    document.getElementById('loadedSummary').textContent = `${activities.length} atividades importadas com sucesso.`;
    document.getElementById('loadedContainer').classList.remove('hidden');
    updateStats();
    renderActivityPreview();
    showNotification('Planilha importada com sucesso!', 3000);
    renderHeaderStatus();
}

function cancelMapping() {
    document.getElementById('mappingModal').classList.add('hidden');
}

function downloadJSON() {
    const data = {
        currentUser: currentUser,
        activities: activities,
        executions: executions
    };
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `DITL_Backup_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Dados exportados para JSON.', 2000);
}

function renderAllReports() {
    const reportListEl = document.getElementById('reportList');
    reportListEl.innerHTML = '';
    
    const filterValue = document.getElementById('reportFilter').value;
    
    let filteredExecutions = executions.sort((a, b) => new Date(b.shiftStart) - new Date(a.shiftStart));

    if (filterValue !== 'todos') {
        filteredExecutions = filteredExecutions.filter(e => e.status === filterValue);
    }

    if (filteredExecutions.length === 0) {
        reportListEl.innerHTML = `<div class="small text-center">Nenhum relatório encontrado com o filtro atual.</div>`;
        return;
    }

    filteredExecutions.forEach(inst => {
        const total = inst.tasks.length;
        const done = inst.tasks.filter(t => t.completed).length;
        const totalTime = inst.tasks.reduce((acc, t) => acc + (t.runtimeSeconds || 0), 0);
        const totalTimeFormatted = formatSeconds(totalTime);
        const isCompleted = inst.status === 'concluido';

        reportListEl.innerHTML += `
            <div class="task-item ${isCompleted ? 'completed' : ''}" style="cursor:pointer; padding:16px;" onclick="previewReport('${inst.instanceId}')">
                <div class="task-header">
                    <div>
                        <h4 class="mb-4">Relatório do Turno: ${new Date(inst.shiftStart).toLocaleDateString()}</h4>
                        <div class="small">Operador: ${inst.operator}</div>
                        <div class="small">Início: ${new Date(inst.shiftStart).toLocaleTimeString()} | Fim: ${inst.shiftEnd ? new Date(inst.shiftEnd).toLocaleTimeString() : 'Em andamento'}</div>
                    </div>
                    <div>
                        <div class="small fw-700" style="color:#F27EBE;">Total Executado: ${totalTimeFormatted}</div>
                        <span class="success-badge ${isCompleted ? 'yes' : 'no'} mt-4">${isCompleted ? 'CONCLUÍDO' : 'ATIVO'}</span>
                    </div>
                </div>
                <div class="small mt-8">Tarefas: ${done}/${total} concluídas.</div>
            </div>
        `;
    });
}

function previewReport(instanceId) {
    const inst = executions.find(e => e.instanceId === instanceId);
    if (!inst) return;

    currentReportInstanceId = instanceId;	

    const innerEl = document.getElementById('reportPreviewInner');
    innerEl.innerHTML = generateReportHTML(inst);
    
    document.getElementById('reportPreviewModal').style.zIndex = '9999';	
    document.getElementById('reportPreviewModal').classList.remove('hidden');
}

function closeReportPreview() {
    document.getElementById('reportPreviewModal').classList.add('hidden');
    document.getElementById('reportPreviewModal').style.zIndex = '4000';
    currentReportInstanceId = null;
}

// ==================== FUNÇÕES DE GERAÇÃO DE HTML DE RELATÓRIO ====================
// NOTA: Estas funções mantêm estilos HTML/CSS INLINE porque o JS-PDF e HTML2CANVAS 
// precisam dos estilos embutidos no elemento DOM para renderizar o PDF corretamente.

function generateReportHTML(inst) {
    const totalTime = inst.tasks.reduce((acc, t) => acc + (t.runtimeSeconds || 0), 0);
    const totalTimeFormatted = formatSeconds(totalTime);

    let html = `
        <style>
            .report-card { background: #fff; padding: 20px; border-radius: 8px; color: #000; font-family: sans-serif; }
            .report-header h2 { font-size: 1.2rem; color: #F20587; }
            .report-info { margin-bottom: 12px; font-size: 0.9rem; }
            .report-task { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; border-radius: 6px; }
            .task-title { font-weight: bold; color: #333; }
            .evidence-img { max-width: 100px; max-height: 80px; margin-right: 5px; border: 1px solid #eee; object-fit: cover; }
        </style>
        <div class="report-card">
        <div class="report-header" style="text-align:center;">
            <h2>RELATÓRIO DE EXECUÇÃO DITL</h2>
            <p>Sistema de Automação de Tarefas de Satélite</p>
        </div>
        <div class="report-info">
            <p><strong>Operador:</strong> ${escapeHtml(inst.operator)}</p>
            <p><strong>Turno Início:</strong> ${new Date(inst.shiftStart).toLocaleString()}</p>
            <p><strong>Turno Fim:</strong> ${inst.shiftEnd ? new Date(inst.shiftEnd).toLocaleString() : 'Em andamento'}</p>
            <p><strong>Tempo Total Executado:</strong> ${totalTimeFormatted}</p>
        </div>
        <h3>Atividades Registradas:</h3>
        <hr style="border: 1px solid #ccc; margin-bottom: 10px;">
    `;

    inst.tasks.forEach(task => {
        const photosHtml = task.photos.map(p => `<img src="${p}" class="evidence-img">`).join('');
        const taskStatus = task.completed ? (task.success ? 'SUCESSO' : 'FALHA') : 'NÃO CONCLUÍDA';
        
        let timeInfo = `Tempo: ${formatSeconds(task.runtimeSeconds)}`;
        
        if (task.timeMode === 'countdown' && task.targetSeconds > 0) {
             const targetDisplay = secondsToHHMM(task.targetSeconds);
             timeInfo += ` (Máximo: ${targetDisplay}, Modo: Regressiva)`;
        } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
             const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             timeInfo += ` (Janela: ${alertTimeStr} - ${limitTimeStr}, Modo: Programado)`;
        } else {
             timeInfo += ` (Modo: Manual)`;
        }

        html += `
            <div class="report-task">
                <div class="task-title">${escapeHtml(task['Event / Action'])}</div>
                <p><strong>Status:</strong> ${taskStatus} (${timeInfo})</p>
                <p><strong>Operador (Tarefa):</strong> ${escapeHtml(task.operatorTask || 'N/A')}</p>
                <p><strong>Concluído em:</strong> ${task.completedAt ? new Date(task.completedAt).toLocaleTimeString() : 'N/A'}</p>
                <p><strong>Observação:</strong> ${escapeHtml(task.observation || 'Nenhuma')}</p>
                <p><strong>Evidências:</strong></p>
                <div style="display: flex; flex-wrap: wrap;">${photosHtml}</div>
            </div>
        `;
    });
    
    html += `</div>`;

    return html;
}

function generateTaskReportHTML(task, inst) {
    const totalTimeFormatted = formatSeconds(task.runtimeSeconds || 0);

    let photosHtml = task.photos.map(p => `<img src="${p}" class="evidence-img">`).join('');
    const taskStatus = task.completed ? (task.success ? 'SUCESSO' : 'FALHA') : 'NÃO CONCLUÍDA';
    
    let timeInfo = `Tempo: ${formatSeconds(task.runtimeSeconds)}`;
    
    if (task.timeMode === 'countdown' && task.targetSeconds > 0) {
        const targetDisplay = secondsToHHMM(task.targetSeconds);
        timeInfo += ` (Máximo: ${targetDisplay}, Modo: Regressiva)`;
    } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
        const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeInfo += ` (Janela: ${alertTimeStr} - ${limitTimeStr}, Modo: Programado)`;
    } else {
        timeInfo += ` (Modo: Manual)`;
    }

    return `
        <style>
            .report-card { background: #fff; padding: 20px; border-radius: 8px; color: #000; font-family: sans-serif; }
            .report-header h2 { font-size: 1.2rem; color: #F20587; }
            .report-info { margin-bottom: 12px; font-size: 0.9rem; }
            .report-task { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; border-radius: 6px; }
            .task-title { font-weight: bold; color: #333; }
            .evidence-img { max-width: 100px; max-height: 80px; margin-right: 5px; border: 1px solid #eee; object-fit: cover; }
        </style>
        <div class="report-card">
        <div class="report-header" style="text-align:center;">
            <h2>RELATÓRIO DE TAREFA UNITÁRIA DITL</h2>
            <p style="font-size: 0.8rem;">Referente ao Turno de ${new Date(inst.shiftStart).toLocaleDateString()} (Operador: ${escapeHtml(inst.operator)})</p>
        </div>
        <div class="report-info">
            <p><strong>ID da Atividade:</strong> ${escapeHtml(task['Proc. ID'])}</p>
            <p><strong>Evento/Ação:</strong> ${escapeHtml(task['Event / Action'])}</p>
            <p><strong>Status:</strong> ${taskStatus} (${timeInfo})</p>
            <p><strong>Tempo Total Executado:</strong> ${totalTimeFormatted}</p>
        </div>
        <h3>Detalhes da Tarefa:</h3>
        <hr style="border: 1px solid #ccc; margin-bottom: 10px;">
        
        <div class="report-task" style="border-color:${task.success ? '#4CAF50' : '#f44336'};">
            <div class="task-title">${escapeHtml(task['Event / Action'])}</div>
            <p><strong>Operador (Tarefa):</strong> ${escapeHtml(task.operatorTask || 'N/A')}</p>
            <p><strong>Concluído em:</strong> ${task.completedAt ? new Date(task.completedAt).toLocaleTimeString() : 'N/A'}</p>
            <p><strong>Observação:</strong> ${escapeHtml(task.observation || 'Nenhuma')}</p>
            <p><strong>Critério de Aceitação:</strong> ${escapeHtml(task['Key Acceptance Criteria'])}</p>
            <p><strong>Evidências:</strong></p>
            <div style="display: flex; flex-wrap: wrap;">${photosHtml}</div>
        </div>

        </div>
    `;
}

async function downloadTaskPDF(taskId) {
    if (!executingActivity) return showNotification('Nenhum turno ativo.', 3000);
    
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return showNotification('Tarefa não encontrada.', 3000, 'warning');
    
    if (!task.completed) {
        return showNotification('A tarefa deve ser concluída para gerar o relatório unitário.', 3000, 'warning');
    }
    
    const reportHtml = generateTaskReportHTML(task, executingActivity);

    const tempContainer = document.createElement('div');
    tempContainer.id = `report-unitario-${taskId}`;	
    tempContainer.innerHTML = reportHtml;
    // Estilos necessários para posicionamento temporário fora da tela
    tempContainer.style.width = '210mm';	
    tempContainer.style.padding = '10mm';
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';	
    document.body.appendChild(tempContainer);

    const date = new Date(executingActivity.shiftStart).toISOString().slice(0, 10);
    
    try {
        await generatePdfFromElement(tempContainer, `Relatorio_Tarefa_${task['Proc. ID']}_${date}`);
        showNotification('PDF da Tarefa unitária gerado!', 3000);
    } catch (error) {
        console.error("Erro ao gerar PDF unitário:", error);
        showNotification('Erro ao gerar PDF da tarefa. Verifique o console.', 5000, 'critical');
    } finally {
        if (document.body.contains(tempContainer)) {
            document.body.removeChild(tempContainer);
        }
    }
}

function downloadReportPDFFromPreview() {
    if (!currentReportInstanceId) {
        closeReportPreview();
        return;	
    }

    const inst = executions.find(e => e.instanceId === currentReportInstanceId);
    if (!inst) {
        closeReportPreview();
        return;
    }
    
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = generateReportHTML(inst);
    // Estilos necessários para posicionamento temporário fora da tela
    tempContainer.style.width = '210mm';
    tempContainer.style.padding = '10mm';
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    document.body.appendChild(tempContainer);

    const date = new Date(inst.shiftStart).toISOString().slice(0, 10);
    
    generatePdfFromElement(tempContainer, `Relatorio_Turno_${inst.operator}_${date}`).then(() => {
         document.body.removeChild(tempContainer);
         showNotification('PDF do Relatório individual gerado!', 3000);
         closeReportPreview();
    });
}


async function generateFinalReportPDF() {
    const allExecutions = executions;	
    if (allExecutions.length === 0) return showNotification('Nenhuma execução registrada para Relatório Final.', 3000);

    const tempContainer = document.createElement('div');
    // Estilos necessários para renderização
    tempContainer.style.width = '210mm';
    tempContainer.style.padding = '10mm';

    allExecutions.forEach(inst => {
        const reportHtml = generateReportHTML(inst);
        const reportDiv = document.createElement('div');
        reportDiv.innerHTML = reportHtml;
        tempContainer.appendChild(reportDiv);
        
        if (inst !== allExecutions[allExecutions.length - 1]) {
            const hr = document.createElement('hr');
            hr.style.pageBreakAfter = 'always';
            tempContainer.appendChild(hr);
        }
    });

    document.body.appendChild(tempContainer);
    
    await generatePdfFromElement(tempContainer, `Relatorio_Consolidado_DITL_FINAL_COMPLETO_${new Date().toISOString().slice(0, 10)}`);
    
    document.body.removeChild(tempContainer);
    showNotification('Relatório Final (Completo) gerado com sucesso.', 3000);
}


async function generatePdfFromElement(element, filename) {
    showNotification('Gerando PDF... Aguarde.', 3000);
    const { jsPDF } = window.jspdf;
    
    const canvas = await html2canvas(element, {	
        scale: 2,
        scrollY: -window.scrollY
    });	
    
    const imgData = canvas.toDataURL('image/png');
    
    const imgWidth = 210;
    const pageHeight = 295;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    let position = 0;
    
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    let heightLeft = imgHeight - pageHeight;
    
    while (heightLeft > 0) {
        position = -(imgHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
    }
    
    pdf.save(`${filename}.pdf`);
}

function checkDueTasks() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) return;

    const now = new Date();
    const shiftStart = new Date(executingActivity.shiftStart);
    const elapsedShiftSeconds = Math.floor((now.getTime() - shiftStart.getTime()) / 1000);

    let changed = false;

    executingActivity.tasks.forEach(t => {
        if (!t.completed && t.dueSeconds !== null) {
            if (elapsedShiftSeconds > t.dueSeconds) {
                if (!t.due) {
                    t.due = true;
                    changed = true;
                    showNotification(`ATENÇÃO: Tarefa "${t['Event / Action']}" está atrasada em relação ao previsto da planilha!`, 5000, 'warning');
                }
            } else {
                if (t.due) {
                    t.due = false;
                    changed = true;
                }
            }
        }
    });

    if (changed) {
        persistAll();
        renderExecutionTasks();
    }
}

function startScheduledChecker() {
    if (dueCheckerInterval) clearInterval(dueCheckerInterval);
    dueCheckerInterval = setInterval(checkDueTasks, 30000);	
}