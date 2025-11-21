// ==================== VARIÁVEIS GLOBAIS / ESTADO ====================
let currentUser = localStorage.getItem('currentUser') || ''; // Armazena o ID do operador atualmente logado ou em uso. Persistido no localStorage.
let activities = JSON.parse(localStorage.getItem('activities')) || []; // Array de todas as atividades/tarefas importadas da planilha.
let executions = JSON.parse(localStorage.getItem('executions')) || []; // Array de instâncias de execução de turnos (shifts) passadas e ativas.
let executingActivity = null; // Objeto da instância de execução do turno ATIVO atualmente.
const stopwatchIntervals = {}; // Objeto para armazenar os IDs dos setIntervals dos cronômetros de cada tarefa (taskId como chave).
let dueCheckerInterval = null; // ID do setInterval para verificar tarefas atrasadas ('due').
let alertCheckerInterval = null; // ID do setInterval para verificar alertas agendados ('scheduledAlertISO').
let masterClockInterval = null; // ID do setInterval para o relógio mestre (progressivo/regressivo do turno).
let currentTaskToComplete = { taskId: null, success: null }; // Armazena temporariamente o ID da tarefa e o status de conclusão (sucesso/falha) ao abrir o modal de evidências.
let currentReportInstanceId = null; // Armazena o ID da instância de execução ao visualizar um relatório.
let notificationLog = JSON.parse(localStorage.getItem('notificationLog')) || []; // Log de notificações exibidas para o usuário.
let isNotificationPanelOpen = false; // Flag para controlar o estado do painel de notificações.
let parsedData = null; // Armazena os dados da planilha antes do mapeamento.
let headerRow = null; // Armazena a linha de cabeçalho da planilha importada.

// ==================== FUNÇÃO DE GERAÇÃO DE PDF DE ALTA QUALIDADE (COM FALLBACK) ====================

// Armazena a função original se ela existir. No seu caso, a função original está mais abaixo no arquivo,
// mas vamos defini-la como uma função vazia aqui para evitar erros de referência antes da inicialização.
// A função original será definida como `window.generatePdfFromElement` no final do arquivo, e este novo código
// fará o override dela.
const originalGeneratePdfFromElement = async function (element, filename) {
    // Este é um placeholder que será sobrescrito pela função de baixo antes de ser usada como fallback.
    // Em um ambiente de navegador, a função abaixo já teria sido carregada.
    console.warn('[PDF_OVERRIDE_FALLBACK] Chamando fallback de placeholder.');
    throw new Error('Fallback da função original de PDF indisponível ou falhou.');
};

(function () {
    // A nova função faz uma cópia da função original ANTES de fazer o override.
    // Se a função original estiver definida no final do arquivo, ela será referenciada corretamente aqui após o carregamento do script.
    const originalGenerate = window.generatePdfFromElement || originalGeneratePdfFromElement;

    window.generatePdfFromElement = async function (element, filename) {
        console.log('[PDF_OVERRIDE] Iniciando geração de PDF para:', filename);
        try {
            showNotification('Gerando PDF em alta qualidade...', 2500);

            const originalTransform = element.style.transform;
            const originalWidth = element.style.width;

            // 1. Aplica o scale e largura para melhor qualidade do html2canvas
            element.style.transform = "scale(1.35)";
            element.style.transformOrigin = "top left";
            element.style.width = "155mm";

            await new Promise(r => setTimeout(r, 120)); // Aguarda o DOM renderizar o scale

            // 2. Converte o elemento para Canvas com alta escala (scale: 3)
            const canvas = await html2canvas(element, {
                scale: 3,
                useCORS: true,
                scrollY: -window.scrollY
            });

            // 3. Restaura os estilos originais do elemento (crucial para a UI)
            element.style.transform = originalTransform;
            element.style.width = originalWidth;

            const imgData = canvas.toDataURL("image/png");

            // 4. Inicializa o jsPDF, verificando diferentes locais de importação
            const jspdfLib = window.jspdf || window.jsPDF || null;
            let pdf;
            if (jspdfLib && jspdfLib.jsPDF) {
                pdf = new jspdfLib.jsPDF("p", "mm", "a4");
            } else if (typeof window.jsPDF === 'function') {
                pdf = new window.jsPDF("p", "mm", "a4");
            } else {
                throw new Error('jsPDF não encontrado (window.jspdf.jsPDF ou window.jsPDF).');
            }

            const pageHeight = 295; // Altura do A4 em mm
            const imgWidth = 210; // Largura do A4 em mm (para preencher a página)
            const imgHeight = canvas.height * imgWidth / canvas.width;

            let heightLeft = imgHeight;
            let position = 0;

            // 5. Adiciona a primeira imagem (página)
            pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);

            heightLeft -= pageHeight;

            // 6. Loop para adicionar páginas se o conteúdo exceder uma página A4
            while (heightLeft > 0) {
                // A posição deve ser negativa e igual à altura da página * (número de páginas já adicionadas)
                position = heightLeft - imgHeight; 
                pdf.addPage();
                pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            pdf.save(`${filename}.pdf`);
            console.log('[PDF_OVERRIDE] PDF gerado com sucesso:', filename);
            return;
        } catch (err) {
            console.error('[PDF_OVERRIDE] Erro na geração do PDF:', err);
            showNotification('Erro ao gerar PDF (veja console).', 4000, 'critical');
            if (typeof originalGenerate === 'function' && originalGenerate !== originalGeneratePdfFromElement) {
                console.log('[PDF_OVERRIDE] Tentando fallback para generatePdfFromElement original.');
                try {
                    // Executa a função original que estava definida no seu código
                    return await originalGenerate(element, filename); 
                } catch (err2) {
                    console.error('[PDF_OVERRIDE] Fallback também falhou:', err2);
                }
            }
            return;
        }
    };
})();

// ============================================================================================================================


// ==================== PERSISTÊNCIA E INICIALIZAÇÃO ====================

/**
 * @description Salva o estado atual das variáveis globais essenciais no localStorage.
 * Garante que a execução ativa seja atualizada no array 'executions' antes de salvar.
 */
function persistAll() {
    localStorage.setItem('currentUser', currentUser);
    if (executingActivity) {
        const index = executions.findIndex(e => e.instanceId === executingActivity.instanceId);
        if (index !== -1) {
            executions[index] = executingActivity; // Atualiza a instância ativa no array de todas as execuções.
        }
    }
    localStorage.setItem('activities', JSON.stringify(activities));
    localStorage.setItem('executions', JSON.stringify(executions));
    localStorage.setItem('notificationLog', JSON.stringify(notificationLog));
}

/**
 * @description Carrega o estado salvo no localStorage e inicializa a interface.
 * Identifica o turno ativo, renderiza a UI e reinicia cronômetros e checadores.
 */
