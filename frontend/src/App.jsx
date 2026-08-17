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

function formatCurrency(value, digits = 3) {
  const num = Number(value)
  if (!Number.isFinite(num)) return `$${Number(0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

function formatDuration(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0.00 min'
  const abs = Math.abs(num)
  let minutes = num

  if (abs >= 60000) {
    minutes = num / 60000
  } else if (abs >= 60) {
    minutes = num / 60
  }

  return `${formatNumber(minutes, 2)} min`
}

function convertDurationToMinutes(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0

  const abs = Math.abs(num)
  if (abs >= 60000) return num / 60000
  if (abs >= 60) return num / 60
  return num
}

function inferReportKind(name = '') {
  const normalized = String(name).toLowerCase()

  if (
    normalized.includes('heatmap')
    || normalized.includes('duration')
    || normalized.includes('user task duration')
    || normalized.includes('financial aid extraction')
    || normalized.includes('financial aid form extraction')
  ) {
    return 'duration'
  }

  if (
    normalized.includes('composition')
    || normalized.includes('classification')
    || normalized.includes('breakdown')
    || normalized.includes('user task composition')
  ) {
    return 'composition'
  }

  if (normalized.includes('token cost') || normalized.includes('cost') || normalized.includes('token-cost')) return 'token-cost'
  if (normalized.includes('token count')) return 'token-count'
  if (normalized.includes('token')) return 'token-count'
  return 'default'
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
  const [instanceSearch, setInstanceSearch] = useState('')
  const [selectedInstance, setSelectedInstance] = useState(null)
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
          setInstances([])
          return
        }
        const payload = await response.json()
        setInstances(Array.isArray(payload) ? payload : payload.items || [])
      } catch (err) {
        setInstances([])
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

  const normalizeInstanceState = (state) => {
    if (!state) return 'all'
    const normalized = String(state).toLowerCase()
    if (normalized === 'completed' || normalized === 'COMPLETED') return 'completed'
    if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'CANCELED' || normalized === 'CANCELLED') return 'cancelled'
    if (normalized === 'failed' || normalized === 'FAILED') return 'failed'
    if (normalized === 'active' || normalized === 'running' || normalized === 'ACTIVE') return 'active'
    return normalized
  }

  const buildInstanceDetail = (instance) => {
    const key = instance.processInstanceKey || instance.key || instance.id || 'Unknown instance'
    const processName = instance.processDefinitionKey || instance.processDefinitionId || instance.processName || 'Process'
    const started = instance.startDate || instance.createdAt || 'N/A'
    const ended = instance.endDate || instance.completedAt || instance.updatedAt || 'N/A'
    const status = normalizeInstanceState(instance.state || 'active')

    const variables = Object.entries(instance.variables || {}).map(([name, value]) => ({
      name,
      value: typeof value === 'object' && value !== null && 'value' in value ? value.value : value,
      status: status === 'failed' ? 'failed' : status === 'completed' ? 'completed' : 'ongoing',
    }))

    const subprocesses = Array.isArray(instance.subprocesses)
      ? instance.subprocesses.map((subprocess) => ({
          name: subprocess.name || subprocess.elementId || 'Subprocess',
          duration: Number(subprocess.duration || subprocess.elapsedTime || 0) / 60,
          status: normalizeInstanceState(subprocess.state || status),
        }))
      : []

    const conversation = Array.isArray(instance.conversation)
      ? instance.conversation.map((entry) => ({
          sender: entry.sender || 'agent',
          message: entry.message || entry.text || '',
        }))
      : []

    return {
      key,
      processName,
      version: instance.version || 'v6',
      started,
      ended,
      status,
      variables: variables.length ? variables : [],
      subprocesses,
      conversation,
    }
  }

  const filteredInstances = useMemo(() => {
    let nextInstances = [...instances]

    if (processFilter !== 'all') {
      nextInstances = nextInstances.filter((instance) => normalizeInstanceState(instance.state) === processFilter)
    }

    if (instanceSearch.trim()) {
      const query = instanceSearch.trim().toLowerCase()
      nextInstances = nextInstances.filter((instance) => {
        const key = String(instance.processInstanceKey || instance.key || instance.id || '').toLowerCase()
        const process = String(instance.processDefinitionKey || instance.processDefinitionId || instance.processName || '').toLowerCase()
        return key.includes(query) || process.includes(query)
      })
    }

    return nextInstances
  }, [instances, processFilter, instanceSearch])

  const processInstanceCounts = useMemo(() => {
    const counts = { all: instances.length, completed: 0, cancelled: 0, failed: 0 }
    instances.forEach((instance) => {
      const state = normalizeInstanceState(instance.state)
      if (state === 'completed') counts.completed += 1
      if (state === 'cancelled') counts.cancelled += 1
      if (state === 'failed') counts.failed += 1
    })
    return counts
  }, [instances])

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

  const submitTaskCompletion = async (task, formValues = {}) => {
    if (!task) return

    const variables = Object.fromEntries(
      Object.entries(formValues).map(([key, value]) => {
        const numericValue = Number(value)
        return [key, Number.isFinite(numericValue) && String(value).trim() !== '' ? numericValue : value]
      }),
    )

    const response = await fetch(`${apiBase}/api/tasks/${task.id}/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables }),
    })

    if (!response.ok) {
      throw new Error('Unable to submit task')
    }

    setTasks((current) => current.filter((nextTask) => nextTask.id !== task.id))
    if (selectedTaskId === task.id) {
      setSelectedTaskId('')
    }
  }

  const reassignTask = async (task, assigneeValue) => {
    if (!task) return

    const nextAssignee = String(assigneeValue ?? task.assignee ?? '').trim() || 'unassigned'

    const response = await fetch(`${apiBase}/api/tasks/${task.id}/assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee: nextAssignee }),
    })

    if (!response.ok) {
      throw new Error('Unable to reassign task')
    }

    setTasks((current) => current.map((nextTask) => (
      nextTask.id === task.id ? { ...nextTask, assignee: nextAssignee } : nextTask
    )))
  }

  const handleTaskSubmit = async (event) => {
    event.preventDefault()
    if (!selectedTask) return
    await submitTaskCompletion(selectedTask, taskForm)
  }

  const renderDashboardVisual = (report) => {
    const reportName = report.name || ''
    const rows = Array.isArray(report.dataPreview) ? report.dataPreview : []
    const kind = inferReportKind(reportName)

    if (kind === 'token-cost') {
      return (
        <div className="metric-card-body">
          <div className="metric-value">{formatCurrency(report.value)}</div>
        </div>
      )
    }

    if (kind === 'token-count') {
      return (
        <div className="metric-card-body">
          <div className="metric-value">{formatNumber(report.value, 2)}</div>
        </div>
      )
    }

    if (kind === 'duration') {
      const durationRows = (rows.length ? rows : [{ value: report.value, label: report.name || 'Value' }]).map((row) => ({
        ...row,
        value: convertDurationToMinutes(row.value),
      }))
      const maxValue = Math.max(...durationRows.map((row) => Number(row.value) || 0), 1)
      const yTicks = Array.from({ length: 5 }, (_, index) => {
        const tickValue = maxValue * (index / 4)
        return Math.round(tickValue * 100) / 100
      }).reverse()

      const isSingleBarReport = reportName.toLowerCase().includes('financial aid extraction') || reportName.toLowerCase().includes('overall process heatmap')

      if (isSingleBarReport) {
        const normalizedReportName = reportName.toLowerCase()
        const preferredRow = durationRows.find((row) => {
          const label = String(row.label || row.key || row.name || '').toLowerCase()
          if (normalizedReportName.includes('financial aid extraction')) {
            return label.includes('financial aid') || label.includes('extraction') || label.includes('incident')
          }
          if (normalizedReportName.includes('overall process heatmap')) {
            return label.includes('overall') || label.includes('process') || label.includes('heatmap') || label.includes('total')
          }
          return false
        }) || durationRows.reduce((best, current) => {
          const bestValue = Number(best?.value) || 0
          const currentValue = Number(current?.value) || 0
          return currentValue > bestValue ? current : best
        }, durationRows[0] || { value: report.value, label: report.name || 'Value' })

        const primaryRow = preferredRow || { value: report.value, label: report.name || 'Value' }
        const label = String(primaryRow.label || primaryRow.key || primaryRow.name || 'Value')
        const barValue = Number(primaryRow.value) || 0

        return (
          <div className="chart-with-axes compact-chart">
            <div className="chart-y-axis-label">Time (minutes)</div>
            <div className="chart-plot-area compact-plot-area">
              <div className="y-axis-scale compact-y-axis" aria-hidden="true">
                {yTicks.map((tick) => (
                  <span key={`tick-${tick}`} className="y-axis-tick">{formatNumber(tick, 2)}</span>
                ))}
              </div>
              <div className="single-bar-chart-shell" aria-label={`${report.name} single bar chart`}>
                <div className="bar-chart-column single-bar-column">
                  <span
                    className="report-bar single-report-bar"
                    style={{ height: `${Math.min(100, (barValue / maxValue) * 100)}%` }}
                  />
                  <span className="bar-chart-label">{label.slice(0, 12)}</span>
                </div>
              </div>
            </div>
            <div className="chart-x-axis-label">Process / task name</div>
          </div>
        )
      }

      return (
        <div className="chart-with-axes">
          <div className="chart-y-axis-label">Time (minutes)</div>
          <div className="chart-plot-area">
            <div className="y-axis-scale" aria-hidden="true">
              {yTicks.map((tick) => (
                <span key={`tick-${tick}`} className="y-axis-tick">{formatNumber(tick, 2)}</span>
              ))}
            </div>
            <div className="bar-chart-shell" aria-label={`${report.name} duration chart`}>
              {durationRows.slice(0, 9).map((row, index) => {
                const label = String(row.label || row.key || row.name || `Item ${index + 1}`)
                const barValue = Number(row.value) || 0

                return (
                  <div key={`${report.id}-duration-${index}`} className="bar-chart-column">
                    <span
                      className="report-bar"
                      style={{ height: `${Math.min(100, (barValue / maxValue) * 100)}%` }}
                    />
                    <span className="bar-chart-label">{label.slice(0, 10)}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="chart-x-axis-label">Process / task name</div>
        </div>
      )
    }

    if (kind === 'composition' || report.visualization === 'pie') {
      const pieData = rows.slice(0, 6).map((row, index) => ({
        label: row.label || row.key || `Segment ${index + 1}`,
        value: Number(row.value) || 0,
        color: PIE_COLORS[index % PIE_COLORS.length],
      }))

      const pieStyle = buildPieStyle(pieData)

      return (
        <div className="composition-card">
          <div className="pie-card-shell">
            <div
              className="pie-chart-large"
              style={pieStyle}
              onMouseEnter={(event) => {
                const tooltip = pieData.map((item) => `${item.label}: ${formatNumber(item.value, 2)}`).join('\n')
                const node = event.currentTarget.parentElement.parentElement.querySelector('.hover-tooltip')
                if (node) {
                  node.textContent = tooltip
                  node.classList.add('visible')
                }
              }}
              onMouseMove={(event) => {
                const node = event.currentTarget.parentElement.parentElement.querySelector('.hover-tooltip')
                if (!node) return
                node.style.left = `${event.clientX - event.currentTarget.getBoundingClientRect().left + 18}px`
                node.style.top = `${event.clientY - event.currentTarget.getBoundingClientRect().top - 10}px`
              }}
              onMouseLeave={(event) => {
                const node = event.currentTarget.parentElement.parentElement.querySelector('.hover-tooltip')
                if (node) node.classList.remove('visible')
              }}
              aria-label={pieData.map((item) => `${item.label}: ${formatNumber(item.value, 2)}`).join(', ')}
            />
            <div className="hover-tooltip" aria-live="polite" />
          </div>
          <div className="pie-legend">
            {pieData.map((item) => (
              <div key={`${report.id}-${item.label}`} className="pie-legend-item">
                <span className="legend-swatch" style={{ background: item.color }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (report.resultType === 'number') {
      return (
        <div className="metric-card-body">
          <div className="metric-value">{formatNumber(report.value, 2)}</div>
        </div>
      )
    }

    if (!rows.length) {
      return <div className="empty-state">No data available.</div>
    }

    const maxValue = Math.max(...rows.map((row) => Number(row.value) || 0), 1)
    return (
      <div className="bar-chart-shell" aria-label={`${report.name} chart`}>
        <div className="bar-chart-grid" />
        {rows.slice(0, 8).map((row, index) => (
          <div key={`${report.id}-bar-${index}`} className="bar-chart-column">
            <span
              className="report-bar"
              style={{ height: `${Math.min(100, ((Number(row.value) || 0) / maxValue) * 100)}%` }}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <img className="brand-logo" src="/src/assets/logo.svg" alt="Application Lifecycle Processing" />
          <div className="brand-copy">
            <div className="brand-subtitle">Application Lifecycle Processing</div>
          </div>
        </div>

        <nav className="tab-row" aria-label="Main navigation">
          {['Dashboard', 'Process Instances', 'Tasklist'].map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? 'tab-button active' : 'tab-button'}
              onClick={() => setActiveTab(tab)}
            >
              <span className="tab-icon" aria-hidden="true">
                {tab === 'Dashboard' ? '▣' : tab === 'Process Instances' ? '↻' : '☑'}
              </span>
              {tab}
            </button>
          ))}
        </nav>
      </header>

      {error && !error.toLowerCase().includes('process instances request failed with code') && <div className="page-error">{error}</div>}

      {activeTab === 'Dashboard' && (
        <main className="dashboard-page">
          <div className="page-title-row">
            <h1>Dashboard</h1>
            <p>Showing {dashboardCards.length} reports from Camunda Optimize</p>
          </div>

          <section className="report-cards-grid">
            {dashboardCards.length ? dashboardCards.map((report) => (
              <article key={report.id || report.name} className="report-card">
                <div className="report-card-header">
                  <h3>{report.name || 'Report'}</h3>
                </div>
                {renderDashboardVisual(report)}
              </article>
            )) : <div className="empty-state">No dashboard reports available.</div>}
          </section>
        </main>
      )}

      {activeTab === 'Process Instances' && (
        <section className="instances-page">
          <div className="instances-header-row">
            <div>
              <h2>Process Instances</h2>
              <p>Monitor and inspect workflow executions from Camunda Operate</p>
            </div>
            <button type="button" className="refresh-button">↻ Refresh</button>
          </div>

          <div className="instances-toolbar">
            <div className="search-box">
              <span className="search-icon">⌕</span>
              <input
                type="text"
                value={instanceSearch}
                onChange={(event) => setInstanceSearch(event.target.value)}
                placeholder="Search by instance key or process id..."
              />
            </div>

            <div className="toolbar-select-group">
              <button type="button" className="toolbar-select">All Processes <span>▾</span></button>
              <button type="button" className="toolbar-select">All Versions <span>▾</span></button>
            </div>
          </div>

          <div className="status-filter-row">
            {['all', 'completed', 'cancelled', 'failed'].map((state) => (
              <button
                key={state}
                type="button"
                className={processFilter === state ? 'status-pill active' : 'status-pill'}
                onClick={() => setProcessFilter(state)}
              >
                <span className="status-pill-label">{state === 'all' ? 'All' : state.charAt(0).toUpperCase() + state.slice(1)}</span>
                <span className="status-pill-count">{state === 'all' ? processInstanceCounts.all : processInstanceCounts[state] || 0}</span>
              </button>
            ))}
          </div>

          {loadingInstances ? (
            <div className="loading-box">Loading process instances...</div>
          ) : (
            <div className="instance-grid">
              {filteredInstances.length ? filteredInstances.map((instance) => {
                const detail = buildInstanceDetail(instance)
                const instanceState = normalizeInstanceState(instance.state)
                const stateClass = instanceState === 'completed' ? 'status-completed' : instanceState === 'cancelled' ? 'status-cancelled' : instanceState === 'failed' ? 'status-failed' : 'status-active'

                return (
                  <article key={instance.id || instance.key || instance.processInstanceKey} className="instance-dashboard-card" onClick={() => setSelectedInstance(detail)}>
                    <div className="instance-card-header">
                      <div className="instance-key-block">INSTANCE KEY</div>
                      <span className={`mini-status ${stateClass}`}>{instanceState.toUpperCase()}</span>
                    </div>

                    <div className="instance-key-value">#{instance.processInstanceKey || instance.key || 'Unknown instance'}</div>

                    <div className="process-title-block">
                      <span className="process-label">PROCESS</span>
                      <div className="process-name">{instance.processDefinitionKey || instance.processDefinitionId || detail.processName}</div>
                      <div className="process-version">Version {detail.version}</div>
                    </div>

                    <div className="instance-meta-grid">
                      <div className="meta-row"><span>Started</span><strong>{detail.started}</strong></div>
                      <div className="meta-row"><span>Ended</span><strong>{detail.ended}</strong></div>
                    </div>

                    <button type="button" className="view-button">View Variables →</button>
                  </article>
                )
              }) : <div className="empty-state">No process instances found for this state.</div>}
            </div>
          )}

          {selectedInstance && (
            <div className="instance-modal-backdrop" onClick={() => setSelectedInstance(null)}>
              <div className="instance-modal" onClick={(event) => event.stopPropagation()}>
                <div className="instance-modal-header">
                  <div>
                    <span className="modal-label">Instance key</span>
                    <h3>{selectedInstance.key}</h3>
                  </div>
                  <button type="button" className="modal-close" onClick={() => setSelectedInstance(null)}>×</button>
                </div>

                <div className="modal-status-row">
                  <span className={`mini-status ${selectedInstance.status === 'completed' ? 'status-completed' : selectedInstance.status === 'cancelled' ? 'status-cancelled' : selectedInstance.status === 'failed' ? 'status-failed' : 'status-active'}`}>
                    {selectedInstance.status.toUpperCase()}
                  </span>
                  <span className="modal-process-name">{selectedInstance.processName}</span>
                </div>

                <div className="detail-grid">
                  <div className="detail-panel">
                    <h4>Process variables</h4>
                    <div className="variable-list">
                      {selectedInstance.variables.map((variable) => (
                        <div key={variable.name} className="variable-row">
                          <div className="variable-name">{variable.name}</div>
                          <div className="variable-value">{variable.value}</div>
                          <span className={`variable-state ${variable.status}`}>{variable.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="detail-panel">
                    <h4>Subprocesses</h4>
                    <div className="subprocess-list">
                      {selectedInstance.subprocesses.map((subprocess) => (
                        <div key={subprocess.name} className="subprocess-row">
                          <div>
                            <div className="subprocess-name">{subprocess.name}</div>
                            <div className="subprocess-duration">Duration: {subprocess.duration} min</div>
                          </div>
                          <span className={`subprocess-status ${subprocess.status}`}>{subprocess.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="chat-panel">
                  <h4>AI agent conversation</h4>
                  <div className="chat-thread">
                    {selectedInstance.conversation.map((entry, index) => (
                      <div key={`${entry.sender}-${index}`} className={`chat-bubble ${entry.sender}`}>
                        <span className="chat-author">{entry.sender === 'agent' ? 'AI Agent' : 'Client'}</span>
                        <p>{entry.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'Tasklist' && (
        <section className="tasklist-page">
          <div className="page-title-row tasklist-header">
            <div>
              <h1>Tasklist</h1>
              <p>Relevant tasks for instance {processInstanceKey || 'all active processes'}</p>
            </div>
          </div>

          {loadingTasks ? (
            <div className="loading-box">Loading tasks...</div>
          ) : (
            <div className="task-layout">
              <div className="task-list-panel">
                <div className="task-list-header-row">
                  <h3>Tasks</h3>
                  <span className="task-count-badge">{tasks.length}</span>
                </div>

                <div className="task-list">
                  {tasks.length ? tasks.map((task) => (
                    <div
                      key={task.id}
                      className={selectedTask?.id === task.id ? 'task-item selected' : 'task-item'}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <div className="task-item-topline">
                        <strong>{task.name || task.title || task.id}</strong>
                        <span className="state-badge pending">{task.status || 'open'}</span>
                      </div>
                      <span className="task-meta">Task ID: {task.id}</span>
                      <span className="task-meta">Assignee: {task.assignee || 'Unassigned'}</span>
                      <small>{task.processInstanceKey || processInstanceKey}</small>

                      <div className="task-card-actions">
                        <button
                          type="button"
                          className="task-action-button primary"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedTaskId(task.id)
                            void submitTaskCompletion(task, task.variables || {})
                          }}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          className="task-action-button secondary"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedTaskId(task.id)
                            void reassignTask(task, task.assignee || 'unassigned')
                          }}
                        >
                          Reassign
                        </button>
                      </div>
                    </div>
                  )) : <div className="empty-state">No tasks found.</div>}
                </div>
              </div>

              {selectedTask ? (
                <form className="task-form-panel" onSubmit={handleTaskSubmit}>
                  <div className="task-form-header">
                    <div>
                      <p className="instance-label">Selected task</p>
                      <h3>{selectedTask.name || selectedTask.title || selectedTask.id}</h3>
                    </div>
                    <span className="state-badge pending">{selectedTask.status || 'open'}</span>
                  </div>

                  <div className="field-list">
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
                  </div>

                  <div className="task-form-actions">
                    <button type="submit" className="submit-button">Submit task</button>
                    <button
                      type="button"
                      className="secondary-action-button"
                      onClick={() => void reassignTask(selectedTask, selectedTask.assignee || 'unassigned')}
                    >
                      Reassign task
                    </button>
                  </div>
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
