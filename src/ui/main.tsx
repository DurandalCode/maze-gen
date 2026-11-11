import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main>
      <p className="eyebrow">MAZE LAB · НОВОЕ НАЧАЛО</p>
      <h1>Лабиринт начинается с формы.</h1>
      <p className="intro">Пространство для проектирования лабиринтов и исследования маршрутов.</p>
      <section aria-labelledby="status-title">
        <span className="status">В разработке</span>
        <h2 id="status-title">Создаём основу</h2>
        <p>Редактор, генерация и библиотека появятся по мере реализации новой версии.</p>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