function loadState() {
    const shiftActiveISO = localStorage.getItem('shiftActiveISO');
    if (shiftActiveISO) {
        // Encontra a instância de execução que estava ativa
        executingActivity = executions.find(e => e.status === 'ativo' && e.shiftStart === shiftActiveISO);
    }
    
    // Mostra o container de atividades se houver dados importados
    if (activities.length > 0) {
        document.getElementById('loadedContainer').classList.remove('hidden');
    }

    // Renderiza o status do turno no cabeçalho
    renderHeaderStatus();
    // Renderiza a lista de instâncias de execução ativas/recentes
    renderExecutionInstances();
    // Atualiza os contadores de atividades e execuções ativas
    updateStats();
    // Renderiza a pré-visualização das atividades importadas
    renderActivityPreview(); 
    // Renderiza o log de notificações no painel
    renderNotificationLog();

    // Restaura a aba ativa do localStorage
    const activeTabId = localStorage.getItem('activeTabId') || 'cadastro';
    const activeTabButton = document.querySelector(`.tab-btn[onclick*='${activeTabId}']`);
    if (activeTabButton) {
        showTab(activeTabId, activeTabButton);
    } else {
        showTab('cadastro', document.querySelector(".tab-btn[onclick*='cadastro']"));
    }

    // Reinicia os cronômetros das tarefas que estavam em execução
    if (executingActivity && executingActivity.tasks) {
        executingActivity.tasks.forEach(task => {
            if (task._stopwatchRunning) {
                startStopwatch(task.id); 
            }
        });
        // Seleciona a instância de execução ativa na aba de Execução
        if (executingActivity.instanceId) {
            selectExecutionInstance(executingActivity.instanceId);
        }
        
        // Reinicia o relógio mestre do turno
        if (executingActivity.status === 'ativo' && executingActivity.ditlTotalSeconds) {
            startMasterClock(executingActivity.ditlTotalSeconds);
        }
    }

    // Inicia os checadores de alertas e atrasos
    startScheduledChecker();
    startAlertChecker();
}

// Ouve o evento de carregamento do DOM para inicializar e configurar o file input
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('evidenceFileInput').addEventListener('change', addPhotosToEvidenceModal);
    loadState();
});

// ==================== UTILITY FUNCTIONS & NOTIFICATIONS ====================

/**
 * @description Exibe uma notificação pop-up e registra a mensagem no log de notificações.
 * @param {string} message - A mensagem a ser exibida.
 * @param {number} duration - Duração em milissegundos (padrão: 3000ms).
 * @param {string} type - Tipo de notificação ('default', 'warning', 'critical').
 */
function showNotification(message, duration = 3000, type = 'default') {
    notificationLog.unshift({
        timestamp: new Date().toISOString(),
        message: message,
        type: type,
        read: false
    });
    notificationLog = notificationLog.slice(0, 50); // Limita o log a 50 itens
    persistAll(); 
    renderNotificationLog(); // Atualiza a contagem e a lista
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    document.body.appendChild(el);
    el.textContent = message;
    setTimeout(() => {
        el.remove();
    }, duration);
}

/**
 * @description Renderiza a lista de notificações e atualiza o contador de mensagens não lidas.
 */
