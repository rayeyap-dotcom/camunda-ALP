import { useEffect, useMemo, useState } from 'react'
import './App.css'

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
const dashboardId = import.meta.env.VITE_DASHBOARD_ID || 'e601bcb9-b11a-4086-9ae3-88c7b825269c'
const processDefinitionKey = import.meta.env.VITE_PROCESS_ID || 'Process_1dwlliq'
const processInstanceKey = import.meta.env.VITE_PROCESS_INSTANCE_KEY || ''

const PIE_COLORS = ['#f59e0b', '#f97316', '#fbbf24', '#fdba74', '#fb923c', '#eab308']

function formatNumber(value, digits = 2) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function buildPieStyle(items) {
  const total = items.reduce((sum, item) => sum + Math.max(Number(item.value) || 0, 0), 0)
  let current = 0
  const gradient = items
    .map((item) => {
      const value = Number(item.value) || 0
      if (!total || value <= 0) return null
      const start = current / total * 100
      current += value
      const end = current / total * 100
      return `${item.color} ${start}% ${end}%`
    })
    .filter(Boolean)
    .join(', ')

  return {
    background: `conic-gradient(${gradient || '#f4c76d 0 100%'})`,
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('Dashboard')
  const [insights, setInsights] = useState(null)
  const [instances, setInstances] = useState([])
  const [tasks, setTasks] = useState([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [taskForm, setTaskForm] = useState({})
  const [processFilter, setProcessFilter] = useState('all')
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [loadingInstances, setLoadingInstances] = useState(true)
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [error, setError] = useState('')

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || tasks[0] || null,
    [tasks, selectedTaskId],
  )

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const query = new URLSearchParams({ processId: processDefinitionKey })
        const response = await fetch(`${apiBase}/api/dashboard/${dashboardId}/insights?${query.toString()}`)
        if (!response.ok) {
          throw new Error(`Dashboard request failed with code ${response.status}`)
        }
        const payload = await response.json()
        setInsights(payload)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoadingDashboard(false)
      }
    }

    async function fetchInstances() {
      try {
        const params = new URLSearchParams({ processInstanceKey, state: processFilter === 'all' ? '' : processFilter })
        const response = await fetch(`${apiBase}/api/process-instances?${params.toString()}`)
        if (!response.ok) {
          throw new Error(`Process instances request failed with code ${response.status}`)
        }
        const payload = await response.json()
        setInstances(Array.isArray(payload) ? payload : payload.items || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoadingInstances(false)
      }
    }

    async function fetchTasks() {
      try {
        const params = new URLSearchParams({ processInstanceKey })
        const response = await fetch(`${apiBase}/api/tasklist?${params.toString()}`)
        if (!response.ok) {
          throw new Error(`Tasklist request failed with code ${response.status}`)
        }
        const payload = await response.json()
        const nextTasks = Array.isArray(payload) ? payload : payload.items || []
        setTasks(nextTasks)
        if (!selectedTaskId && nextTasks[0]) {
          setSelectedTaskId(nextTasks[0].id)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoadingTasks(false)
      }
    }

    fetchDashboard()
    fetchInstances()
    fetchTasks()
  }, [processFilter])

  useEffect(() => {
    if (!selectedTask) return

    const fields = selectedTask.variables || {}
    setTaskForm(
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, value?.value ?? value ?? '']),
      ),
    )
  }, [selectedTask])

  const filteredInstances = useMemo(() => {
    if (processFilter === 'all') return instances
    return instances.filter((instance) => instance.state === processFilter)
  }, [instances, processFilter])

  const summary = useMemo(() => {
    if (!insights?.reports) {
      return {
        totalReports: 0,
        totalRecords: 0,
        avgMetric: 0,
        trend: [],
      }
    }

    const values = insights.reports.flatMap((report) => {
      const rows = Array.isArray(report.dataPreview) ? report.dataPreview : report.data || []
      return rows.flatMap((row) => Object.values(row || {}).filter((value) => typeof value === 'number'))
    })

    const totalRecords = insights.reports.reduce((sum, report) => sum + (report.totalRecords || 0), 0)
    const trend = insights.reports.flatMap((report) => {
      const rows = Array.isArray(report.dataPreview) ? report.dataPreview : []
      return rows.slice(0, 6).map((row) => ({
        report: report.name || report.id,
        value: Math.max(...Object.values(row || {}).filter((value) => typeof value === 'number'), 0) || 0,
      }))
    })

    return {
      totalReports: insights.totalReports || 0,
      totalRecords,
      avgMetric: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
      trend: trend.slice(0, 8),
    }
  }, [insights])

  const dashboardCards = insights?.reports || []

  const handleTaskInputChange = (key, value) => {
    setTaskForm((current) => ({ ...current, [key]: value }))
  }

  const handleTaskSubmit = async (event) => {
    event.preventDefault()
    if (!selectedTask) return

    const variables = Object.fromEntries(
      Object.entries(taskForm).map(([key, value]) => {
        const numericValue = Number(value)
        return [key, Number.isFinite(numericValue) && String(value).trim() !== '' ? numericValue : value]
      }),
    )

    const response = await fetch(`${apiBase}/api/tasks/${selectedTask.id}/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables }),
    })

    if (!response.ok) {
      throw new Error('Unable to submit task')
    }

    setTasks((current) => current.filter((task) => task.id !== selectedTask.id))
    setSelectedTaskId('')
  }

  const renderDashboardVisual = (report) => {
    if (report.resultType === 'number') {
      return (
        <div className="metric-badges">
          <div className="metric-badge">
            <span>{report.name}</span>
            <strong>{formatNumber(report.value, 2)}</strong>
          </div>
        </div>
      )
    }

    const rows = Array.isArray(report.dataPreview) ? report.dataPreview : []
    if (!rows.length) {
      return <div className="empty-state">No data available.</div>
    }

    // Grouped/aggregate Optimize reports return rows shaped { key, label, value }.
    if (report.visualization === 'pie') {
      const pieData = rows.slice(0, 6).map((row, index) => ({
        label: row.label || row.key || `Segment ${index + 1}`,
        value: Number(row.value) || 0,
        color: PIE_COLORS[index % PIE_COLORS.length],
      }))
      const pieStyle = buildPieStyle(pieData)

      return (
        <div className="pie-wrap">
          <div className="pie-chart" style={pieStyle} />
          <div className="pie-legend">
            {pieData.map((item) => (
              <div key={`${report.id}-legend-${item.label}`} className="legend-item">
                <span className="legend-dot" style={{ background: item.color }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    const maxValue = Math.max(...rows.map((row) => Number(row.value) || 0), 1)
    return (
      <div className="mini-bars" aria-label={`${report.name} chart`}>
        {rows.slice(0, 8).map((row, index) => (
          <div key={`${report.id}-bar-${index}`} className="mini-bar-group">
            <span
              className="mini-bar"
              style={{ height: `${Math.min(100, ((Number(row.value) || 0) / maxValue) * 100)}%` }}
            />
            <small title={row.label || row.key}>{String(row.label || row.key || `#${index + 1}`).slice(0, 8)}</small>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Camunda Optimize</p>
          <h1>Application Lifecycle Processing</h1>
        </div>
        <div className="topbar-meta">
          <span className="meta-pill">Dashboard: {dashboardId}</span>
          <span className="meta-pill">Process: {processDefinitionKey}</span>
        </div>
      </header>

      <nav className="tab-row" aria-label="Main navigation">
        {['Dashboard', 'Process Instances', 'Tasklist'].map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {error && <div className="page-error">{error}</div>}

      {activeTab === 'Dashboard' && (
        <>
          <section className="kpi-grid">
            <article className="kpi-card accent">
              <span>Total reports</span>
              <strong>{summary.totalReports}</strong>
              <small>Visible in dashboard</small>
            </article>
            <article className="kpi-card">
              <span>Records tracked</span>
              <strong>{summary.totalRecords}</strong>
              <small>Latest export data</small>
            </article>
            <article className="kpi-card">
              <span>Average metric</span>
              <strong>{formatNumber(summary.avgMetric, 2)}</strong>
              <small>Across active rows</small>
            </article>
            <article className="kpi-card">
              <span>Process key</span>
              <strong>{processDefinitionKey}</strong>
              <small>Filtered by process</small>
            </article>
          </section>

          <section className="panel-grid">
            <article className="panel panel-large">
              <div className="panel-header">
                <h2>Dashboard reports</h2>
                <span>{dashboardCards.length} report cards</span>
              </div>
              <div className="report-grid">
                {dashboardCards.length ? dashboardCards.map((report) => (
                  <article key={report.id || report.name} className="report-card">
                    <div className="report-head">
                      <div>
                        <p className="report-label">{report.type || 'dashboard'}</p>
                        <h3>{report.name || 'Report'}</h3>
                      </div>
                    </div>
                    {renderDashboardVisual(report)}
                  </article>
                )) : <div className="empty-state">No dashboard reports available.</div>}
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <h2>Trend snapshot</h2>
                <span>Current cycle</span>
              </div>
              <div className="mini-bars wide-bars" aria-label="Trend bar chart">
                {summary.trend.length ? summary.trend.map((point, index) => (
                  <div key={`${point.report}-${index}`} className="mini-bar-group">
                    <span className="mini-bar" style={{ height: `${Math.min(100, (point.value / Math.max(1, Math.max(...summary.trend.map((item) => item.value))) * 100))}%` }} />
                    <small>{point.report.slice(0, 6)}</small>
                  </div>
                )) : <div className="empty-state">No trend data available.</div>}
              </div>
            </article>
          </section>
        </>
      )}

      {activeTab === 'Process Instances' && (
        <section className="panel panel-full">
          <div className="panel-header stack-header">
            <div>
              <h2>Process instances</h2>
              <span>Filtered by process key {processInstanceKey}</span>
            </div>
            <div className="chip-group">
              {['all', 'running', 'completed', 'cancelled', 'failed'].map((state) => (
                <button
                  key={state}
                  type="button"
                  className={processFilter === state ? 'chip active' : 'chip'}
                  onClick={() => setProcessFilter(state)}
                >
                  {state}
                </button>
              ))}
            </div>
          </div>

          {loadingInstances ? (
            <div className="loading-box">Loading process instances...</div>
          ) : (
            <div className="instance-list">
              {filteredInstances.length ? filteredInstances.map((instance) => (
                <article key={instance.id || instance.key || instance.processInstanceKey} className="instance-card">
                  <div>
                    <p className="instance-label">Process Instance</p>
                    <h3>{instance.processInstanceKey || instance.key || 'Unknown instance'}</h3>
                  </div>
                  <div className="instance-meta">
                    <span className={`state-badge ${instance.state || 'running'}`}>{instance.state || 'running'}</span>
                    <span>{instance.startDate || instance.createdAt || 'N/A'}</span>
                  </div>
                </article>
              )) : <div className="empty-state">No process instances found for this state.</div>}
            </div>
          )}
        </section>
      )}

      {activeTab === 'Tasklist' && (
        <section className="panel panel-full">
          <div className="panel-header stack-header">
            <div>
              <h2>Tasklist</h2>
              <span>Relevant tasks for instance {processInstanceKey}</span>
            </div>
          </div>

          {loadingTasks ? (
            <div className="loading-box">Loading tasks...</div>
          ) : (
            <div className="task-layout">
              <div className="task-list">
                {tasks.length ? tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={selectedTask?.id === task.id ? 'task-item selected' : 'task-item'}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <strong>{task.name || task.title || task.id}</strong>
                    <span>{task.assignee || 'Unassigned'}</span>
                    <small>{task.processInstanceKey || processInstanceKey}</small>
                  </button>
                )) : <div className="empty-state">No tasks found.</div>}
              </div>

              {selectedTask ? (
                <form className="task-form" onSubmit={handleTaskSubmit}>
                  <div className="task-form-header">
                    <div>
                      <p className="instance-label">Selected task</p>
                      <h3>{selectedTask.name || selectedTask.title || selectedTask.id}</h3>
                    </div>
                    <span className="state-badge pending">{selectedTask.status || 'open'}</span>
                  </div>

                  {Object.entries(selectedTask.variables || {}).map(([fieldKey, fieldValue]) => (
                    <label key={`${selectedTask.id}-${fieldKey}`} className="field-row">
                      <span>{fieldKey}</span>
                      <input
                        type={typeof fieldValue === 'number' ? 'number' : 'text'}
                        value={taskForm[fieldKey] ?? ''}
                        onChange={(event) => handleTaskInputChange(fieldKey, event.target.value)}
                      />
                    </label>
                  ))}

                  <button type="submit" className="submit-button">Submit task</button>
                </form>
              ) : null}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default App
