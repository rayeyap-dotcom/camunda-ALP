import { useEffect, useMemo, useState } from 'react'
import './App.css'
import logoUrl from './assets/logo.svg'

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

function parseCamundaDuration(rawValue) {
  if (rawValue === null || rawValue === undefined) return 0

  const numValue = Number(rawValue)
  if (Number.isFinite(numValue)) {
    return convertDurationToMinutes(numValue)
  }

  const strValue = String(rawValue).trim().toLowerCase()
  if (!strValue) return 0

  let totalMinutes = 0
  const daysMatch = strValue.match(/(\d+(?:\.\d+)?)\s*days?/)
  const hoursMatch = strValue.match(/(\d+(?:\.\d+)?)\s*hours?/)
  const minutesMatch = strValue.match(/(\d+(?:\.\d+)?)\s*minutes?|mins?/)
  const secondsMatch = strValue.match(/(\d+(?:\.\d+)?)\s*seconds?|secs?/)
  const millisMatch = strValue.match(/(\d+(?:\.\d+)?)\s*milliseconds?|ms/)

  if (daysMatch) totalMinutes += Number(daysMatch[1]) * 1440
  if (hoursMatch) totalMinutes += Number(hoursMatch[1]) * 60
  if (minutesMatch) totalMinutes += Number(minutesMatch[1])
  if (secondsMatch) totalMinutes += Number(secondsMatch[1]) / 60
  if (millisMatch) totalMinutes += Number(millisMatch[1]) / 60000

  return totalMinutes
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

function normalizeConversationSender(sender = '') {
  const normalized = String(sender).trim().toLowerCase()
  if (['user', 'client', 'human', 'customer'].includes(normalized)) return 'client'
  if (['agent', 'ai', 'assistant', 'bot', 'system', 'reasoning', 'thought'].includes(normalized)) return 'agent'
  return normalized === 'client' ? 'client' : 'agent'
}

function parseVariableValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return { value: '—', duration: '', status: 'Passed' }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim()
    if (!trimmed) return { value: '', duration: '', status: 'Passed' }

    try {
      const parsed = JSON.parse(trimmed)
      return {
        value: parsed,
        duration: '',
        status: 'Passed',
      }
    } catch {
      return {
        value: rawValue,
        duration: '',
        status: 'Passed',
      }
    }
  }

  if (typeof rawValue === 'object') {
    const value = 'value' in rawValue ? rawValue.value : rawValue
    const duration = 'duration' in rawValue ? rawValue.duration : ('elapsedTime' in rawValue ? rawValue.elapsedTime : '')
    const status = rawValue.status || rawValue.state || (rawValue.failed ? 'Failed' : 'Passed')
    return {
      value,
      duration,
      status: String(status).toLowerCase() === 'failed' ? 'Failed' : 'Passed',
    }
  }

  return {
    value: rawValue,
    duration: '',
    status: 'Passed',
  }
}

