# Escaque — Analizador de partidas de ajedrez

Web estática (sin backend, sin login) para buscar tus partidas de Chess.com por nombre de usuario y analizarlas con Stockfish (NNUE) corriendo enteramente en tu navegador.

## Cómo usarla

Es 100% estática: solo hacen falta los 3 archivos (`index.html`, `style.css`, `app.js`) servidos desde cualquier sitio. Opciones gratis:

- **GitHub Pages**: sube estos archivos a un repo y activa Pages.
- **Netlify / Vercel (plan free)**: arrastra la carpeta al deploy.
- **Local**: `python3 -m http.server` dentro de la carpeta y abre `http://localhost:8000`.

No necesitas configurar nada más. El motor Stockfish se descarga desde jsDelivr (CDN público y gratuito) la primera vez que se abre una partida.

## Cómo funciona

1. **Partidas**: se piden a la API pública de Chess.com (`api.chess.com/pub/player/{user}/games/archives`), sin API key ni login. Se cargan los últimos 4 meses de archivos, hasta 30 partidas.
2. **Tablero**: renderizado propio con piezas Unicode (sin sprites ni dependencias de imágenes), usando `chess.js` para la lógica de reglas y reconstrucción de posiciones desde el PGN.
3. **Motor**: `stockfish` (paquete npm de Nathan Rugg, el mismo motor que usa Chess.com), variante **NNUE 17.1 lite single-thread**, cargada como Web Worker desde jsDelivr. Se eligió la variante *single-thread* porque no requiere que el hosting mande cabeceras `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`, así funciona en cualquier alojamiento estático gratuito sin configuración extra. Sigue siendo un motor muy fuerte (miles de puntos Elo por encima de cualquier humano).
4. **Análisis**: al pulsar "Analizar partida completa", se evalúa cada posición de la partida a la profundidad elegida (10–22) y se clasifican las jugadas por la caída de evaluación (`??` blunder, `?` error, `?!` imprecisión). También se calcula una precisión aproximada por bando y se dibuja la curva de evaluación.

## Posibles mejoras futuras

- Variante multi-hilo del motor (más rápida) si despliegas con las cabeceras COOP/COEP activadas.
- Soporte para Lichess además de Chess.com.
- Detección de aperturas (ECO) y mejores jugadas sugeridas visualmente sobre el tablero.
- Guardado local (localStorage) del último usuario buscado.

## Licencia del motor

Stockfish es software libre bajo GPLv3. La distribución WASM usada aquí está publicada por Nathan Rugg (`stockfish` en npm) y es la misma que usa Chess.com en su web.
