import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root nao encontrado');

// Sem StrictMode de proposito: o duplo mount de efeitos em desenvolvimento
// dispararia dois pedidos de captura de tela e derrubaria a sala do host
// (sair da sala encerra a sala) antes do segundo mount conseguir entrar.
createRoot(container).render(<App />);
