// Camunda Optimize/Zeebe proxy — deployed via GitHub Actions on push to main.
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Dev-only diagnostic logging — set DEBUG_LOGS=false to silence. Never logs
// secret values, only whether they're present, plus request/response shape.
const DEBUG_LOGS = process.env.DEBUG_LOGS !== 'false';
function logDebug(scope, data) {
  if (!DEBUG_LOGS) return;
  console.log(`[debug ${new Date().toISOString()}] ${scope}`, JSON.stringify(data));
}

// dotenv.config() loads .env relative to process.cwd() (the directory the
// command was RUN from), not relative to this file. Running `node
// src/server.js` from the repo root instead of from backend/ is a common way
// to end up with every env var silently empty even if backend/.env exists
// and is filled in correctly — log exactly what dotenv found so that's
// provable instead of guessed.
const expectedEnvPath = path.resolve(process.cwd(), '.env');
const dotenvResult = dotenv.config();
logDebug('dotenv.config() startup', {
  cwd: process.cwd(),
  expectedEnvPath,
  envFileExistsAtCwd: fs.existsSync(expectedEnvPath),
  dotenvError: dotenvResult.error ? dotenvResult.error.message : null,
  keysLoaded: dotenvResult.parsed ? Object.keys(dotenvResult.parsed).length : 0,
});

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CAMUNDA_BASE_URL = (process.env.CAMUNDA_OPTIMIZE_BASE_URL || '').replace(/\/$/, '');
const CAMUNDA_TOKEN = process.env.CAMUNDA_OPTIMIZE_TOKEN || '';
const COLLECTION_ID = process.env.CAMUNDA_OPTIMIZE_COLLECTION_ID || '';
const OAUTH_URL = process.env.CAMUNDA_OAUTH_URL || process.env.ZEEBE_AUTHORIZATION_SERVER_URL || 'https://login.cloud.camunda.io/oauth/token';
const CLIENT_ID = process.env.CAMUNDA_CLIENT_AUTH_CLIENTID || process.env.CAMUNDA_CLIENT_ID || process.env.ZEEBE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CAMUNDA_CLIENT_AUTH_CLIENTSECRET || process.env.CAMUNDA_CLIENT_SECRET || process.env.ZEEBE_CLIENT_SECRET || '';
const OPTIMIZE_TOKEN_AUDIENCE = process.env.CAMUNDA_OPTIMIZE_OAUTH_AUDIENCE || 'optimize.camunda.io';
const ZEEBE_TOKEN_AUDIENCE = process.env.CAMUNDA_TOKEN_AUDIENCE || process.env.ZEEBE_TOKEN_AUDIENCE || 'zeebe.camunda.io';
const ZEEBE_REST_ADDRESS = (process.env.ZEEBE_REST_ADDRESS || '').replace(/\/$/, '');

// Camunda 8 issues a different token per audience (Optimize vs. the Zeebe/
// Orchestration Cluster API); a token for one audience is rejected by the
// other, so each audience needs its own cache entry rather than a single one.
const tokenCacheByAudience = new Map();

app.use(cors());
app.use(express.json());

function buildConfigError(message) {
  return {
    ok: false,
    configured: false,
    message,
    env: {
      CAMUNDA_OPTIMIZE_BASE_URL: !!CAMUNDA_BASE_URL,
      CAMUNDA_OPTIMIZE_TOKEN: !!CAMUNDA_TOKEN,
      CAMUNDA_OPTIMIZE_COLLECTION_ID: !!COLLECTION_ID,
    },
  };
}

