import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import dayjs from 'dayjs'
// Indonesian month names everywhere a date is written out, the date pickers included.
import 'dayjs/locale/id'
import { AuthProvider } from './contexts/AuthContext'
import './index.css'
import App from './App.tsx'

dayjs.locale('id')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
