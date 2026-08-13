const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CAMUNDA_BASE_URL = (process.env.CAMUNDA_OPTIMIZE_BASE_URL || '').replace(/\/$/, '');
const CAMUNDA_TOKEN = process.env.CAMUNDA_OPTIMIZE_TOKEN || '';
const COLLECTION_ID = process.env.CAMUNDA_OPTIMIZE_COLLECTION_ID || '';
const OAUTH_URL = process.env.CAMUNDA_OAUTH_URL || process.env.ZEEBE_AUTHORIZATION_SERVER_URL || 'https://login.cloud.camunda.io/oauth/token';
const CLIENT_ID = process.env.CAMUNDA_CLIENT_AUTH_CLIENTID || process.env.CAMUNDA_CLIENT_ID || process.env.ZEEBE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CAMUNDA_CLIENT_AUTH_CLIENTSECRET || process.env.CAMUNDA_CLIENT_SECRET || process.env.ZEEBE_CLIENT_SECRET || '';
const TOKEN_AUDIENCE = process.env.CAMUNDA_TOKEN_AUDIENCE || process.env.ZEEBE_TOKEN_AUDIENCE || 'zeebe.camunda.io';
let cachedOptimizeToken = null;
let cachedOptimizeTokenExpiry = 0;

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

async function getOptimizeAccessToken() {
  if (CAMUNDA_TOKEN) {
    return CAMUNDA_TOKEN;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return '';
  }

  const now = Date.now();
  if (cachedOptimizeToken && now < cachedOptimizeTokenExpiry) {
    return cachedOptimizeToken;
  }

  const audiences = [TOKEN_AUDIENCE, 'optimize.camunda.io', 'zeebe.camunda.io', 'operate.camunda.io', 'tasklist.camunda.io', 'api.cloud.camunda.io'];

  for (const audience of audiences) {
    try {
      const response = await axios.post(
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

      const token = response.data && response.data.access_token;
      if (token) {
        cachedOptimizeToken = token;
        cachedOptimizeTokenExpiry = now + ((response.data.expires_in || 300) * 1000) - 60000;
        return token;
      }
    } catch (error) {
      // Try the next audience if this one is rejected.
    }
  }

  return '';
}

async function getOptimizeHeaders() {
  const token = await getOptimizeAccessToken();
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function ensureOptimizeConfigured() {
  return Boolean(CAMUNDA_BASE_URL && (CAMUNDA_TOKEN || (CLIENT_ID && CLIENT_SECRET)));
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

  const payload = Array.isArray(response.data) ? response.data : [response.data];
  const dashboardDefinition = payload.find((item) => item && item.id === dashboardId) || payload[0] || {};
  const reports = Array.isArray(dashboardDefinition?.widgets) ? dashboardDefinition.widgets : Array.isArray(dashboardDefinition?.reports) ? dashboardDefinition.reports : [];

  return {
    dashboardId,
    name: dashboardDefinition.name || dashboardId,
    reports: reports.map((report) => ({
      id: report.id || report.reportId || report.key,
      name: report.name || report.title || 'Report',
      type: report.type || report.kind || 'unknown',
      definition: report,
    })),
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
    configured: Boolean(CAMUNDA_BASE_URL && CAMUNDA_TOKEN),
    collectionId: COLLECTION_ID,
    baseUrl: CAMUNDA_BASE_URL || 'not-configured',
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

app.get('/api/process-instances', async (req, res) => {
  try {
    const processDefinitionKey = req.query.processDefinitionKey || req.query.processId || 'Process_1dwlliq';
    const processInstanceKey = req.query.processInstanceKey || req.query.processKey || '';
    const state = req.query.state || 'all';

    if (!ensureOptimizeConfigured()) {
      return res.json([]);
    }

    const response = await axios.get(`${CAMUNDA_BASE_URL}/engine-rest/process-instance`, {
      params: processInstanceKey ? { processInstanceKey } : {},
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${CAMUNDA_TOKEN}`,
      },
      timeout: 20000,
    });

    const instances = Array.isArray(response.data) ? response.data : response.data?.items || [];
    const filtered = instances.filter((instance) => {
      const matchesKey = !processDefinitionKey || !instance.processDefinitionKey || instance.processDefinitionKey === processDefinitionKey;
      const matchesState = state === 'all' || String(instance.state || '').toLowerCase() === String(state).toLowerCase();
      return matchesKey && matchesState;
    });

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Unable to fetch process instances', error: error.message });
  }
});

app.get('/api/tasklist', async (req, res) => {
  try {
    const processDefinitionKey = req.query.processDefinitionKey || req.query.processId || 'Process_1dwlliq';
    const processInstanceKey = req.query.processInstanceKey || req.query.processKey || '';

    if (!ensureOptimizeConfigured()) {
      return res.json([]);
    }

    const response = await axios.get(`${CAMUNDA_BASE_URL}/engine-rest/task`, {
      params: processInstanceKey ? { processInstanceKey } : {},
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${CAMUNDA_TOKEN}`,
      },
      timeout: 20000,
    });

    const tasks = Array.isArray(response.data) ? response.data : response.data?.items || [];
    const filtered = !processDefinitionKey
      ? tasks
      : tasks.filter((task) => !task.processDefinitionKey || task.processDefinitionKey === processDefinitionKey);

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Unable to fetch tasklist', error: error.message });
  }
});

app.post('/api/tasks/:taskId/completion', async (req, res) => {
  try {
    const { taskId } = req.params;
    const variables = req.body?.variables || {};

    if (!ensureOptimizeConfigured()) {
      return res.status(503).json({ ok: false, message: 'Camunda Optimize is not configured; task completion is unavailable.' });
    }

    const token = await getOptimizeAccessToken();
    await axios.post(`${CAMUNDA_BASE_URL}/engine-rest/task/${taskId}/complete`, { variables }, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 20000,
    });

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
      (dashboardSummary.reports || []).map(async (report) => {
        const reportId = report.id || report.reportId;
        if (!reportId) {
          return { ...report, data: [], dataPreview: [], totalRecords: 0, processId };
        }

        const data = await getReportData(reportId, { limit: 50, paginationTimeout: 60 });
        const rows = Array.isArray(data.data) ? data.data : [];
        const filteredRows = filterRowsByProcess(rows, processId);

        return {
          ...report,
          totalRecords: filteredRows.length || data.totalNumberOfRecords || rows.length,
          data: filteredRows,
          dataPreview: filteredRows.slice(0, 10),
          processId,
        };
      })
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
          (dashboardSummary.reports || []).map(async (report) => {
            const reportId = report.id || report.reportId;
            if (!reportId) {
              return { ...report, data: [], dataPreview: [], totalRecords: 0, processId };
            }

            const data = await getReportData(reportId, { limit: 20, paginationTimeout: 60 });
            const rows = Array.isArray(data.data) ? data.data : [];
            const filteredRows = filterRowsByProcess(rows, processId);

            return {
              ...report,
              totalRecords: filteredRows.length || data.totalNumberOfRecords || rows.length,
              data: filteredRows,
              dataPreview: filteredRows.slice(0, 10),
              processId,
            };
          })
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