async function getAccessToken(audience) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    logDebug('getAccessToken: missing credentials, returning empty token', {
      audience,
      hasClientId: Boolean(CLIENT_ID),
      hasClientSecret: Boolean(CLIENT_SECRET),
    });
    return '';
  }

  const now = Date.now();
  const cached = tokenCacheByAudience.get(audience);
  if (cached && now < cached.expiry) {
    logDebug('getAccessToken: cache hit', { audience, expiresInMs: cached.expiry - now });
    return cached.token;
  }

  logDebug('getAccessToken: fetching new token', { audience, oauthUrl: OAUTH_URL });

  let response;
  try {
    response = await axios.post(
      OAUTH_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        audience,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      }
    );
  } catch (error) {
    logDebug('getAccessToken: OAuth request failed', {
      audience,
      status: error.response && error.response.status,
      data: error.response && error.response.data,
      message: error.message,
    });
    throw error;
  }

  const token = response.data && response.data.access_token;
  if (!token) {
    logDebug('getAccessToken: OAuth response had no access_token', {
      audience,
      responseKeys: Object.keys(response.data || {}),
    });
    return '';
  }

  logDebug('getAccessToken: token acquired', { audience, expiresIn: response.data.expires_in });

  tokenCacheByAudience.set(audience, {
    token,
    expiry: now + ((response.data.expires_in || 300) * 1000) - 60000,
  });
  return token;
}

