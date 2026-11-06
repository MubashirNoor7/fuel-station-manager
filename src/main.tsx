import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { RuntimeBoundary } from './components/RuntimeBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeBoundary><App /></RuntimeBoundary>
  </StrictMode>
);
