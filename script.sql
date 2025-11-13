CREATE DATABASE IF NOT EXISTS sistema_ditl;
USE sistema_ditl;

CREATE TABLE atividades_importadas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tempo_previsto VARCHAR(50),
    proc_id VARCHAR(100),
    evento VARCHAR(100),
    acao VARCHAR(255),
    criterios_aceitacao TEXT
);

CREATE TABLE turnos (
    instance_id VARCHAR(50) PRIMARY KEY,
    operador_responsavel VARCHAR(100),
    inicio_turno DATETIME,
    fim_turno DATETIME,
    status VARCHAR(50)
);

CREATE TABLE tarefas_execucao (
    task_id VARCHAR(100) PRIMARY KEY,
    turno_instance_id VARCHAR(50),
    proc_id VARCHAR(100),
    acao VARCHAR(255),
    status VARCHAR(50),
    runtime_seconds INT DEFAULT 0,
    target_seconds INT DEFAULT 0,
    time_mode VARCHAR(20),
    scheduled_alert_iso DATETIME,
    scheduled_limit_iso DATETIME,
    operador_tarefa VARCHAR(100),
    observacao TEXT,
    completed BOOLEAN DEFAULT FALSE,
    completed_at DATETIME,
    success BOOLEAN,
    FOREIGN KEY (turno_instance_id) REFERENCES turnos(instance_id) ON DELETE CASCADE
);

CREATE TABLE evidencias_fotos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id VARCHAR(100),
    imagem_base64 LONGTEXT,
    data_upload DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tarefas_execucao(task_id) ON DELETE CASCADE
);

CREATE TABLE notificacoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME,
    mensagem TEXT,
    tipo VARCHAR(20),
    lido BOOLEAN DEFAULT FALSE
);
