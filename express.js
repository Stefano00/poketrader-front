const express = require('express');
const path = require('path');
const app = express();

// Sirve archivos estáticos desde la carpeta dist/browser
app.use(express.static(path.join(__dirname, 'dist/poketrader-front/browser')));

// Todas las rutas no encontradas envían index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist/poketrader-front/browser/index.html'));
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});