function renderNotificationLog() {
    const logEl = document.getElementById('notificationLog');
    const countEl = document.getElementById('notificationCount');
    logEl.innerHTML = '';
    const unreadCount = notificationLog.filter(item => !item.read).length;
    if (unreadCount > 0) {
        countEl.textContent = unreadCount;
        countEl.style.display = 'flex'; 
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

/**
 * @description Alterna a visibilidade do painel de notificações e marca todas como lidas ao abrir.
 */
function toggleNotificationPanel() {
    const panel = document.getElementById('notificationPanel');
    isNotificationPanelOpen = !isNotificationPanelOpen;
    if (isNotificationPanelOpen) {
        panel.classList.add('open');
        notificationLog.forEach(item => item.read = true); // Marca como lida ao abrir
        persistAll();
        renderNotificationLog();
    } else {
        panel.classList.remove('open');
    }
}

/**
 * @description Limpa todo o log de notificações.
 */
function clearNotificationLog() {
    notificationLog = [];
    persistAll();
    renderNotificationLog();
    showNotification('Log de notificações limpo.', 2000);
}

/**
 * @description Alterna entre as abas da interface (Cadastro, Execução, Relatórios).
 * @param {string} tabId - O ID da aba a ser exibida.
 * @param {HTMLElement} clickedButton - O botão da aba clicado (opcional).
 */
function showTab(tabId, clickedButton) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if (clickedButton) {
        clickedButton.classList.add('active');
        localStorage.setItem('activeTabId', tabId);
    } else {
          document.querySelector(`.tab-btn[onclick*='${tabId}']`)?.classList.add('active');
          localStorage.setItem('activeTabId', tabId);
    }
    // Lógica específica para renderização de conteúdo ao trocar de aba
    if (tabId === 'execucao') {
        renderExecutionInstances();
        if (executingActivity) {
            selectExecutionInstance(executingActivity.instanceId);
        }
    } else if (tabId === 'relatorios') {
        renderAllReports();
    }
}

/**
 * @description Escapa caracteres HTML para prevenir XSS ao renderizar strings.
 * @param {string} str - A string a ser escapada.
 * @returns {string} A string com caracteres HTML substituídos por entidades.
 */
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/**
 * @description Formata uma quantidade total de segundos no formato HH:MM:SS.
 * @param {number} sec - O total de segundos.
 * @returns {string} O tempo formatado.
 */
function formatSeconds(sec) { 
    const totalSecs = Math.max(0, Math.floor(sec)); 
    const mm = Math.floor(totalSecs / 60); 
    const ss = totalSecs % 60; 
    const hh = Math.floor(mm / 60);
    const disp_mm = mm % 60;
    return `${String(hh).padStart(2,'0')}:${String(disp_mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

/**
 * @description Converte uma string de tempo 'hh:mm' (obtida da planilha) para total de segundos.
 * @param {string} timeStr - A string de tempo (ex: "01:30").
 * @returns {number|null} O total de segundos ou null se inválido.
 */
function timeToSeconds(timeStr) {
    if (!timeStr) return null;
    // Tenta extrair a última ocorrência de HH:MM (para planilhas com textos antes)
    const matches = timeStr.match(/(\d{2}):(\d{2})/g);
    if (!matches) return null;
    const lastTimeStr = matches[matches.length - 1];
    const parts = lastTimeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2) {
        const hours = parts[0];
        const minutes = parts[1];
        return (hours * 3600) + (minutes * 60);
    }
    return null;
}

/**
 * @description Converte uma string de tempo 'hh:mm' para total de segundos.
 * Sem a lógica complexa de `timeToSeconds`, focada em ser um conversor simples.
 * @param {string} timeStr - A string de tempo (ex: "01:30").
 * @returns {number} O total de segundos (0 se inválido).
 */
function timeToTotalSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2) { 
        return (parts[0] * 3600) + (parts[1] * 60); 
    }
    return 0;
}

/**
 * @description Converte uma quantidade total de segundos no formato HH:MM.
 * @param {number} totalSeconds - O total de segundos.
 * @returns {string} O tempo formatado.
 */
function secondsToHHMM(totalSeconds) {
    const totalSecs = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(totalSecs / 60);
    const hh = Math.floor(mm / 60);
    const disp_mm = mm % 60;
    return `${String(hh).padStart(2, '0')}:${String(disp_mm).padStart(2, '0')}`;
}

/**
 * @description Converte uma string de hora 'hh:mm' para um objeto Date no futuro.
 * Se a hora já tiver passado no dia de hoje, retorna a hora no dia seguinte.
 * (Usada para agendamento de tarefas em modo "scheduled").
 * @param {string} timeStr - A string de hora (ex: "14:30").
 * @returns {Date} O objeto Date no futuro.
 */
function timeStrToFutureDate(timeStr) {
    const [hh, mm] = timeStr.split(':').map(p => parseInt(p, 10));
    const now = new Date();
    let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if (targetDate.getTime() <= now.getTime()) {
        targetDate.setDate(targetDate.getDate() + 1); // Se já passou hoje, agenda para amanhã
    }
    return targetDate;
}

// ==================== CONTROLE DE USUÁRIO E TURNO ====================

/**
 * @description Atualiza o status do turno no cabeçalho (ativo/encerrado) e os botões.
 */
function renderHeaderStatus() {
    const shiftActiveISO = localStorage.getItem('shiftActiveISO');
    const shiftStatusEl = document.getElementById('shiftStatus');
    const btnStart = document.getElementById('btnStartShift');
    const btnEnd = document.getElementById('btnEndShift');
    // Adicionar o botão Reiniciar turno
    const btnReset = document.getElementById('btnResetShift');
    
    if (shiftActiveISO) {
        const operatorName = executingActivity ? executingActivity.operator : 'N/A';
        shiftStatusEl.textContent = `Turno ATIVO desde: ${new Date(shiftActiveISO).toLocaleString()} (Operador: ${operatorName})`;
        btnStart.disabled = true;
        btnEnd.disabled = false;
        // Habilita se houver um turno ATIVO
        btnReset.disabled = false; 
    } else {
        shiftStatusEl.textContent = 'Turno encerrado ou não iniciado.';
        // O botão Iniciar deve verificar se há atividades importadas
        btnStart.disabled = activities.length === 0; 
        btnEnd.disabled = true;
        // Desabilita se não houver turno ATIVO
        btnReset.disabled = true; 
    }
}

/**
 * @description Inicia um novo turno de execução de atividades.
 * Cria a instância de execução, configura o relógio mestre e inicia a primeira tarefa.
 */
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
    
    // Calcula a duração máxima do turno (o último T + (hh:mm)) para o relógio mestre
    let maxSeconds = 0;
    activities.forEach(t => {
        const seconds = timeToSeconds(t['T + (hh:mm)']); 
        if (seconds !== null && seconds > maxSeconds) {
            maxSeconds = seconds;
        }
    });

    // Cria o objeto da nova execução
    executingActivity = {
        instanceId: `INST-${Date.now()}`,
        operator: currentUser || 'N/A',
        shiftStart: startTime,
        shiftEnd: null,
        status: 'ativo',
        ditlTotalSeconds: maxSeconds,
        // Inicializa as tarefas a partir das atividades
        tasks: activities.map(t => ({
            ...t,
            id: `TASK-${Date.now()}-${Math.random()}`,
            status: 'pendente',
            runtimeSeconds: 0,
            targetSeconds: timeToSeconds(t['T + (hh:mm)']) || 0,
            scheduledAlertISO: null, // Campo para alerta agendado
            scheduledLimitISO: null, // Campo para limite agendado
            timeMode: 'countdown', // Modo de contagem (padrão regressiva, pode ser 'manual' ou 'scheduled')
            _stopwatchRunning: false,
            _stopwatchStart: null,
            _nextTaskAlertShown: false,
            completed: false,
            completedAt: null,
            photos: [],
            operatorTask: '',
            observation: '',
            due: false, // Indica se a tarefa está atrasada em relação ao T+ da planilha
            alerted: false, // Indica se o alerta agendado já foi mostrado
            dueSeconds: timeToSeconds(t['T + (hh:mm)']) // Tempo previsto da planilha em segundos
        }))
    };
    executions.push(executingActivity);
    persistAll();

    renderHeaderStatus();
    selectExecutionInstance(executingActivity.instanceId); 
    
    // Mudar para a aba de execução
    const execButton = document.querySelector(".tab-btn[onclick*='execucao']");
    showTab('execucao', execButton);

    updateStats();
    
    // Inicia o relógio mestre
    startMasterClock(maxSeconds);

    // Inicia automaticamente o cronômetro da primeira tarefa
    const firstTask = executingActivity.tasks[0];
    if (firstTask) {
        startStopwatch(firstTask.id); 
        showNotification(`Turno iniciado! Tarefa '${firstTask['Event / Action']}' iniciada automaticamente.`, 4000);
    } else {
        showNotification('Turno iniciado! Nenhuma tarefa encontrada para iniciar.', 3000, 'warning');
    }
}

/**
 * @description Abre o modal de confirmação para reiniciar o turno.
 */
function openResetShiftConfirmation() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) {
        showNotification('Nenhum turno ativo para reiniciar.', 3000);
        return;
    }
    document.getElementById('confirmResetShiftModal').classList.remove('hidden');
}

/**
 * @description Fecha o modal de confirmação para reiniciar o turno.
 */
function closeResetShiftConfirmation() {
    document.getElementById('confirmResetShiftModal').classList.add('hidden');
}

/**
 * @description Reinicia o turno ATIVO atual (deleta a instância e inicia uma nova).
 * Preserva as atividades (DITL) importadas.
 */
function confirmResetShift() {
    closeResetShiftConfirmation();
    
    if (executingActivity === null) return;

    // 1. Pausa e limpa o relógio mestre e cronômetros
    executingActivity.tasks.forEach(task => {
        if (task._stopwatchRunning) {
            pauseStopwatch(task.id); 
        }
    });
    if (masterClockInterval) clearInterval(masterClockInterval);
    masterClockInterval = null;
    
    // 2. Remove a instância de execução ATIVA do array 'executions'
    const index = executions.findIndex(e => e.instanceId === executingActivity.instanceId);
    if (index !== -1) {
        executions.splice(index, 1); // Remove a instância
    }

    // 3. Limpa o estado ativo global
    localStorage.removeItem('shiftActiveISO');
    executingActivity = null;
    persistAll();
    
    // 4. Inicia um novo turno automaticamente com as mesmas atividades importadas
    startShift(); 
    showNotification('Turno reiniciado com sucesso! Uma nova instância de execução foi criada.', 5000, 'warning');
}

/**
 * @description Chama a função para abrir o modal de confirmação de reinício.
 */
function resetCurrentShift() {
    openResetShiftConfirmation();
}

/**
 * @description Abre o modal de confirmação para encerrar o turno.
 * Se todas as tarefas estiverem concluídas, encerra diretamente.
 */
function openEndShiftConfirmation() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) {
        showNotification('Nenhum turno ativo para encerrar.', 3000);
        return;
    }
    const nonCompleted = executingActivity.tasks.filter(t => !t.completed).length;
    if (nonCompleted === 0) {
        confirmEndShift(false); // Não forçado, pois todas estão concluídas
        return;
    }
    document.getElementById('pendingTaskMessage').innerHTML = `Ainda há ${nonCompleted} tarefas não concluídas. Deseja encerrar o turno e gerar o relatório mesmo assim?`;
    document.getElementById('confirmEndShiftModal').classList.remove('hidden');
}

/**
 * @description Fecha o modal de confirmação para encerrar o turno.
 */
function closeEndShiftConfirmation() {
    document.getElementById('confirmEndShiftModal').classList.add('hidden');
}

/**
 * @description Finaliza o turno de execução, pausando cronômetros e limpando o estado.
 * @param {boolean} wasForced - Indica se o encerramento foi forçado (com tarefas pendentes).
 */
function confirmEndShift(wasForced) {
    closeEndShiftConfirmation();
    
    if (executingActivity === null) return;

    // Pausa todos os cronômetros ativos
    executingActivity.tasks.forEach(task => {
        if (task._stopwatchRunning) {
            pauseStopwatch(task.id); 
        }
    });

    // Para o relógio mestre e limpa a exibição
    if (masterClockInterval) clearInterval(masterClockInterval);
    masterClockInterval = null;
    document.getElementById('masterClockTime').textContent = '--:--:--';
    document.getElementById('masterClockTime').style.color = '#fff';
    document.getElementById('elapsedClockTime').textContent = '--:--:--';
    document.getElementById('elapsedClockTime').style.color = '#fff';


    // Atualiza o estado da execução
    executingActivity.shiftEnd = new Date().toISOString();
    executingActivity.status = 'concluido';
    localStorage.removeItem('shiftActiveISO');

    persistAll();
    executingActivity = null;
    
    renderHeaderStatus();
    updateStats(); 
    
    // Mudar para a aba de relatórios
    const reportButton = document.querySelector(".tab-btn[onclick*='relatorios']");
    showTab('relatorios', reportButton);

    showNotification('Turno encerrado com sucesso. Relatório gerado!', 4000);
}

/**
 * @description Chama a função para abrir o modal de confirmação de encerramento.
 */
function endShift() {
    openEndShiftConfirmation();
}

/**
 * @description Abre o modal de confirmação para limpar todos os dados.
 */
function clearAllData() {
    document.getElementById('confirmClearDataModal').classList.remove('hidden');
}

/**
 * @description Fecha o modal de confirmação para limpar todos os dados.
 */
function closeClearDataConfirmation() {
    document.getElementById('confirmClearDataModal').classList.add('hidden');
}

/**
 * @description Limpa todo o localStorage e recarrega a página.
 */
function confirmClearAllData() {
    closeClearDataConfirmation();
    localStorage.clear();
    location.reload(); 
}

// ==================== RELÓGIO MESTRE (ATUALIZADO) ====================

/**
 * @description Inicia os cronômetros (progressivo e regressivo) no cabeçalho.
 * O relógio regressivo usa a duração total (`totalDurationInSeconds`) calculada no início do turno.
 * O relógio progressivo conta o tempo desde o início do turno.
 * @param {number} totalDurationInSeconds - Duração total do DITL em segundos (base para o regressivo).
 */
function startMasterClock(totalDurationInSeconds) {
    if (masterClockInterval) clearInterval(masterClockInterval);

    const clockElRegressive = document.getElementById('masterClockTime');
    const clockElProgressive = document.getElementById('elapsedClockTime');
    
    if (!executingActivity || executingActivity.status !== 'ativo') {
        clockElRegressive.textContent = '--:--:--';
        clockElProgressive.textContent = '--:--:--';
        return;
    }

    const shiftStart = new Date(executingActivity.shiftStart).getTime();

    masterClockInterval = setInterval(() => {
        // Garantias
        if (!executingActivity || executingActivity.status !== 'ativo') {
             clearInterval(masterClockInterval);
             masterClockInterval = null;
             return;
        }

        const now = new Date().getTime();
        const elapsedSeconds = Math.floor((now - shiftStart) / 1000); // Progressivo
        const remainingSeconds = totalDurationInSeconds - elapsedSeconds; // Regressivo

        // Atualiza os DOIS relógios
        clockElProgressive.textContent = formatSeconds(elapsedSeconds);
        clockElRegressive.textContent = formatSeconds(remainingSeconds);

        // Mudar a cor do relógio REGRESSIVO (indicando proximidade/estouro)
        if (remainingSeconds < 0) {
            clockElRegressive.style.color = '#f44336'; // Vermelho (estourado)
        } else if (remainingSeconds < 60) {
            clockElRegressive.style.color = '#FFD54F'; // Amarelo (último minuto)
        } else {
            clockElRegressive.style.color = '#fff'; // Cor padrão
        }
        
        // Cor do progressivo
        clockElProgressive.style.color = '#fff';

    }, 1000);
}

// ==================== LÓGICA DO CRONÔMETRO E FLUXO DE TAREFAS ====================

/**
 * @description Inicia o cronômetro para uma tarefa.
 * Impede que mais de um cronômetro de tarefa esteja ativo ao mesmo tempo.
 * @param {string} taskId - O ID da tarefa.
 */
function startStopwatch(taskId) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;
    // Verifica se outra tarefa já está em execução
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
    task._stopwatchStart = new Date().getTime(); // Registra o tempo de início da sessão atual
    task.status = 'em execução';
    task.due = false; // Reinicia o status de atraso ao iniciar/retomar
    persistAll();
    updateExecutionTaskUI(taskId);

    // Inicia o intervalo de atualização do cronômetro da tarefa
    stopwatchIntervals[taskId] = setInterval(() => {
        const now = new Date().getTime();
        // Duração da sessão atual do cronômetro
        const sessionElapsedSeconds = Math.floor((now - task._stopwatchStart) / 1000); 
        // Tempo total, incluindo sessões anteriores
        const totalElapsed = (task.runtimeSeconds || 0) + sessionElapsedSeconds; 
        const el = document.getElementById(`timer-${taskId}`);
        if (!el) return;

        let elapsedText = '';
        let targetText = '';
        let elapsedColor = '';

        // Lógica de exibição com base no modo de tempo
        if (task.timeMode === 'countdown') {
            const timeLeft = task.targetSeconds - totalElapsed;
            const displayTime = formatSeconds(Math.abs(timeLeft));
            elapsedText = timeLeft >= 0 ? `Restante: ${displayTime}` : `ATRASO: ${displayTime}`;
            elapsedColor = timeLeft >= 0 ? '#F27EBE' : '#f44336';
            const targetTime = secondsToHHMM(task.targetSeconds);
            targetText = `Máximo: ${targetTime} (Regressiva)`;

            // Alerta de tarefa seguinte (últimos 10 segundos)
            if (timeLeft <= 10 && timeLeft > 0 && !task._nextTaskAlertShown) {
                task._nextTaskAlertShown = true; 
                const currentIndex = executingActivity.tasks.findIndex(t => t.id === task.id);
                if (currentIndex !== -1 && (currentIndex + 1) < executingActivity.tasks.length) {
                    const nextTask = executingActivity.tasks[currentIndex + 1];
                    if (nextTask && !nextTask.completed) {
                        showNextTaskBanner(nextTask['Event / Action']); // Exibe o banner
                    }
                }
            }
        } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
            // Lógica para modo agendado
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
            // Lógica para modo manual (cronômetro progressivo)
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

/**
 * @description Pausa o cronômetro de uma tarefa.
 * Calcula e armazena o tempo decorrido da sessão atual em `runtimeSeconds`.
 * @param {string} taskId - O ID da tarefa.
 */
function pauseStopwatch(taskId) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task || !task._stopwatchRunning) return;

    // Para o intervalo de atualização
    clearInterval(stopwatchIntervals[taskId]);
    delete stopwatchIntervals[taskId];

    // Calcula a duração da sessão e adiciona ao tempo total
    const sessionDurationSeconds = Math.floor((new Date().getTime() - task._stopwatchStart) / 1000);
    task.runtimeSeconds = (task.runtimeSeconds || 0) + sessionDurationSeconds;

    task._stopwatchRunning = false;
    task._stopwatchStart = null;
    task.status = 'pendente'; // Altera o status
    persistAll();
    updateExecutionTaskUI(taskId); // Atualiza a UI para refletir a pausa
    showNotification(`Tarefa pausada: ${task['Event / Action']}.`, 2000, 'warning');
}

/**
 * @description Para o cronômetro (se ativo) e abre o modal de evidências para conclusão.
 * @param {string} taskId - O ID da tarefa.
 * @param {boolean} success - O status de sucesso/falha da conclusão.
 */
function stopAndComplete(taskId, success) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    if (task._stopwatchRunning) {
        pauseStopwatch(taskId); // Pausa primeiro se estiver em execução
    }

    openEvidenceModal(taskId, success);
}

/**
 * @description Verifica tarefas em modo 'scheduled' cujos horários de alerta foram atingidos.
 * (Função temporariamente não usada, o alerta agendado é verificado em `startStopwatch` e `updateExecutionTaskUI` no código fornecido.)
 * ATUALIZAÇÃO: No código fornecido, a verificação do limite de tempo (`due`) é feita em `checkDueTasks`,
 * e a verificação do alerta agendado (`alerted`) é feita nesta função.
 */
function checkScheduledAlerts() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) return;
    const now = new Date().getTime();
    let changed = false;
    executingActivity.tasks.forEach(t => {
        // Verifica se é uma tarefa programada, não concluída e com um horário de alerta
        if (!t.completed && t.timeMode === 'scheduled' && t.scheduledAlertISO) {
            const alertTime = new Date(t.scheduledAlertISO).getTime(); 
            // Se o horário de alerta foi atingido e o alerta ainda não foi exibido
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

/**
 * @description Inicia o intervalo de verificação de alertas agendados (a cada 5 segundos).
 */
function startAlertChecker() {
    if (alertCheckerInterval) clearInterval(alertCheckerInterval);
    alertCheckerInterval = setInterval(checkScheduledAlerts, 5000); 
}

// ==================== MODAL DE EVIDÊNCIAS (MODIFICADO) ====================

/**
 * @description Abre o modal para coleta de evidências (ID do operador, observação e fotos) antes da conclusão.
 * @param {string} taskId - O ID da tarefa a ser concluída.
 * @param {boolean} success - Indica se a conclusão é com sucesso ou falha.
 */
function openEvidenceModal(taskId, success) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    currentTaskToComplete = { taskId, success }; // Armazena o estado da conclusão
    document.getElementById('evidenceModalTaskName').textContent = task['Event / Action'];
    document.getElementById('evidenceModalObservation').value = task.observation || ''; 
    const operatorInput = document.getElementById('evidenceModalOperatorId');
    operatorInput.value = task.operatorTask || currentUser || ''; // Preenche com o último operador ou currentUser
    const btn = document.getElementById('evidenceSubmitButton');
    btn.textContent = success ? 'Concluir com SUCESSO' : 'Concluir com FALHA';
    btn.style.background = success ? '#4CAF50' : '#f44336';

    renderEvidencePhotoPreview(task.photos); // Exibe as fotos existentes
    document.getElementById('evidenceModal').classList.remove('hidden');

    // Foco automático no campo
    if (operatorInput.value === '') {
        operatorInput.focus();
    } else {
        document.getElementById('evidenceModalObservation').focus();
    }
}

/**
 * @description Fecha o modal de evidências e limpa o estado temporário.
 */
function closeEvidenceModal() {
    document.getElementById('evidenceModal').classList.add('hidden');
    currentTaskToComplete = { taskId: null, success: null };
    document.getElementById('evidenceFileInput').value = ''; // Limpa o input de arquivo
}

/**
 * @description Renderiza as miniaturas das fotos de evidência no modal.
 * @param {Array<string>} photos - Array de DataURLs das fotos.
 */
function renderEvidencePhotoPreview(photos) {
    const previewEl = document.getElementById('evidencePhotoPreview');
    previewEl.innerHTML = '';
    const maxPhotos = 3;
    photos.forEach((dataURL, index) => {
        // Renderiza cada miniatura com um botão de exclusão
        const photoContainerHtml = `
            <div style="position: relative; display: inline-block;">
                <img src="${dataURL}" class="img-preview" style="display:block; margin-right:5px; max-width:80px; max-height:60px; border-radius:4px;">
                <button class="btn-small btn-secondary" onclick="removePhotoFromEvidenceModal('${currentTaskToComplete.taskId}', ${index})" style="position: absolute; top: 0; right: 0; padding: 2px 4px; background: rgba(244, 67, 54, 0.8); color: #fff; line-height: 1; font-size: 10px; transform: none;">❌</button>
            </div>
        `;
        previewEl.insertAdjacentHTML('beforeend', photoContainerHtml);
    });
    // Controla o botão "Adicionar foto"
    const addButton = document.querySelector('#evidenceModal .btn-secondary');
    if (photos.length >= maxPhotos) {
        addButton.setAttribute('disabled', 'disabled');
        addButton.textContent = `Limite de ${maxPhotos} fotos atingido`;
    } else {
        addButton.removeAttribute('disabled');
        addButton.textContent = 'Adicionar foto';
    }
}

/**
 * @description Processa e adiciona fotos selecionadas pelo usuário ao array de evidências da tarefa.
 * Converte as imagens em DataURLs. Limita a 3 fotos no total.
 */
function addPhotosToEvidenceModal() {
    const taskId = currentTaskToComplete.taskId;
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;
    const files = Array.from(document.getElementById('evidenceFileInput').files);
    const maxAllowed = 3 - task.photos.length;
    const filesToAdd = files.slice(0, maxAllowed); // Limita as fotos
    if (filesToAdd.length === 0) {
        document.getElementById('evidenceFileInput').value = '';
        return;
    }
    let filesProcessed = 0;
    const totalFiles = filesToAdd.length;
    filesToAdd.forEach(f => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            task.photos.push(ev.target.result); // Adiciona a foto como DataURL
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

/**
 * @description Remove uma foto de evidência da tarefa.
 * @param {string} taskId - O ID da tarefa.
 * @param {number} index - O índice da foto no array `task.photos`.
 */
function removePhotoFromEvidenceModal(taskId, index) {
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task || index < 0 || index >= task.photos.length) return;
    task.photos.splice(index, 1);
    persistAll();
    renderEvidencePhotoPreview(task.photos); // Renderiza a pré-visualização novamente
}

/**
 * @description Finaliza a tarefa, salvando evidências e movendo para a próxima tarefa.
 * Valida o ID do operador e a observação.
 */
function submitEvidenceAndComplete() {
    const { taskId, success } = currentTaskToComplete;
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return;

    const operatorInput = document.getElementById('evidenceModalOperatorId');
    const operatorId = operatorInput.value.trim();
    const observation = document.getElementById('evidenceModalObservation').value.trim();

    // Validações
    if (operatorId === '') {
        showNotification('O ID do operador é obrigatório para finalizar.', 3000, 'warning');
        operatorInput.focus();
        return;
    }
    if (observation === '') {
        showNotification('A descrição/observação é obrigatória.', 3000, 'warning');
        document.getElementById('evidenceModalObservation').focus();
        return;
    }

    // Atualiza o estado da tarefa
    task.operatorTask = operatorId;
    currentUser = operatorId; // Atualiza o usuário atual
    localStorage.setItem('currentUser', currentUser);
    
    // Atualiza o operador do turno se ainda for 'N/A'
    if (executingActivity.operator === 'N/A' || executingActivity.operator === '') {
        executingActivity.operator = operatorId;
        renderHeaderStatus(); 
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
    
    // Inicia automaticamente a próxima tarefa se houver
    const currentIndex = executingActivity.tasks.findIndex(t => t.id === taskId);
    if (currentIndex !== -1 && (currentIndex + 1) < executingActivity.tasks.length) {
        const nextTask = executingActivity.tasks[currentIndex + 1];
        if (nextTask && !nextTask.completed && !nextTask._stopwatchRunning) {
            startStopwatch(nextTask.id);
            showNotification(`Próxima tarefa iniciada: ${nextTask['Event / Action']}`, 3000);
        }
    } else {
        // Se for a última tarefa, sugere encerrar o turno
        showNotification('Todas as tarefas da sequência foram concluídas!', 4000);
        openEndShiftConfirmation();
    }
}


// ===== NOVAS FUNÇÕES DO BANNER =====
/**
 * @description Exibe o banner de alerta para a próxima tarefa iminente.
 * @param {string} nextTaskName - O nome da próxima tarefa.
 */
function showNextTaskBanner(nextTaskName) {
    const modal = document.getElementById('nextTaskModal');
    const nameEl = document.getElementById('nextTaskNameDisplay');
    nameEl.textContent = nextTaskName;
    modal.classList.remove('hidden');
}

/**
 * @description Oculta o banner de alerta de próxima tarefa.
 */
function hideNextTaskBanner() {
    const modal = document.getElementById('nextTaskModal');
    modal.classList.add('hidden');
}
// ====================================

/**
 * @description Atualiza os contadores de atividades totais e execuções ativas no painel de estatísticas.
 */
function updateStats() {
    const totalActivities = activities.length;
    const activeExecutions = executions.filter(e => e.status === 'ativo').length;
    const totalActivitiesEl = document.getElementById('totalActivities');
    const activeActivitiesEl = document.getElementById('activeActivities');
    if (totalActivitiesEl) totalActivitiesEl.textContent = totalActivities;
    if (activeActivitiesEl) activeActivitiesEl.textContent = activeExecutions;
}

/**
 * @description Renderiza a lista de instâncias de execução ativas (ou recentes) na aba "Execução".
 */
function renderExecutionInstances() {
    const listEl = document.getElementById('activityList');
    listEl.innerHTML = '';
    const allExecutions = executions.sort((a, b) => new Date(b.shiftStart) - new Date(a.shiftStart));
    const activeExecutions = allExecutions.filter(e => e.status === 'ativo');
    
    // Mensagens de estado vazio
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
    
    // Renderiza os cartões das execuções ativas
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

/**
 * @description Define a instância de execução atual (`executingActivity`) e atualiza a UI da aba "Execução".
 * @param {string} instanceId - O ID da instância a ser selecionada.
 */
function selectExecutionInstance(instanceId) {
    executingActivity = executions.find(e => e.instanceId === instanceId);
    if (!executingActivity) return;
    const panel = document.getElementById('executionPanel');
    const title = document.getElementById('executionTitle');
    const executionFilterEl = document.getElementById('executionFilter');
    if (executionFilterEl) executionFilterEl.value = 'todos'; // Reset do filtro
    title.textContent = `Executando: Turno de ${new Date(executingActivity.shiftStart).toLocaleDateString()} (Operador: ${executingActivity.operator})`;
    panel.classList.remove('hidden');
    updateProgress(); // Atualiza a barra de progresso
    renderExecutionTasks(); // Renderiza a lista de tarefas da instância
    renderExecutionInstances(); // Atualiza a lista de instâncias para destacar a selecionada
}

/**
 * @description Atualiza a barra de progresso do turno ativo.
 */
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

/**
 * @description Renderiza as tarefas do turno ativo, aplicando o filtro selecionado.
 * Chama `updateExecutionTaskUI` para cada tarefa.
 */
function renderExecutionTasks() {
    if (!executingActivity) return;
    const listEl = document.getElementById('executionTasks');
    listEl.innerHTML = '';
    const filterValue = document.getElementById('executionFilter')?.value || 'todos';
    
    // Lógica de filtragem
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

    // Cria/atualiza o elemento HTML para cada tarefa filtrada
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

/**
 * @description Atualiza a representação visual (HTML) de uma única tarefa na lista de execução.
 * Esta função é chamada a cada segundo se o cronômetro estiver ativo e sempre que o estado muda.
 * @param {string} taskId - O ID da tarefa a ser atualizada.
 */
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
    const isPending = !isRunning && !isCompleted && !isPaused; 

    let buttonsHtml = '';
    let statusText = '';
    let statusColor = ''; 
    let elapsedText = '';
    let targetText = '';
    let elapsedColor = '';

    // Lógica de status e botões
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
            <button class="btn-small" onclick="startStopwatch('${task.id}')">Retomar</button>
            <button class="btn-small" style="background:#4CAF50" onclick="stopAndComplete('${task.id}', true)">SUCESSO</button>
            <button class="btn-small" style="background:#f44336" onclick="stopAndComplete('${task.id}', false)">FALHA</button>
        `;
    } else { 
        statusText = isDue ? 'PENDENTE (ATRASADO)' : 'NÃO INICIADA';
        statusColor = isDue ? '#f44336' : '#F27EBE';
        // A próxima tarefa na sequência deve ter um botão de "Iniciar", mas o código não implementa essa lógica, mantendo "Em espera"
        buttonsHtml = `<button class="btn-small btn-secondary" disabled>Em espera</button>`; 
    }

    // Lógica de exibição de tempo (fora do setInterval)
    if (isRunning) {
        // Se estiver rodando, o tempo é atualizado pelo setInterval, mas a inicialização dos textos de "target" deve ser feita aqui.
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
        // Se estiver pausado, concluído ou pendente, calcula o tempo estático
        elapsedColor = isCompleted ? '#4CAF50' : (isPaused || isDue ? statusColor : '#F27EBE');
        
        if (task.timeMode === 'countdown' && task.targetSeconds > 0) {
            // Contagem regressiva estática
            const timeLeft = task.targetSeconds - (task.runtimeSeconds || 0);
            const displayTime = formatSeconds(Math.abs(timeLeft));
            const pauseText = isPaused ? '(Pausado)' : (isPending ? '(Não iniciado)' : '');
            elapsedText = timeLeft >= 0 ? `Restante: ${displayTime} ${pauseText}` : `ATRASO: ${displayTime} ${pauseText}`;
            elapsedColor = timeLeft >= 0 ? elapsedColor : '#f44336';
            const targetTime = secondsToHHMM(task.targetSeconds);
            targetText = `Máximo: ${targetTime} (Regressiva)`;
        } else if (task.timeMode === 'scheduled' && task.scheduledLimitISO) {
            // Agendado estático
             const nowTime = new Date().getTime();
             const scheduledTime = new Date(task.scheduledLimitISO).getTime();
             const timeLeftSeconds = Math.floor((scheduledTime - nowTime) / 1000);
             const displayTime = formatSeconds(Math.abs(timeLeftSeconds));
             const pauseText = isPaused ? '(Pausado)' : (isPending ? '(Não iniciado)' : '');
             elapsedText = timeLeftSeconds >= 0 ? `Faltam: ${displayTime} ${pauseText}` : `ATRASO: ${displayTime} ${pauseText}`;
             elapsedColor = timeLeftSeconds >= 0 ? elapsedColor : '#f44336';
             const alertTimeStr = new Date(task.scheduledAlertISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             const limitTimeStr = new Date(task.scheduledLimitISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             targetText = `Janela: ${alertTimeStr} - ${limitTimeStr} (Programado)`;
        } else {
            // Manual estático
            elapsedText = `Decorrido: ${formatSeconds(task.runtimeSeconds)}`;
            targetText = `Previsão: ${escapeHtml(task['T + (hh:mm)'] || '--:--')} (Manual)`;
        }
    }

    // Atualiza o HTML da tarefa
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

/**
 * @description Filtra e renderiza as atividades na aba "Cadastro" (Preview).
 */
function filterActivities() {
    renderActivityPreview();
}

/**
 * @description Renderiza a lista de atividades importadas na aba "Cadastro", aplicando um filtro de busca.
 */
function renderActivityPreview() {
    const listEl = document.getElementById('taskPreview');
    const searchInput = document.getElementById('searchActivitiesInput');
    const filterText = searchInput ? searchInput.value.toLowerCase() : '';

    // Lógica de filtragem por texto
    const filteredActivities = activities.filter(t => 
        t['Event / Action'].toLowerCase().includes(filterText) ||
        t['Proc. ID'].toLowerCase().includes(filterText) ||
        filterText === ''
    );

    if (filteredActivities.length === 0) {
        listEl.innerHTML = `<div class="small text-center p-12">Nenhuma atividade corresponde ao filtro.</div>`;
        return;
    }

    // Renderiza a lista de preview
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

/**
 * @description Baixa todas as fotos de evidência de todas as execuções em um arquivo ZIP.
 * Depende de uma biblioteca `JSZip` externa.
 */
async function downloadAllImagesZip() {
    if (executions.length === 0) return showNotification('Nenhuma imagem registrada para download.', 2000);
    const zip = new JSZip();
    let fileCount = 0;

    // Itera sobre execuções, tarefas e fotos para adicionar ao ZIP
    executions.forEach(inst => {
        inst.tasks.forEach(task => {
            task.photos.forEach((dataURL, index) => {
                const base64Data = dataURL.split(',')[1]; // Remove o prefixo data:image/...
                const fileName = `${inst.operator}_${inst.instanceId.split('-')[1]}_${task.id.split('-')[2]}_${index + 1}.png`;
                zip.file(fileName, base64Data, { base64: true }); // Adiciona ao ZIP
                fileCount++;
            });
        });
    });

    if (fileCount === 0) return showNotification('Nenhuma imagem registrada para download.', 2000);

    showNotification(`Gerando ZIP com ${fileCount} imagens...`, 2000);
    const content = await zip.generateAsync({ type: "blob" }); // Gera o arquivo ZIP
    const date = new Date().toISOString().slice(0, 10);
    
    // Inicia o download
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `Evidencias_DITL_${date}.zip`;
    a.click();
    URL.revokeObjectURL(a.href); 
    showNotification('Download do ZIP concluído!', 2000);
}

/**
 * @description Lida com a seleção de um arquivo de planilha (XLSX).
 * Lê o arquivo, extrai os dados e inicia o modal de mapeamento.
 * Depende de uma biblioteca `XLSX` externa.
 * @param {Event} event - O evento de seleção de arquivo.
 */
function onFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        parsedData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }); // Lê como array de arrays
        
        if (parsedData.length === 0) return showNotification('Arquivo vazio ou inválido.', 3000, 'warning');
        
        headerRow = parsedData.shift(); // Remove e armazena o cabeçalho
        setupMappingModal();
    };
    reader.readAsArrayBuffer(file);
}