function formatVariableDisplay(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function describeVariableType(value) {
  if (value === null || value === undefined) return 'empty'
  if (Array.isArray(value)) return `array · ${value.length}`
  if (typeof value === 'object') return `object · ${Object.keys(value).length}`
  return typeof value
}

function previewVariableValue(value) {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length ? `${value.length} item${value.length === 1 ? '' : 's'}` : 'empty array'
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    return keys.length ? keys.slice(0, 4).join(', ') + (keys.length > 4 ? ', …' : '') : 'empty object'
  }
  const text = String(value)
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

const VARIABLE_TREE_MAX_DEPTH = 5

function VariableTree({ value, depth = 0 }) {
  if (value === null || value === undefined || value === '') {
    return <span className="var-empty">—</span>
  }

  if (depth > VARIABLE_TREE_MAX_DEPTH) {
    return <span className="var-empty">{previewVariableValue(value)} (nested too deep to expand)</span>
  }

  if (Array.isArray(value)) {
    if (!value.length) return <span className="var-empty">Empty list</span>
    return (
      <ol className="var-list">
        {value.map((item, index) => (
          <li key={index} className="var-list-item">
            <VariableTree value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    )
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (!keys.length) return <span className="var-empty">Empty object</span>
    return (
      <dl className="var-fields">
        {keys.map((key) => (
          <div className="var-field" key={key}>
            <dt className="var-field-key">{key}</dt>
            <dd className="var-field-value"><VariableTree value={value[key]} depth={depth + 1} /></dd>
          </div>
        ))}
      </dl>
    )
  }

  if (typeof value === 'boolean') {
    return <span className="var-scalar">{value ? 'true' : 'false'}</span>
  }

  const text = String(value)
  if (text.includes('\n') || text.length > 200) {
    return <pre className="var-longtext">{text}</pre>
  }
  return <span className="var-scalar">{text}</span>
}

function normalizeVariableList(rawVariables) {
  console.log('[DEBUG] normalizeVariableList: input', { type: typeof rawVariables, isArray: Array.isArray(rawVariables), value: rawVariables })

  if (!rawVariables) {
    console.log('[DEBUG] normalizeVariableList: rawVariables is falsy, returning empty array')
    return []
  }

  if (Array.isArray(rawVariables)) {
    console.log('[DEBUG] normalizeVariableList: processing array', { length: rawVariables.length, items: rawVariables })
    const mapped = rawVariables.map((item, idx) => {
      const name = item.name || item.key || item.variableName || item.field || 'unknown'
      const value = item.value ?? item.rawValue ?? item.variableValue ?? item
      const parsed = parseVariableValue(value)
      const durationValue = Number(parsed.duration)

      console.log(`[DEBUG] normalizeVariableList: item[${idx}]`, { name, value, parsed })

      return {
        name,
        value: parsed.value,
        duration: Number.isFinite(durationValue) ? `${formatNumber(durationValue / 60000, 2)} min` : parsed.duration || '—',
        status: parsed.status === 'Failed' ? 'Failed' : 'Passed',
      }
    })
    console.log('[DEBUG] normalizeVariableList: array mapping complete', { count: mapped.length })
    return mapped
  }

  if (typeof rawVariables === 'object') {
    const keys = Object.keys(rawVariables)
    console.log('[DEBUG] normalizeVariableList: processing object', { keys, rawValue: rawVariables })
    const mapped = Object.entries(rawVariables).map(([name, value], idx) => {
      const parsed = parseVariableValue(value)
      const durationValue = Number(parsed.duration)

      console.log(`[DEBUG] normalizeVariableList: entry[${idx}](${name})`, { value, parsed })

      return {
        name,
        value: parsed.value,
        duration: Number.isFinite(durationValue) ? `${formatNumber(durationValue / 60000, 2)} min` : parsed.duration || '—',
        status: parsed.status === 'Failed' ? 'Failed' : 'Passed',
      }
    })
    console.log('[DEBUG] normalizeVariableList: object mapping complete', { count: mapped.length })
    return mapped
  }

  console.log('[DEBUG] normalizeVariableList: returning empty array, type not recognized', { type: typeof rawVariables })
  return []
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
  const [expandedVariables, setExpandedVariables] = useState(() => new Set())
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [loadingInstances, setLoadingInstances] = useState(true)
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [refreshingTasks, setRefreshingTasks] = useState(false)
  const [error, setError] = useState('')

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || tasks[0] || null,
    [tasks, selectedTaskId],
  )

  const fetchDashboard = async () => {
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

  const fetchInstances = async () => {
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

  const fetchTasks = async ({ suppressLoading = false } = {}) => {
    try {
      if (!suppressLoading) {
        setLoadingTasks(true)
      }
      setRefreshingTasks(!suppressLoading)
      const params = new URLSearchParams({ processInstanceKey })
      const url = `${apiBase}/api/tasklist?${params.toString()}`
      console.log('[DEBUG] fetchTasks: requesting', { url, processInstanceKey })

      const response = await fetch(url)
      console.log('[DEBUG] fetchTasks: response', { status: response.status, ok: response.ok })

      if (!response.ok) {
        throw new Error(`Tasklist request failed with code ${response.status}`)
      }
      const payload = await response.json()
      console.log('[DEBUG] fetchTasks: payload received', { payloadType: typeof payload, isArray: Array.isArray(payload), count: Array.isArray(payload) ? payload.length : payload.items ? payload.items.length : 0, payload })

      const nextTasks = Array.isArray(payload) ? payload : payload.items || []
      console.log('[DEBUG] fetchTasks: normalized tasks', { count: nextTasks.length, taskIds: nextTasks.map((t) => t.id || t.userTaskKey) })

      setTasks(nextTasks)
      if (!selectedTaskId && nextTasks[0]) {
        setSelectedTaskId(nextTasks[0].id)
      }
    } catch (err) {
      console.error('[DEBUG] fetchTasks: error', { error: err.message })
      setError(err.message)
    } finally {
      setLoadingTasks(false)
      setRefreshingTasks(false)
    }
  }

  const fetchInstanceVariables = async (instanceKey) => {
    if (!instanceKey) {
      console.warn('[DEBUG] fetchInstanceVariables: instanceKey is empty or falsy', { instanceKey })
      return []
    }

    console.log('[DEBUG] fetchInstanceVariables: starting fetch', { instanceKey, apiBase })

    try {
      const url = `${apiBase}/api/process-instances/${instanceKey}/variables`
      console.log('[DEBUG] fetchInstanceVariables: requesting URL', { url })

      const response = await fetch(url)
      console.log('[DEBUG] fetchInstanceVariables: response received', { status: response.status, statusText: response.statusText, ok: response.ok })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error('[DEBUG] fetchInstanceVariables: response not ok', { status: response.status, errorBody, url })
        return []
      }

      const payload = await response.json()
      console.log('[DEBUG] fetchInstanceVariables: RAW API PAYLOAD', { payloadType: typeof payload, isArray: Array.isArray(payload), payloadLength: Array.isArray(payload) ? payload.length : 'n/a', payload })

      const normalized = normalizeVariableList(payload)
      console.log('[DEBUG] fetchInstanceVariables: normalized variables', { normalizedLength: normalized.length, normalized })

      if (normalized.length === 0) {
        console.warn('[DEBUG] fetchInstanceVariables: EMPTY RESULT - check backend logs', { url, instanceKey, payload })
      }

      return normalized
    } catch (err) {
      console.error('[DEBUG] fetchInstanceVariables: caught error', { error: err.message, stack: err.stack, url: `${apiBase}/api/process-instances/${instanceKey}/variables` })
      return []
    }
  }

  const refreshAllData = async () => {
    setError('')
    setLoadingInstances(true)
    setLoadingTasks(true)
    setLoadingDashboard(true)
    await Promise.all([fetchDashboard(), fetchInstances(), fetchTasks({ suppressLoading: false })])
  }

  useEffect(() => {
    void fetchDashboard()
    void fetchInstances()
    void fetchTasks()
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
    const processName = instance.processDefinitionName || instance.processName || instance.processDefinitionKey || instance.processDefinitionId || 'Process'
    const started = instance.startDate || instance.createdAt || 'N/A'
    const ended = instance.endDate || instance.completedAt || instance.updatedAt || 'N/A'
    const status = normalizeInstanceState(instance.state || 'active')

    const variablesFromInstance = normalizeVariableList(instance.variables || [])

    const subprocesses = Array.isArray(instance.subprocesses)
      ? instance.subprocesses.map((subprocess) => ({
          name: subprocess.name || subprocess.elementId || 'Subprocess',
          duration: Number(subprocess.duration || subprocess.elapsedTime || 0) / 60,
          status: normalizeInstanceState(subprocess.state || status),
        }))
      : []

    const conversation = Array.isArray(instance.conversation)
      ? instance.conversation.map((entry) => {
          const sender = normalizeConversationSender(entry.sender || entry.role || entry.author || 'agent')
          const rawMessage = entry.message || entry.text || entry.content || entry.summary || ''
          const isReasoning = Boolean(
            entry.isReasoning || entry.reasoning || entry.thought || entry.internalThought || entry.type === 'reasoning'
          )
          return {
            sender,
            message: String(rawMessage || 'No message available.'),
            isReasoning,
          }
        })
      : []

    return {
      key,
      processName,
      version: instance.version || 'v6',
      started,
      ended,
      status,
      variables: variablesFromInstance.length ? variablesFromInstance : [],
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
    const counts = { all: instances.length, active: 0, completed: 0, cancelled: 0, failed: 0 }
    instances.forEach((instance) => {
      const state = normalizeInstanceState(instance.state)
      if (state === 'active') counts.active += 1
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
    if (!task) {
      console.warn('[DEBUG] submitTaskCompletion: no task provided')
      return
    }

    console.log('[DEBUG] submitTaskCompletion: submitting task', { taskId: task.id, userTaskKey: task.userTaskKey, formValues })

    const variables = Object.fromEntries(
      Object.entries(formValues).map(([key, value]) => {
        const numericValue = Number(value)
        return [key, Number.isFinite(numericValue) && String(value).trim() !== '' ? numericValue : value]
      }),
    )

    console.log('[DEBUG] submitTaskCompletion: normalized variables', { variables })

    try {
      const url = `${apiBase}/api/tasks/${task.id}/completion`
      console.log('[DEBUG] submitTaskCompletion: POST to', { url })

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables }),
      })

      console.log('[DEBUG] submitTaskCompletion: response', { status: response.status, ok: response.ok })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error('[DEBUG] submitTaskCompletion: response not ok', { status: response.status, errorBody })
        throw new Error('Unable to submit task')
      }

      const responseData = await response.json()
      console.log('[DEBUG] submitTaskCompletion: success', { responseData })

      setTasks((current) => current.filter((nextTask) => nextTask.id !== task.id))
      if (selectedTaskId === task.id) {
        setSelectedTaskId('')
      }
    } catch (err) {
      console.error('[DEBUG] submitTaskCompletion: error', { error: err.message })
      throw err
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

    const nextFormValues = { ...taskForm }
    if (nextFormValues.ai_instruction !== undefined && !Object.prototype.hasOwnProperty.call(nextFormValues, 'ai_instruction')) {
      nextFormValues.ai_instruction = nextFormValues.ai_instruction
    }

    await submitTaskCompletion(selectedTask, nextFormValues)
  }

  const openInstanceDetail = async (instance) => {
    console.log('[DEBUG] openInstanceDetail: opening instance', { instanceKey: instance.processInstanceKey || instance.key, processName: instance.processDefinitionName })
    setExpandedVariables(new Set())
    const detail = buildInstanceDetail(instance)
    console.log('[DEBUG] openInstanceDetail: built instance detail', { key: detail.key, variablesFromCard: detail.variables.length })

    const fetchedVariables = await fetchInstanceVariables(detail.key)
    console.log('[DEBUG] openInstanceDetail: fetched variables', { count: fetchedVariables.length, variables: fetchedVariables })

    const finalVariables = fetchedVariables.length ? fetchedVariables : detail.variables
    console.log('[DEBUG] openInstanceDetail: using variables', { source: fetchedVariables.length ? 'fetched' : 'instance-detail', count: finalVariables.length })

    setSelectedInstance({
      ...detail,
      variables: finalVariables,
    })
  }

  const renderDashboardVisual = (report) => {
    const reportName = report.name || ''
    const rows = Array.isArray(report.dataPreview) ? report.dataPreview : []
    const kind = inferReportKind(reportName)

    if (reportName.toLowerCase().includes('overall process traffic')) {
      const trafficRows = (rows.length ? rows : [{ value: report.value || 0, label: 'Overall process traffic' }]).map((row) => ({
        ...row,
        value: parseCamundaDuration(row.value),
        label: String(row.label || row.key || row.name || 'Process')
      }))
      const maxValue = Math.max(...trafficRows.map((row) => row.value || 0), 1)
      const yTicks = Array.from({ length: 5 }, (_, index) => {
        const tickValue = maxValue * (index / 4)
        return Math.round(tickValue * 100) / 100
      }).reverse()

      return (
        <div className="chart-with-axes">
          <div className="chart-y-axis-label">Duration (minutes)</div>
          <div className="chart-plot-area">
            <div className="y-axis-scale" aria-hidden="true">
              {yTicks.map((tick) => (
                <span key={`traffic-tick-${tick}`} className="y-axis-tick">{formatNumber(tick, 2)}</span>
              ))}
            </div>
            <div className="bar-chart-shell traffic-bar-chart-shell" aria-label={`${report.name} traffic chart`}>
              {trafficRows.slice(0, 8).map((row, index) => {
                const label = String(row.label || row.key || row.name || `Process ${index + 1}`)
                const barValue = Number(row.value) || 0
                const barHeightPercent = maxValue > 0 ? Math.max(4, (barValue / maxValue) * 100) : 4

                return (
                  <div key={`${report.id}-traffic-${index}`} className="bar-chart-column traffic-bar-column">
                    <span
                      className="report-bar traffic-report-bar"
                      style={{ height: `${Math.min(100, barHeightPercent)}%` }}
                    />
                    <span className="bar-chart-label">{label.slice(0, 12)}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="chart-x-axis-label">Process name</div>
        </div>
      )
    }

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
        value: parseCamundaDuration(row.value),
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
        const barHeightPercent = maxValue > 0 ? Math.max(4, (barValue / maxValue) * 100) : 4

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
                    style={{ height: `${Math.min(100, barHeightPercent)}%` }}
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
                const barHeightPercent = maxValue > 0 ? Math.max(4, (barValue / maxValue) * 100) : 4

                return (
                  <div key={`${report.id}-duration-${index}`} className="bar-chart-column">
                    <span
                      className="report-bar"
                      style={{ height: `${Math.min(100, barHeightPercent)}%` }}
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
          <img className="brand-logo" src={logoUrl} alt="Application Lifecycle Processing" />
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

          {dashboardCards.length ? (
            <>
              {/* Row 1: First 2 cards in 2-column layout */}
              <section className="report-cards-grid-2col">
                {dashboardCards.slice(0, 2).map((report) => (
                  <article key={report.id || report.name} className="report-card">
                    <div className="report-card-header">
                      <h3>{report.name || 'Report'}</h3>
                    </div>
                    {renderDashboardVisual(report)}
                  </article>
                ))}
              </section>

              {/* Row 2: Overall process traffic in full width */}
              {dashboardCards.some((card) => String(card.name || '').toLowerCase().includes('overall process traffic')) && (
                <section className="report-cards-grid-full">
                  {dashboardCards
                    .filter((card) => String(card.name || '').toLowerCase().includes('overall process traffic'))
                    .map((report) => (
                      <article key={report.id || report.name} className="report-card">
                        <div className="report-card-header">
                          <h3>{report.name || 'Report'}</h3>
                        </div>
                        {renderDashboardVisual(report)}
                      </article>
                    ))}
                </section>
              )}

              {/* Row 3: Remaining cards in 3-column layout */}
              {dashboardCards.length > 3 && (
                <section className="report-cards-grid-3col">
                  {dashboardCards
                    .slice(2)
                    .filter((card) => !String(card.name || '').toLowerCase().includes('overall process traffic'))
                    .map((report) => (
                      <article key={report.id || report.name} className="report-card">
                        <div className="report-card-header">
                          <h3>{report.name || 'Report'}</h3>
                        </div>
                        {renderDashboardVisual(report)}
                      </article>
                    ))}
                </section>
              )}
            </>
          ) : (
            <div className="empty-state">No dashboard reports available.</div>
          )}
        </main>
      )}

      {activeTab === 'Process Instances' && (
        <section className="instances-page">
          <div className="instances-header-row">
            <div>
              <h2>Process Instances</h2>
              <p>Monitor and inspect workflow executions from Camunda Operate</p>
            </div>
            <button type="button" className="refresh-button" onClick={() => void refreshAllData()}>↻ Refresh</button>
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

          </div>

          <div className="status-filter-row">
            <div className="status-filter-select-wrap">
              <label htmlFor="process-state-filter" className="status-filter-label">State</label>
              <select
                id="process-state-filter"
                className="status-filter-select"
                value={processFilter}
                onChange={(event) => setProcessFilter(event.target.value)}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            {['all', 'active', 'completed', 'cancelled', 'failed'].map((state) => (
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
                  <article key={instance.id || instance.key || instance.processInstanceKey} className="instance-dashboard-card" onClick={() => void openInstanceDetail(instance)}>
                    <div className="instance-card-header">
                      <div className="instance-key-block">PROCESS</div>
                      <span className={`mini-status ${stateClass}`}>{instanceState.toUpperCase()}</span>
                    </div>

                    <div className="process-title-block">
                      <div className="process-name">{detail.processName}</div>
                      <div className="instance-key-value">#{instance.processInstanceKey || instance.key || 'Unknown instance'}</div>
                      <div className="process-version">Version {detail.version}</div>
                    </div>

                    <div className="instance-meta-grid">
                      <div className="meta-row"><span>Started</span><strong>{detail.started}</strong></div>
                      <div className="meta-row"><span>Ended</span><strong>{detail.ended}</strong></div>
                    </div>

                    <button
                      type="button"
                      className="view-button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void openInstanceDetail(instance)
                      }}
                    >
                      View Variables →
                    </button>
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
                    <span className="modal-label">Process</span>
                    <h3>{selectedInstance.processName}</h3>
                  </div>
                  <button type="button" className="modal-close" onClick={() => setSelectedInstance(null)}>×</button>
                </div>

                <div className="modal-status-row">
                  <span className={`mini-status ${selectedInstance.status === 'completed' ? 'status-completed' : selectedInstance.status === 'cancelled' ? 'status-cancelled' : selectedInstance.status === 'failed' ? 'status-failed' : 'status-active'}`}>
                    {selectedInstance.status.toUpperCase()}
                  </span>
                  <span className="modal-instance-key">#{selectedInstance.key}</span>
                </div>

                <div className="detail-stack">
                  <div className="chat-panel">
                    <h4>AI Agent Conversation</h4>
                    <div className="chat-thread">
                      {selectedInstance.conversation.length ? selectedInstance.conversation.map((entry, index) => (
                        <div key={`${entry.sender}-${index}`} className={`chat-bubble ${entry.sender} ${entry.isReasoning ? 'reasoning' : ''}`}>
                          <span className="chat-author">
                            {entry.isReasoning ? 'AI Reasoning' : entry.sender === 'client' ? 'Client' : 'AI Agent'}
                          </span>
                          <p>{entry.message}</p>
                        </div>
                      )) : <div className="empty-state">No conversation history available.</div>}
                    </div>
                  </div>

                  <div className="detail-panel">
                    <h4>Process Variables</h4>
                    {selectedInstance.variables.length ? (
                      <div className="variable-card-list">
                        {selectedInstance.variables.map((variable, index) => {
                          const variableKey = `${variable.name}-${index}`
                          const isExpanded = expandedVariables.has(variableKey)
                          return (
                            <div className="variable-card" key={variableKey}>
                              <button
                                type="button"
                                className="variable-card-header"
                                onClick={() => setExpandedVariables((current) => {
                                  const next = new Set(current)
                                  if (next.has(variableKey)) next.delete(variableKey)
                                  else next.add(variableKey)
                                  return next
                                })}
                              >
                                <span className={`variable-card-chevron ${isExpanded ? 'open' : ''}`}>▸</span>
                                <span className="variable-card-name">{variable.name}</span>
                                <span className="variable-card-type">{describeVariableType(variable.value)}</span>
                                {!isExpanded && <span className="variable-card-preview">{previewVariableValue(variable.value)}</span>}
                              </button>
                              {isExpanded && (
                                <div className="variable-card-body">
                                  <VariableTree value={variable.value} />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="empty-state">No variables available.</div>
                    )}
                  </div>

                  <div className="detail-panel">
                    <h4>Subprocesses</h4>
                    <div className="subprocess-list">
                      {selectedInstance.subprocesses.length ? selectedInstance.subprocesses.map((subprocess) => (
                        <div key={subprocess.name} className="subprocess-row">
                          <div>
                            <div className="subprocess-name">{subprocess.name}</div>
                            <div className="subprocess-duration">Duration: {subprocess.duration} min</div>
                          </div>
                          <span className={`subprocess-status ${subprocess.status}`}>{subprocess.status}</span>
                        </div>
                      )) : <div className="empty-state">No subprocesses found.</div>}
                    </div>
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
                  <div className="task-header-actions">
                    <span className="task-count-badge">{tasks.length}</span>
                    <button
                      type="button"
                      className="refresh-button task-refresh-button"
                      onClick={() => {
                        setRefreshingTasks(true)
                        void fetchTasks({ suppressLoading: false })
                      }}
                      disabled={refreshingTasks}
                    >
                      {refreshingTasks ? 'Refreshing…' : '↻ Refresh'}
                    </button>
                  </div>
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

                  <div className="task-summary-panel">
                    <label className="field-row">
                      <span>Escalation Summary</span>
                      <div className="summary-block">
                        {(() => {
                          const summaryValue = Object.entries(selectedTask.variables || {}).find(([key]) => key.toLowerCase() === 'escalation_summary')?.[1]
                          const parsedSummary = parseVariableValue(summaryValue)
                          return formatVariableDisplay(parsedSummary.value)
                        })()}
                      </div>
                    </label>
                  </div>

                  <div className="field-list ai-instructions-panel">
                    <label className="field-row">
                      <span>What would you like the AI to do?</span>
                      <textarea
                        value={taskForm.ai_instruction ?? ''}
                        onChange={(event) => handleTaskInputChange('ai_instruction', event.target.value)}
                        placeholder="General Instructions for the AI (Use this if you are not forcing a specific date or drafting exact messages)"
                        rows={5}
                      />
                    </label>
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