async function getOptimizeHeaders() {
  const token = CAMUNDA_TOKEN || (await getAccessToken(OPTIMIZE_TOKEN_AUDIENCE));
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getZeebeHeaders() {
  const token = await getAccessToken(ZEEBE_TOKEN_AUDIENCE);
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function ensureOptimizeConfigured() {
  const configured = Boolean(CAMUNDA_BASE_URL && (CAMUNDA_TOKEN || (CLIENT_ID && CLIENT_SECRET)));
  if (!configured) {
    logDebug('ensureOptimizeConfigured: false', {
      hasBaseUrl: Boolean(CAMUNDA_BASE_URL),
      hasToken: Boolean(CAMUNDA_TOKEN),
      hasClientId: Boolean(CLIENT_ID),
      hasClientSecret: Boolean(CLIENT_SECRET),
    });
  }
  return configured;
}

function ensureZeebeConfigured() {
  const configured = Boolean(ZEEBE_REST_ADDRESS && CLIENT_ID && CLIENT_SECRET);
  if (!configured) {
    logDebug('ensureZeebeConfigured: false', {
      hasZeebeRestAddress: Boolean(ZEEBE_REST_ADDRESS),
      hasClientId: Boolean(CLIENT_ID),
      hasClientSecret: Boolean(CLIENT_SECRET),
    });
  }
  return configured;
}

function emptyDashboardState(dashboardId) {
  return {
    dashboardId,
    name: dashboardId,
    reports: [],
    totalReports: 0,
    configured: false,
  };
}

function matchesProcessFilter(row, processId) {
  if (!processId) {
    return true;
  }

  const normalizedTarget = String(processId).trim();
  const candidateValues = [
    row?.processDefinitionKey,
    row?.processDefinitionId,
    row?.processId,
    row?.processKey,
    row?.process?.definitionKey,
    row?.process?.id,
    row?.processDefinition?.key,
    row?.processDefinition?.id,
  ];

  return candidateValues.some((value) => String(value || '').trim() === normalizedTarget);
}

function filterRowsByProcess(rows, processId) {
  if (!Array.isArray(rows)) {
    return [];
  }

  if (!processId) {
    return rows;
  }

  return rows.filter((row) => matchesProcessFilter(row, processId));
}

async function getDashboardIdsFromCollection(collectionId) {
  if (!ensureOptimizeConfigured()) {
    return [];
  }

  const response = await axios.get(`${CAMUNDA_BASE_URL}/api/public/dashboard`, {
    params: { collectionId },
    headers: await getOptimizeHeaders(),
    timeout: 20000,
  });

  return response.data || [];
}

async function getDashboardReports(dashboardId) {
  if (!ensureOptimizeConfigured()) {
    return emptyDashboardState(dashboardId);
  }

  const response = await axios.post(
    `${CAMUNDA_BASE_URL}/api/public/export/dashboard/definition/json`,
    [dashboardId],
    {
      headers: {
        ...(await getOptimizeHeaders()),
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  // The export endpoint returns the whole collection bundle for the requested
  // dashboard: every report entity the dashboard uses, plus the dashboard
  // entity itself (exportEntityType: 'dashboard'), all as siblings in one
  // flat array. The dashboard entity references its reports via `tiles`
  // (an array of {id, type: 'optimize_report'} — no name/data), so report
  // names and data have to be looked up from the sibling entities by id.
  const payload = Array.isArray(response.data) ? response.data : [response.data];
  const dashboardDefinition = payload.find((item) => item && item.id === dashboardId && item.exportEntityType === 'dashboard');
  if (!dashboardDefinition) {
    return emptyDashboardState(dashboardId);
  }

  const reportEntitiesById = new Map(
    payload
      .filter((item) => item && item.exportEntityType && item.exportEntityType !== 'dashboard')
      .map((item) => [item.id, item])
  );

  const tiles = Array.isArray(dashboardDefinition.tiles) ? dashboardDefinition.tiles : [];
  const reports = tiles
    .filter((tile) => tile.type === 'optimize_report' && tile.id)
    .map((tile) => {
      const entity = reportEntitiesById.get(tile.id);
      return {
        id: tile.id,
        name: entity?.name || 'Report',
        visualization: entity?.data?.visualization || 'unknown',
      };
    });

  return {
    dashboardId,
    name: dashboardDefinition.name || dashboardId,
    reports,
  };
}

function rowsAreProcessScoped(rows) {
  return rows.some(
    (row) =>
      row &&
      typeof row === 'object' &&
      ('processDefinitionKey' in row || 'processDefinitionId' in row || 'processId' in row || 'processKey' in row)
  );
}

async function buildReportInsight(report, processId) {
  const reportId = report.id || report.reportId;
  if (!reportId) {
    return { ...report, resultType: 'unknown', data: [], dataPreview: [], totalRecords: 0, processId };
  }

  const result = await getReportData(reportId, { limit: 50, paginationTimeout: 60 });
  const rawData = result.data;

  if (typeof rawData === 'number') {
    return { ...report, resultType: 'number', value: rawData, data: [], dataPreview: [], totalRecords: 1, processId };
  }

  const rows = Array.isArray(rawData) ? rawData : [];
  // Row-level process filtering only makes sense for raw-data list reports
  // (each row carries its own processDefinitionKey); grouped/aggregate
  // reports (key/value/label rows) are already scoped to a single process
  // by the report definition itself, so filtering them here would wipe out
  // every row.
  const filteredRows = rowsAreProcessScoped(rows) ? filterRowsByProcess(rows, processId) : rows;

  return {
    ...report,
    resultType: Array.isArray(rawData) ? 'map' : 'unknown',
    totalRecords: filteredRows.length || result.totalNumberOfRecords || rows.length,
    data: filteredRows,
    dataPreview: filteredRows.slice(0, 10),
    processId,
  };
}

async function getReportData(reportId, query = {}) {
  if (!ensureOptimizeConfigured()) {
    return { reportId, data: [], totalNumberOfRecords: 0, numberOfRecordsInResponse: 0, configured: false };
  }

  const params = {
    limit: query.limit || 50,
    paginationTimeout: query.paginationTimeout || 60,
    ...query,
  };

  const response = await axios.get(`${CAMUNDA_BASE_URL}/api/public/export/report/${reportId}/result/json`, {
    params,
    headers: await getOptimizeHeaders(),
    timeout: 30000,
  });

  return response.data || { reportId, data: [] };
}

app.get('/api/test', (req, res) => {
  res.json({
    ok: true,
    message: 'Camunda API server is running',
    optimizeConfigured: ensureOptimizeConfigured(),
    zeebeConfigured: ensureZeebeConfigured(),
    collectionId: COLLECTION_ID,
    optimizeBaseUrl: CAMUNDA_BASE_URL || 'not-configured',
    zeebeRestAddress: ZEEBE_REST_ADDRESS || 'not-configured',
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/api/collection/:collectionId/dashboards', async (req, res) => {
  try {
    const { collectionId } = req.params;
    const dashboards = await getDashboardIdsFromCollection(collectionId);
    res.json(dashboards);
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Unable to fetch dashboards', error: error.message });
  }
});

app.get('/api/dashboard/:dashboardId/reports', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const details = await getDashboardReports(dashboardId);
    res.json(details);
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Unable to fetch dashboard report definitions', error: error.message });
  }
});

function mapProcessInstanceState(state) {
  const stateMap = { running: 'ACTIVE', completed: 'COMPLETED', cancelled: 'CANCELED' };
  return stateMap[state];
}

async function fetchUserTaskVariables(userTaskKey, headers) {
  try {
    const response = await axios.post(
      `${ZEEBE_REST_ADDRESS}/v2/user-tasks/${userTaskKey}/variables/search`,
      { page: { limit: 50 } },
      { headers, timeout: 20000 }
    );

    const items = response.data.items || [];
    return Object.fromEntries(
      items.map((item) => {
        try {
          return [item.name, JSON.parse(item.value)];
        } catch {
          return [item.name, item.value];
        }
      })
    );
  } catch {
    return {};
  }
}

app.get('/api/process-instances', async (req, res) => {
  try {
    const processDefinitionId = req.query.processDefinitionKey || req.query.processId || '';
    const processInstanceKey = req.query.processInstanceKey || req.query.processKey || '';
    const state = req.query.state || 'all';

    logDebug('GET /api/process-instances: incoming', { query: req.query });

    if (!ensureZeebeConfigured()) {
      logDebug('GET /api/process-instances: Zeebe not configured, returning [] without calling upstream', {});
      return res.json([]);
    }

    const filter = {};
    if (processDefinitionId) filter.processDefinitionId = processDefinitionId;
    if (processInstanceKey) filter.processInstanceKey = processInstanceKey;
    const mappedState = mapProcessInstanceState(state);
    if (mappedState) filter.state = mappedState;

    logDebug('GET /api/process-instances: calling Zeebe', {
      url: `${ZEEBE_REST_ADDRESS}/v2/process-instances/search`,
      filter,
    });

    const response = await axios.post(
      `${ZEEBE_REST_ADDRESS}/v2/process-instances/search`,
      { filter, page: { limit: 200 } },
      { headers: await getZeebeHeaders(), timeout: 20000 }
    );

    let instances = response.data.items || [];
    logDebug('GET /api/process-instances: Zeebe response', {
      status: response.status,
      itemCount: instances.length,
    });
    if (state === 'failed') {
      instances = instances.filter((instance) => instance.hasIncident);
    }

    res.json(instances);
  } catch (error) {
    logDebug('GET /api/process-instances: failed', {
      status: error.response && error.response.status,
      data: error.response && error.response.data,
      message: error.message,
    });
    res.status(500).json({ ok: false, message: 'Unable to fetch process instances', error: error.message });
  }
});

app.get('/api/tasklist', async (req, res) => {
  try {
    const processDefinitionId = req.query.processDefinitionKey || req.query.processId || '';
    const processInstanceKey = req.query.processInstanceKey || req.query.processKey || '';

    logDebug('GET /api/tasklist: incoming', { query: req.query });

    if (!ensureZeebeConfigured()) {
      logDebug('GET /api/tasklist: Zeebe not configured, returning [] without calling upstream', {});
      return res.json([]);
    }

    const headers = await getZeebeHeaders();
    const filter = { state: 'CREATED' };
    if (processDefinitionId) filter.processDefinitionId = processDefinitionId;
    if (processInstanceKey) filter.processInstanceKey = processInstanceKey;

    logDebug('GET /api/tasklist: calling Zeebe', {
      url: `${ZEEBE_REST_ADDRESS}/v2/user-tasks/search`,
      filter,
      hasAuthHeader: Boolean(headers.Authorization),
    });

    const response = await axios.post(
      `${ZEEBE_REST_ADDRESS}/v2/user-tasks/search`,
      { filter, page: { limit: 100 } },
      { headers, timeout: 20000 }
    );

    const items = response.data.items || [];
    logDebug('GET /api/tasklist: Zeebe response', {
      status: response.status,
      itemCount: items.length,
      // If items is empty but the filter has no processInstanceKey/processDefinitionId,
      // this means Zeebe genuinely has zero user tasks in state=CREATED right now —
      // not a bug in this endpoint. If itemCount is unexpectedly 0 with a filter set,
      // double-check the filter values above are what you expect (e.g. a stale/wrong
      // processInstanceKey), or that tasks haven't already been claimed/completed.
      filterUsed: filter,
    });

    const tasks = await Promise.all(
      items.map(async (task) => ({
        id: task.userTaskKey,
        name: task.name || task.elementId,
        assignee: task.assignee,
        status: task.state,
        processInstanceKey: task.processInstanceKey,
        processDefinitionKey: task.processDefinitionId,
        variables: await fetchUserTaskVariables(task.userTaskKey, headers),
      }))
    );

    res.json(tasks);
  } catch (error) {
    logDebug('GET /api/tasklist: failed', {
      status: error.response && error.response.status,
      data: error.response && error.response.data,
      message: error.message,
    });
    res.status(500).json({ ok: false, message: 'Unable to fetch tasklist', error: error.message });
  }
});

app.post('/api/tasks/:taskId/completion', async (req, res) => {
  try {
    const { taskId } = req.params;
    const variables = req.body?.variables || {};

    if (!ensureZeebeConfigured()) {
      return res.status(503).json({ ok: false, message: 'Camunda orchestration cluster is not configured; task completion is unavailable.' });
    }

    await axios.post(
      `${ZEEBE_REST_ADDRESS}/v2/user-tasks/${taskId}/completion`,
      { variables },
      { headers: await getZeebeHeaders(), timeout: 20000 }
    );

    res.json({
      ok: true,
      taskId,
      submitted: true,
      variables,
      message: 'Task completion accepted',
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Unable to complete task', error: error.message });
  }
});

app.get('/api/report/:reportId/data', async (req, res) => {
  try {
    const { reportId } = req.params;
    const query = req.query;
    const reportData = await getReportData(reportId, query);
    res.json(reportData);
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Unable to fetch report data', error: error.message });
  }
});

app.get('/api/dashboard/:dashboardId/insights', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const processId = req.query.processId || req.query.processDefinitionKey || 'Process_15wz3ez';
    const dashboardSummary = await getDashboardReports(dashboardId);

    const reports = await Promise.all(
      (dashboardSummary.reports || []).map((report) => buildReportInsight(report, processId))
    );

    res.json({
      dashboardId,
      name: dashboardSummary.name || dashboardId,
      processId,
      totalReports: reports.length,
      reports,
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Unable to aggregate dashboard insights', error: error.message });
  }
});

app.get('/api/collection/:collectionId/insights', async (req, res) => {
  try {
    const { collectionId } = req.params;
    const processId = req.query.processId || req.query.processDefinitionKey || 'Process_15wz3ez';
    const dashboards = await getDashboardIdsFromCollection(collectionId);

    const dashboardDetails = await Promise.all(
      dashboards.map(async (dashboard) => {
        const dashboardId = dashboard.id || dashboard.dashboardId || dashboard;
        const dashboardSummary = await getDashboardReports(dashboardId);

        const reports = await Promise.all(
          (dashboardSummary.reports || []).map((report) => buildReportInsight(report, processId))
        );

        return {
          ...dashboard,
          name: dashboard.name || dashboardSummary.name || dashboardId,
          dashboardId,
          reports,
        };
      })
    );

    const flattenedReports = dashboardDetails.flatMap((dashboard) => dashboard.reports || []);
    const numericMetricNames = new Set();

    flattenedReports.forEach((report) => {
      report.dataPreview?.forEach((row) => {
        Object.keys(row).forEach((key) => {
          if (typeof row[key] === 'number') {
            numericMetricNames.add(key);
          }
        });
      });
    });

    const summary = {
      collectionId,
      processId,
      totalDashboards: dashboardDetails.length,
      totalReports: flattenedReports.length,
      numericKeys: [...numericMetricNames],
      dashboards: dashboardDetails,
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Unable to aggregate dashboard insights', error: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Camunda API server listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
