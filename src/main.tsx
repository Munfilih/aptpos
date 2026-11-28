import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {
  installPwaTerminalFetchInterceptor,
  registerPwaServiceWorker,
} from './utils/pwaClient';

installPwaTerminalFetchInterceptor();
registerPwaServiceWorker();

createRoot(document.getElementById('root')!).render(<App />);
