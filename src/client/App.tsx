import { Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { DashboardPage } from './pages/DashboardPage';
import { ContestsPage } from './pages/ContestsPage';
import { EntriesPage } from './pages/EntriesPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { QueuePage } from './pages/QueuePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { StatusPage } from './pages/StatusPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/contests" element={<ContestsPage />} />
        <Route path="/entries" element={<EntriesPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MainLayout>
  );
}
