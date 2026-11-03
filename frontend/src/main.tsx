import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import './styles.css'
import './i18n'
import { loadMeta } from './api'
import Layout from './components/Layout'
import Login from './pages/Login'
import PasswordChange from './pages/PasswordChange'
import Home from './pages/Home'
import Reports from './pages/Reports'
import Run from './pages/Run'
import NewReport from './pages/NewReport'
import Designer from './pages/Designer'
import History from './pages/History'
import Sources from './pages/Sources'
import Access from './pages/Access'
import Settings from './pages/Settings'
import General from './pages/settings/General'
import Account from './pages/settings/Account'

loadMeta().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="giris" element={<Login />} />
        <Route path="parola" element={<PasswordChange />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="raporlar" element={<Reports />} />
          <Route path="yeni" element={<NewReport />} />
          <Route path="rapor/:id" element={<Run />} />
          <Route path="tasarim" element={<Designer />} />
          <Route path="tasarim/:id" element={<Designer />} />
          <Route path="gecmis" element={<History />} />
          <Route path="ayarlar" element={<Settings />}>
            <Route index element={<Navigate to="genel" replace />} />
            <Route path="genel" element={<General />} />
            <Route path="hesap" element={<Account />} />
            <Route path="kaynaklar" element={<Sources />} />
            <Route path="erisim" element={<Access />} />
          </Route>
          <Route path="kaynaklar" element={<Navigate to="/ayarlar/kaynaklar" replace />} />
          <Route path="yetkiler" element={<Navigate to="/ayarlar/erisim" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
))
