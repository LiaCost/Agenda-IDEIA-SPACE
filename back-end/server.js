require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../')));
app.use(apiRoutes); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Inicia o servidor
app.listen(port, () => {
    console.log(`Projeto rodando em http://localhost:${port}`);
});