import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import TestCases from './pages/TestCases';
import LiveRun from './pages/LiveRun';
import ReportView from './pages/ReportView';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects/:projectId" element={<TestCases />} />
        <Route path="/runs/:runId/live" element={<LiveRun />} />
        <Route path="/runs/:runId/report" element={<ReportView />} />
      </Routes>
    </BrowserRouter>
  );
}
