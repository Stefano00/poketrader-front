import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const browserDistFolder = join(__dirname, '../browser');

const app = express();

// Middleware para CORS y headers de seguridad
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Sirve archivos estáticos con cache control
app.use(express.static(browserDistFolder, {
  maxAge: '1h',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      // No cachear archivos HTML
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Todas las rutas sirven index.html
app.get('*', (_req, res) => {
  res.sendFile(join(browserDistFolder, 'index.html'));
});

// Solo inicia el servidor si se ejecuta directamente
if (process.argv[1] === __filename) {
  const port = Number(process.env['PORT']) || 4000;
  const host = '0.0.0.0'; // Escucha en todas las interfaces de red
  app.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}`);
    console.log('Para acceder desde otros dispositivos en la red local:');
    console.log('1. Desde tu smartphone, usa la IP de tu computadora');
    console.log('2. Ejemplo: http://[IP-DE-TU-PC]:4000');
  });
}

export default app;
