import { Routes, Route, Navigate } from 'react-router-dom';
import AuthGate from './components/AuthGate';
import WorkspaceList from './pages/WorkspaceList';
import WorkspaceView from './pages/WorkspaceView';

export default function App() {
  return (
    <div className="h-full flex flex-col max-w-lg mx-auto">
      <AuthGate>
        <Routes>
          <Route path="/" element={<WorkspaceList />} />
          <Route path="/workspace/:name" element={<WorkspaceView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthGate>
    </div>
  );
}
