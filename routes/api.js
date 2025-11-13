const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();

// =================================================================
// CONEXÃO COM BANCO DE DADOS
// =================================================================
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

const pool = mysql.createPool(dbConfig);

// Função Helper (CamelCase)
const toCamelCase = (rows) => {
    return rows.map(row => {
        const newRow = {};
        for (const key in row) {
            const camelKey = key.replace(/_(\w)/g, (match, p1) => p1.toUpperCase());
            newRow[camelKey] = row[key];
        }
        return newRow;
    });
};

// Função Helper (Time)
function timeToTotalSeconds(timeStr) {
    if (!timeStr) return 0;
    const matches = timeStr.match(/(\d{2}):(\d{2})/g);
    if (!matches) return 0;
    const lastTimeStr = matches[matches.length - 1]; 
    const parts = lastTimeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2) {
        const hours = parts[0];
        const minutes = parts[1];
        const totalSeconds = (hours * 3600) + (minutes * 60);
        return isNaN(totalSeconds) ? 0 : totalSeconds;
    }
    return 0;
}

// =================================================================
//                           ROTAS
// =================================================================

// GET /api/atividades-importadas
router.get('/api/atividades-importadas', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM atividades_importadas ORDER BY id');
        res.json(toCamelCase(rows));
    } catch (error) {
        console.error('Erro em /api/atividades-importadas:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

// POST /api/atividades-importadas
router.post('/api/atividades-importadas', async (req, res) => {
    const { activities } = req.body;
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.query('DELETE FROM atividades_importadas');
        await conn.query('ALTER TABLE atividades_importadas AUTO_INCREMENT = 1');
        const query = `INSERT INTO atividades_importadas (tempo_previsto, proc_id, evento, acao, criterios_aceitacao) VALUES (?, ?, ?, ?, ?)`;
        for (const act of activities) {
            await conn.query(query, [act['T + (hh:mm)'], act['Proc. ID'], act['Event'], act['Event / Action'], act['Key Acceptance Criteria']]);
        }
        await conn.commit();
        res.status(201).json({ message: `${activities.length} atividades importadas.` });
    } catch (error) {
        console.error(error);
        if (conn) await conn.rollback();
        res.status(500).json({ error: 'Erro ao importar' });
    } finally {
        if (conn) conn.release();
    }
});

// DELETE /api/atividades-importadas
router.delete('/api/atividades-importadas', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.query('DELETE FROM atividades_importadas');
        await conn.query('ALTER TABLE atividades_importadas AUTO_INCREMENT = 1');
        await conn.commit();
        res.status(200).json({ message: 'Limpo.' });
    } catch (error) {
        if (conn) await conn.rollback();
        res.status(500).json({ error: 'Erro ao limpar' });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/turno-ativo
router.get('/api/turno-ativo', async (req, res) => {
    try {
        const [turnos] = await pool.query('SELECT * FROM turnos WHERE status = ?', ['ativo']);
        if (turnos.length === 0) return res.json(null);
        const turnoAtivo = toCamelCase(turnos)[0];
        const [tarefas] = await pool.query('SELECT * FROM tarefas_execucao WHERE turno_instance_id = ? ORDER BY CAST(SUBSTRING_INDEX(task_id, \'-\', -1) AS UNSIGNED)', [turnoAtivo.instanceId]);
        const tarefasCamel = toCamelCase(tarefas);
        for (let tarefa of tarefasCamel) {
            const [fotos] = await pool.query('SELECT imagem_base64 AS base64 FROM evidencias_fotos WHERE task_id = ?', [tarefa.taskId]);
            tarefa.photos = fotos.map(f => f.base64); 
        }
        turnoAtivo.tasks = tarefasCamel;
        res.json(turnoAtivo);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

// POST /api/turnos/iniciar
router.post('/api/turnos/iniciar', async (req, res) => {
    try {
        const { operator, shiftStart } = req.body;
        const instanceId = `INST-${Date.now()}`;
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.query('INSERT INTO turnos (instance_id, operador_responsavel, inicio_turno, status) VALUES (?, ?, ?, ?)', [instanceId, operator, new Date(shiftStart), 'ativo']);
        const [atividades] = await conn.query('SELECT * FROM atividades_importadas ORDER BY id');
        let taskCounter = 1;
        for (const act of atividades) {
            const taskId = `TASK-${instanceId.split('-')[1]}-${taskCounter}`;
            const targetSeconds = timeToTotalSeconds(act.tempo_previsto);
            await conn.query('INSERT INTO tarefas_execucao (task_id, turno_instance_id, proc_id, acao, status, time_mode, target_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [taskId, instanceId, act.proc_id, act.acao, 'pendente', 'countdown', targetSeconds]);
            taskCounter++;
        }
        await conn.commit();
        conn.release();
        res.status(201).json({ instanceId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro' });
    }
});

// POST /api/turnos/:id/encerrar
router.post('/api/turnos/:id/encerrar', async (req, res) => {
    try {
        const { id } = req.params;
        const { shiftEnd } = req.body;
        await pool.query('UPDATE turnos SET status = ?, fim_turno = ? WHERE instance_id = ?', ['concluido', new Date(shiftEnd), id]);
        res.json({ message: 'Encerrado' });
    } catch (error) {
        res.status(500).json({ error: 'Erro' });
    }
});

// POST /api/tarefa/:id/atualizar-status
router.post('/api/tarefa/:id/atualizar-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, runtimeSeconds } = req.body;
        await pool.query('UPDATE tarefas_execucao SET status = ?, runtime_seconds = ? WHERE task_id = ?', [status, runtimeSeconds, id]);
        res.json({ message: 'Atualizado' });
    } catch (error) {
        res.status(500).json({ error: 'Erro' });
    }
});

// POST /api/tarefa/:id/completar
router.post('/api/tarefa/:id/completar', async (req, res) => {
    try {
        const { id } = req.params;
        const { success, operatorTask, observation, completedAt, runtimeSeconds, photos } = req.body;
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.query(`UPDATE tarefas_execucao SET status = ?, success = ?, operador_tarefa = ?, observacao = ?, completed = TRUE, completed_at = ?, runtime_seconds = ? WHERE task_id = ?`,
            [success ? 'concluido' : 'falha', success, operatorTask, observation, new Date(completedAt), runtimeSeconds, id]);
        await conn.query('DELETE FROM evidencias_fotos WHERE task_id = ?', [id]);
        for (let base64Img of photos) {
            await conn.query('INSERT INTO evidencias_fotos (task_id, imagem_base64) VALUES (?, ?)', [id, base64Img]);
        }
        await conn.commit();
        conn.release();
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro' });
    }
});

// POST /api/tarefa/:id/reiniciar
router.post('/api/tarefa/:id/reiniciar', async (req, res) => {
    try {
        const { id } = req.params;
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.query(`UPDATE tarefas_execucao SET status = 'pendente', runtime_seconds = 0, operador_tarefa = NULL, observacao = NULL, completed = FALSE, completed_at = NULL, success = NULL WHERE task_id = ?`, [id]);
        await conn.query('DELETE FROM evidencias_fotos WHERE task_id = ?', [id]);
        await conn.commit();
        conn.release();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro' });
    }
});

// GET /api/relatorios
router.get('/api/relatorios', async (req, res) => {
    try {
        const [turnos] = await pool.query('SELECT * FROM turnos ORDER BY inicio_turno DESC');
        const turnosCamel = toCamelCase(turnos);
        for (let turno of turnosCamel) {
            const [stats] = await pool.query(`SELECT COUNT(*) AS total, SUM(completed = TRUE) AS done FROM tarefas_execucao WHERE turno_instance_id = ?`, [turno.instanceId]);
            turno.tasksTotal = stats[0].total || 0;
            turno.tasksDone = stats[0].done || 0;
        }
        res.json(turnosCamel);
    } catch (error) {
        res.status(500).json({ error: 'Erro' });
    }
});

// GET /api/relatorio/:id
router.get('/api/relatorio/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [turnos] = await pool.query('SELECT * FROM turnos WHERE instance_id = ?', [id]);
        if (turnos.length === 0) return res.status(404).json({ error: 'N/A' });
        const turno = toCamelCase(turnos)[0];
        const [tarefas] = await pool.query('SELECT * FROM tarefas_execucao WHERE turno_instance_id = ? ORDER BY CAST(SUBSTRING_INDEX(task_id, \'-\', -1) AS UNSIGNED)', [turno.instanceId]);
        const tarefasCamel = toCamelCase(tarefas);
        for (let tarefa of tarefasCamel) {
            const [fotos] = await pool.query('SELECT imagem_base64 AS base64 FROM evidencias_fotos WHERE task_id = ?', [tarefa.taskId]);
            tarefa.photos = fotos.map(f => f.base64); 
            const [modelo] = await pool.query('SELECT acao, criterios_aceitacao, proc_id FROM atividades_importadas WHERE proc_id = ?', [tarefa.procId]);
            if(modelo.length > 0) {
                tarefa['Event / Action'] = modelo[0].acao;
                tarefa['Key Acceptance Criteria'] = modelo[0].criterios_aceitacao;
                tarefa['Proc. ID'] = modelo[0].proc_id;
            }
        }
        turno.tasks = tarefasCamel;
        res.json(turno);
    } catch (error) {
        res.status(500).json({ error: 'Erro' });
    }
});

module.exports = router;