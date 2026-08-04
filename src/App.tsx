import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initTheme } from './lib/theme';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Developers from './pages/Developers';
import Teams from './pages/Teams';
import Tasks from './pages/Tasks';
import Analytics from './pages/Analytics';
import UserRoles from './pages/UserRoles';
import TestFlowPrototype from './pages/TestFlowPrototype';
import TestingCenter from './pages/TestingCenter';
import TestPlanDetail from './pages/TestPlanDetail';
import TestConstructionDetail from './pages/TestConstructionDetail';

export default function App() {
  useEffect(() => { initTheme(); }, []);
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/developers" element={<Developers />} />
            <Route
              path="/teams"
              element={
                <ProtectedRoute requiredRoles={['admin']}>
                  <Teams />
                </ProtectedRoute>
              }
            />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/testing" element={<TestingCenter />} />
            <Route path="/testing/plans/:id" element={<TestPlanDetail />} />
            <Route path="/testing/construction/:id" element={<TestConstructionDetail />} />
            <Route path="/prototype/test-flow" element={<TestFlowPrototype />} />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute requiredRoles={['admin', 'manager']}>
                  <Analytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="/user-roles"
              element={
                <ProtectedRoute requiredRoles={['admin']}>
                  <UserRoles />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