/**
 * @description Configura o modal de mapeamento de colunas da planilha para as propriedades de atividade.
 * Preenche os selects com os cabeçalhos da planilha e tenta selecionar os valores padrão.
 */
function setupMappingModal() {
    const modal = document.getElementById('mappingModal');
    const requiredMaps = ['mapTime', 'mapProc', 'mapEvent', 'mapAction', 'mapAcceptance'];
    
    // Preenche os selects com as colunas da planilha
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
    
    // Adiciona a opção "Não usar"
    requiredMaps.forEach(id => {
        const selectEl = document.getElementById(id);
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '— Não usar —';
        selectEl.prepend(emptyOption);
    });

    // Tenta pré-selecionar colunas com base no texto do cabeçalho
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

    // Exibe a pré-visualização dos dados
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

/**
 * @description Confirma o mapeamento e importa as atividades da planilha para o array `activities`.
 */
function confirmImport() {
    // Mapeia os valores dos selects para os índices das colunas
    const map = {
        'T + (hh:mm)': document.getElementById('mapTime').value,
        'Proc. ID': document.getElementById('mapProc').value,
        'Event': document.getElementById('mapEvent').value,
        'Event / Action': document.getElementById('mapAction').value,
        'Key Acceptance Criteria': document.getElementById('mapAcceptance').value
    };
    
    // Cria o array de objetos `activities` usando o mapeamento
    activities = parsedData.map(row => ({
        'T + (hh:mm)': row[map['T + (hh:mm)']] || '',
        'Proc. ID': row[map['Proc. ID']] || '',
        'Event': row[map['Event']] || '',
        'Event / Action': row[map['Event / Action']] || '',
        'Key Acceptance Criteria': row[map['Key Acceptance Criteria']] || ''
    })).filter(t => t['Event / Action']); // Filtra tarefas sem nome

    persistAll();
    cancelMapping();
    document.getElementById('loadedSummary').textContent = `${activities.length} atividades importadas com sucesso.`;
    document.getElementById('loadedContainer').classList.remove('hidden');
    updateStats();
    renderActivityPreview();
    showNotification('Planilha importada com sucesso!', 3000);
    renderHeaderStatus();
}

/**
 * @description Fecha o modal de mapeamento.
 */
function cancelMapping() {
    document.getElementById('mappingModal').classList.add('hidden');
}

/**
 * @description Baixa o estado atual do aplicativo (usuário, atividades, execuções) em um arquivo JSON de backup.
 */
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
    
    // Inicia o download
    const a = document.createElement('a');
    a.href = url;
    a.download = `DITL_Backup_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Dados exportados para JSON.', 2000);
}

/**
 * @description Renderiza a lista de relatórios de execuções (turnos) na aba "Relatórios", aplicando o filtro de status.
 */
function renderAllReports() {
    const reportListEl = document.getElementById('reportList');
    reportListEl.innerHTML = '';
    const filterValue = document.getElementById('reportFilter').value;
    
    // Ordena por data de início do turno
    let filteredExecutions = executions.sort((a, b) => new Date(b.shiftStart) - new Date(a.shiftStart));
    
    // Aplica o filtro de status
    if (filterValue !== 'todos') {
        filteredExecutions = filteredExecutions.filter(e => e.status === filterValue);
    }
    
    if (filteredExecutions.length === 0) {
        reportListEl.innerHTML = `<div class="small text-center">Nenhum relatório encontrado com o filtro atual.</div>`;
        return;
    }

    // Renderiza cada relatório (turno) como um item de lista
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

/**
 * @description Abre o modal de pré-visualização de um relatório de turno completo.
 * @param {string} instanceId - O ID da instância de execução.
 */
function previewReport(instanceId) {
    const inst = executions.find(e => e.instanceId === instanceId);
    if (!inst) return;

    currentReportInstanceId = instanceId; 
    const innerEl = document.getElementById('reportPreviewInner');
    innerEl.innerHTML = generateReportHTML(inst); // Gera o HTML do relatório
    
    // Exibe o modal
    document.getElementById('reportPreviewModal').style.zIndex = '9999'; 
    document.getElementById('reportPreviewModal').classList.remove('hidden');
}

/**
 * @description Fecha o modal de pré-visualização do relatório.
 */
function closeReportPreview() {
    document.getElementById('reportPreviewModal').classList.add('hidden');
    document.getElementById('reportPreviewModal').style.zIndex = '4000';
    currentReportInstanceId = null;
}

// ==================== FUNÇÕES DE GERAÇÃO DE HTML DE RELATÓRIO ====================

/**
 * @description Gera o HTML para o relatório de um turno completo.
 * Inclui informações gerais do turno e detalhes de cada tarefa.
 * @param {object} inst - A instância de execução do turno.
 * @returns {string} O HTML formatado do relatório.
 */
function generateReportHTML(inst) {
    const totalTime = inst.tasks.reduce((acc, t) => acc + (t.runtimeSeconds || 0), 0);
    const totalTimeFormatted = formatSeconds(totalTime);
    let html = `
        <style>
            /* Estilos específicos para impressão/PDF do relatório */
            .report-card { background: #fff; padding: 20px; border-radius: 8px; color: #000; font-family: sans-serif; }
            .report-header h2 { font-size: 1.2rem; color: #F20587; }
            .report-info { margin-bottom: 12px; font-size: 0.9rem; }
            .report-task { 
                border: 1px solid #ccc; 
                padding: 10px; 
                margin-bottom: 10px; 
                border-radius: 6px; 
                page-break-inside: avoid; /* Previne quebra de página dentro da tarefa */
                break-inside: avoid; 
            }
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
    
    // Adiciona o bloco de detalhes de cada tarefa
    inst.tasks.forEach(task => {
        const photosHtml = task.photos.map(p => `<img src="${p}" class="evidence-img">`).join('');
        const taskStatus = task.completed ? (task.success ? 'SUCESSO' : 'FALHA') : 'NÃO CONCLUÍDA';
        let timeInfo = `Tempo: ${formatSeconds(task.runtimeSeconds)}`;
        
        // Detalhe do modo de tempo
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

/**
 * @description Gera o HTML para o relatório de uma única tarefa.
 * Usado para download de PDF unitário.
 * @param {object} task - O objeto da tarefa.
 * @param {object} inst - A instância de execução do turno.
 * @returns {string} O HTML formatado do relatório unitário.
 */
function generateTaskReportHTML(task, inst) {
    const totalTimeFormatted = formatSeconds(task.runtimeSeconds || 0);
    let photosHtml = task.photos.map(p => `<img src="${p}" class="evidence-img">`).join('');
    const taskStatus = task.completed ? (task.success ? 'SUCESSO' : 'FALHA') : 'NÃO CONCLUÍDA';
    let timeInfo = `Tempo: ${formatSeconds(task.runtimeSeconds)}`;
    
    // Detalhe do modo de tempo
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
             /* Estilos específicos para impressão/PDF do relatório unitário */
            .report-card { background: #fff; padding: 20px; border-radius: 8px; color: #000; font-family: sans-serif; }
            .report-header h2 { font-size: 1.2rem; color: #F20587; }
            .report-info { margin-bottom: 12px; font-size: 0.9rem; }
            .report-task { 
                border: 1px solid #ccc; 
                padding: 10px; 
                margin-bottom: 10px; 
                border-radius: 6px; 
                page-break-inside: avoid; 
                break-inside: avoid; 
            }
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

/**
 * @description Gera e baixa um relatório PDF unitário de uma tarefa concluída.
 * Usa `html2canvas` e `jspdf` para converter o HTML em PDF.
 * @param {string} taskId - O ID da tarefa.
 */
async function downloadTaskPDF(taskId) {
    if (!executingActivity) return showNotification('Nenhum turno ativo.', 3000);
    const task = executingActivity.tasks.find(tt => tt.id === taskId);
    if (!task) return showNotification('Tarefa não encontrada.', 3000, 'warning');
    if (!task.completed) {
        return showNotification('A tarefa deve ser concluída para gerar o relatório unitário.', 3000, 'warning');
    }
    
    // Gera o HTML e prepara o container temporário para a geração do PDF
    const reportHtml = generateTaskReportHTML(task, executingActivity);
    const tempContainer = document.createElement('div');
    tempContainer.id = `report-unitario-${taskId}`; 
    tempContainer.innerHTML = reportHtml;
    tempContainer.style.width = '210mm'; 
    tempContainer.style.padding = '10mm';
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px'; // Move para fora da tela
    document.body.appendChild(tempContainer);

    const date = new Date(executingActivity.shiftStart).toISOString().slice(0, 10);
    try {
        await generatePdfFromElement(tempContainer, `Relatorio_Tarefa_${task['Proc. ID']}_${date}`);
        showNotification('PDF da Tarefa unitária gerado!', 3000);
    } catch (error) {
        console.error("Erro ao gerar PDF unitário:", error);
        showNotification('Erro ao gerar PDF da tarefa. Verifique o console.', 5000, 'critical');
    } finally {
        // Limpeza do container temporário
        if (document.body.contains(tempContainer)) {
            document.body.removeChild(tempContainer);
        }
    }
}

/**
 * @description Inicia o download do relatório PDF do turno atualmente em pré-visualização.
 */
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
    
    // Gera o HTML do relatório completo e prepara o container temporário
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = generateReportHTML(inst); 
    tempContainer.style.width = '210mm';
    tempContainer.style.padding = '10mm';
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    document.body.appendChild(tempContainer);

    const date = new Date(inst.shiftStart).toISOString().slice(0, 10);
    
    // Gera o PDF
    generatePdfFromElement(tempContainer, `Relatorio_Turno_${inst.operator}_${date}`).then(() => {
          document.body.removeChild(tempContainer);
          showNotification('PDF do Relatório individual gerado!', 3000);
          closeReportPreview();
    });
}


/**
 * @description Gera e baixa um relatório PDF consolidado de TODAS as execuções salvas.
 */
async function generateFinalReportPDF() {
    const allExecutions = executions; 
    if (allExecutions.length === 0) return showNotification('Nenhuma execução registrada para Relatório Final.', 3000);
    
    const tempContainer = document.createElement('div');
    tempContainer.style.width = '210mm';
    tempContainer.style.padding = '10mm';

    // Gera o HTML para cada execução e adiciona uma quebra de página entre eles
    allExecutions.forEach(inst => {
        const reportHtml = generateReportHTML(inst); 
        const reportDiv = document.createElement('div');
        reportDiv.innerHTML = reportHtml;
        tempContainer.appendChild(reportDiv);
        if (inst !== allExecutions[allExecutions.length - 1]) {
            const hr = document.createElement('hr');
            hr.style.pageBreakAfter = 'always'; // Quebra de página para o PDF
            tempContainer.appendChild(hr);
        }
    });

    document.body.appendChild(tempContainer);

    // Gera o PDF
    await generatePdfFromElement(tempContainer, `Relatorio_Consolidado_DITL_FINAL_COMPLETO_${new Date().toISOString().slice(0, 10)}`);
    document.body.removeChild(tempContainer);
    showNotification('Relatório Final (Completo) gerado com sucesso.', 3000);
}


/**
 * @description Função auxiliar para gerar um PDF a partir de um elemento HTML usando `html2canvas` e `jspdf`.
 * Lida com a paginação de conteúdo que excede uma página A4.
 * @param {HTMLElement} element - O elemento HTML a ser convertido.
 * @param {string} filename - O nome do arquivo PDF.
 */
// ** [FUNÇÃO ORIGINAL] ** Esta função é mantida no final, mas a nova função no topo faz um override de 'window.generatePdfFromElement'.
// No caso de falha da nova função, ela tenta chamar o 'originalGenerate' que é esta função.
async function generatePdfFromElement(element, filename) {
    showNotification('Gerando PDF... Aguarde.', 3000);

    const { jsPDF } = window.jspdf;
    
    // Converte o HTML em um canvas (imagem)
    const canvas = await html2canvas(element, { 
        scale: 2,
        scrollY: -window.scrollY // Ajuste para elementos fora da viewport
    }); 

    const imgData = canvas.toDataURL('image/png');
    const imgWidth = 210; // Largura do A4 em mm
    const pageHeight = 295; // Altura do A4 em mm
    const imgHeight = canvas.height * imgWidth / canvas.width; // Altura da imagem mantendo proporção
    
    let position = 0;
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    // Adiciona a primeira página
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    
    let heightLeft = imgHeight - pageHeight;
    
    // Lógica para adicionar páginas se o conteúdo for maior que A4
    while (heightLeft > 0) {
        position = -(imgHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
    }
    
    pdf.save(`${filename}.pdf`);
}

/**
 * @description Verifica se alguma tarefa não concluída excedeu o tempo 'T + (hh:mm)' da planilha, 
 * marcando-a como atrasada (`due`).
 */
function checkDueTasks() {
    if (!executingActivity || !localStorage.getItem('shiftActiveISO')) return;
    const now = new Date();
    const shiftStart = new Date(executingActivity.shiftStart);
    // Tempo decorrido do turno
    const elapsedShiftSeconds = Math.floor((now.getTime() - shiftStart.getTime()) / 1000); 
    let changed = false;

    executingActivity.tasks.forEach(t => {
        // Verifica tarefas não concluídas com um tempo de vencimento definido (dueSeconds = T + (hh:mm))
        if (!t.completed && t.dueSeconds !== null) {
            if (elapsedShiftSeconds > t.dueSeconds) {
                if (!t.due) {
                    t.due = true;
                    changed = true;
                    showNotification(`ATENÇÃO: Tarefa "${t['Event / Action']}" está atrasada em relação ao previsto da planilha!`, 5000, 'warning');
                }
            } else {
                if (t.due) {
                    t.due = false; // Se voltou ao tempo, remove o status de atraso (Embora improvável, mantém o estado limpo)
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

/**
 * @description Inicia o intervalo de verificação de tarefas atrasadas (`due`) a cada 30 segundos.
 */
function startScheduledChecker() {
    if (dueCheckerInterval) clearInterval(dueCheckerInterval);
    dueCheckerInterval = setInterval(checkDueTasks, 30000); 
}