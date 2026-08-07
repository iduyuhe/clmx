import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProtectedRoute, RoleGuard } from './ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import { IndustryListPage } from '@/pages/industries/IndustryListPage'
import { DatasetListPage } from '@/pages/datasets/DatasetListPage'
import { DatasetCreatePage } from '@/pages/datasets/DatasetCreatePage'
import { DatasetDetailPage } from '@/pages/datasets/DatasetDetailPage'
import { ModelListPage } from '@/pages/models/ModelListPage'
import { ModelCreatePage } from '@/pages/models/ModelCreatePage'
import { ModelDetailPage } from '@/pages/models/ModelDetailPage'
import { ModelTrainPage } from '@/pages/models/ModelTrainPage'
import { ModelVersionDetailPage } from '@/pages/models/ModelVersionDetailPage'
import { TrainingListPage } from '@/pages/training/TrainingListPage'
import { TrainingDetailPage } from '@/pages/training/TrainingDetailPage'
import { DeploymentListPage } from '@/pages/deployments/DeploymentListPage'
import { DeploymentCreatePage } from '@/pages/deployments/DeploymentCreatePage'
import { DeploymentDetailPage } from '@/pages/deployments/DeploymentDetailPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'
import { InferencePage } from '@/pages/inference/InferencePage'
import { DeviceListPage } from '@/pages/devices/DeviceListPage'
import { DeviceWizardPage } from '@/pages/devices/DeviceWizardPage'
import { DeviceCreatePage } from '@/pages/devices/DeviceCreatePage'
import { DeviceDetailPage } from '@/pages/devices/DeviceDetailPage'
import { HealthDashboardPage } from '@/pages/health/HealthDashboardPage'
import { IngestLibraryPage } from '@/pages/ingest/IngestLibraryPage'
import { MaintenanceListPage } from '@/pages/maintenance/MaintenanceListPage'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
})

const router = createBrowserRouter([
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [
      { index: true, element: <LoginPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
    ],
  },
  {
    path: '/app',
    element: <ProtectedRoute><AppLayout /></ProtectedRoute>,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'industries', element: <IndustryListPage /> },
      { path: 'datasets', element: <DatasetListPage /> },
      { path: 'datasets/new', element: <DatasetCreatePage /> },
      { path: 'datasets/:datasetId', element: <DatasetDetailPage /> },
      { path: 'models', element: <ModelListPage /> },
      { path: 'models/new', element: <ModelCreatePage /> },
      { path: 'models/:modelId', element: <ModelDetailPage /> },
      { path: 'models/:modelId/train', element: <ModelTrainPage /> },
      { path: 'models/:modelId/versions/:versionId', element: <ModelVersionDetailPage /> },
      { path: 'training', element: <RoleGuard minRole="MANAGER"><TrainingListPage /></RoleGuard> },
      { path: 'training/:jobId', element: <RoleGuard minRole="MANAGER"><TrainingDetailPage /></RoleGuard> },
      { path: 'deployments', element: <RoleGuard minRole="MANAGER"><DeploymentListPage /></RoleGuard> },
      { path: 'deployments/new', element: <RoleGuard minRole="MANAGER"><DeploymentCreatePage /></RoleGuard> },
      { path: 'deployments/:deploymentId', element: <RoleGuard minRole="MANAGER"><DeploymentDetailPage /></RoleGuard> },
      { path: 'settings', element: <RoleGuard minRole="ADMIN"><SettingsPage /></RoleGuard> },
      { path: 'inference', element: <InferencePage /> },
      { path: 'devices', element: <DeviceListPage /> },
      { path: 'devices/quick-connect', element: <DeviceWizardPage /> },
      { path: 'devices/new', element: <RoleGuard minRole="MANAGER"><DeviceCreatePage /></RoleGuard> },
      { path: 'devices/:deviceId', element: <DeviceDetailPage /> },
      { path: 'health', element: <HealthDashboardPage /> },
      { path: 'ingest', element: <IngestLibraryPage /> },
      { path: 'maintenance', element: <MaintenanceListPage /> },
    ],
  },
  { path: '/', element: <ProtectedRoute><AppLayout /></ProtectedRoute>, children: [{ index: true, element: <DashboardPage /> }] },
  { path: '*', element: <div className="flex flex-col items-center justify-center h-screen"><h2 className="text-lg font-medium">404</h2><p className="text-muted-foreground">Page not found</p></div> },
])

export function AppRouter() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
