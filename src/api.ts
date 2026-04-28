import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DremioCredentials {
  url: string;
  token: string;
  /** true = browser calls Dremio directly (no Jupyter server extension needed) */
  direct: boolean;
  username?: string;
  /** kept in memory for the session lifetime so notebooks can be pre-wired */
  password?: string;
}

export type CatalogEntityType = 'CONTAINER' | 'DATASET' | 'FILE';
export type ContainerSubType = 'SPACE' | 'SOURCE' | 'FOLDER' | 'HOME';
export type DatasetSubType = 'VIRTUAL_DATASET' | 'PHYSICAL_DATASET';

export interface ColumnField {
  name: string;
  type: { name: string };
}

export interface CatalogItem {
  id: string;
  path: string[];
  tag?: string;
  entityType?: CatalogEntityType;
  type?: CatalogEntityType | ContainerSubType | DatasetSubType;
  containerType?: ContainerSubType;
  datasetType?: DatasetSubType;
  children?: CatalogItem[];
  fields?: ColumnField[];
}

export interface CatalogRoot {
  data: CatalogItem[];
}

export interface LoginResponse {
  token: string;
  userName: string;
}

export interface WikiContent {
  text: string | null;
  version?: number;
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the Jupyter server has the dremio proxy extension installed.
 * A non-404 response (e.g. 401) means the handler exists.
 */
export async function detectServerExtension(): Promise<boolean> {
  try {
    const settings = ServerConnection.makeSettings();
    const url = URLExt.join(settings.baseUrl, 'dremio/catalog');
    const resp = await fetch(url);
    return resp.status !== 404;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Proxy mode helpers (browser → Jupyter server → Dremio)
// ---------------------------------------------------------------------------

function proxyHeaders(creds: DremioCredentials): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Dremio-URL': creds.url,
    'X-Dremio-Token': creds.token,
  };
}

async function proxyRequest(path: string, init: RequestInit): Promise<any> {
  const settings = ServerConnection.makeSettings();
  const fullUrl = URLExt.join(settings.baseUrl, path);
  const response = await ServerConnection.makeRequest(fullUrl, init, settings);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Direct mode helpers (browser → Dremio directly, requires Dremio CORS config)
// ---------------------------------------------------------------------------

function directAuthHeader(token: string): Record<string, string> {
  return { Authorization: `_dremio${token}` };
}

async function directRequest(url: string, init: RequestInit): Promise<any> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Public API — each function routes on the direct flag
// ---------------------------------------------------------------------------

export async function login(
  dremioUrl: string,
  username: string,
  password: string,
  direct: boolean
): Promise<LoginResponse> {
  if (direct) {
    // Dremio's own REST endpoint — note: field is "userName", not "username"
    return directRequest(`${dremioUrl}/apiv2/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: username, password }),
    });
  }
  const settings = ServerConnection.makeSettings();
  const fullUrl = URLExt.join(settings.baseUrl, 'dremio/login');
  const response = await ServerConnection.makeRequest(
    fullUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dremio-URL': dremioUrl },
      body: JSON.stringify({ username, password }),
    },
    settings
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed (${response.status}): ${text}`);
  }
  return response.json();
}

/** SSO login is only available in proxy mode (requires server-side Kerberos). */
export async function ssoLogin(dremioUrl: string): Promise<LoginResponse> {
  const settings = ServerConnection.makeSettings();
  const fullUrl = URLExt.join(settings.baseUrl, 'dremio/sso-login');
  const response = await ServerConnection.makeRequest(
    fullUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dremio-URL': dremioUrl },
    },
    settings
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SSO login failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function ssoLogout(dremioUrl: string): Promise<void> {
  const settings = ServerConnection.makeSettings();
  const fullUrl = URLExt.join(settings.baseUrl, 'dremio/sso-logout');
  await ServerConnection.makeRequest(
    fullUrl,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dremio-URL': dremioUrl } },
    settings
  );
}

export async function fetchRootCatalog(creds: DremioCredentials): Promise<CatalogRoot> {
  if (creds.direct) {
    return directRequest(`${creds.url}/api/v3/catalog`, {
      headers: directAuthHeader(creds.token),
    });
  }
  return proxyRequest('dremio/catalog', {
    method: 'GET',
    headers: proxyHeaders(creds),
  });
}

export async function fetchCatalogItem(
  creds: DremioCredentials,
  id: string
): Promise<CatalogItem> {
  if (creds.direct) {
    return directRequest(`${creds.url}/api/v3/catalog/${encodeURIComponent(id)}`, {
      headers: directAuthHeader(creds.token),
    });
  }
  return proxyRequest(`dremio/catalog/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: proxyHeaders(creds),
  });
}

export async function deleteCatalogItem(
  creds: DremioCredentials,
  id: string
): Promise<void> {
  if (creds.direct) {
    const resp = await fetch(`${creds.url}/api/v3/catalog/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: directAuthHeader(creds.token),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Delete failed (${resp.status}): ${text}`);
    }
    return;
  }
  const settings = ServerConnection.makeSettings();
  const fullUrl = URLExt.join(
    settings.baseUrl,
    `dremio/catalog/${encodeURIComponent(id)}`
  );
  const response = await ServerConnection.makeRequest(
    fullUrl,
    { method: 'DELETE', headers: proxyHeaders(creds) },
    settings
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Delete failed (${response.status}): ${text}`);
  }
}

export async function createFolder(
  creds: DremioCredentials,
  path: string[]
): Promise<CatalogItem> {
  if (creds.direct) {
    return directRequest(`${creds.url}/api/v3/catalog`, {
      method: 'POST',
      headers: { ...directAuthHeader(creds.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'folder', path }),
    });
  }
  return proxyRequest('dremio/catalog/folder', {
    method: 'POST',
    headers: proxyHeaders(creds),
    body: JSON.stringify({ path }),
  });
}

export async function fetchWiki(
  creds: DremioCredentials,
  id: string
): Promise<WikiContent> {
  if (creds.direct) {
    const resp = await fetch(
      `${creds.url}/api/v3/catalog/${encodeURIComponent(id)}/collaboration/wiki`,
      { headers: directAuthHeader(creds.token) }
    );
    if (resp.status === 404) return { text: null };
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status}: ${text}`);
    }
    return resp.json();
  }
  const settings = ServerConnection.makeSettings();
  const fullUrl = URLExt.join(
    settings.baseUrl,
    `dremio/wiki/${encodeURIComponent(id)}`
  );
  const response = await ServerConnection.makeRequest(
    fullUrl,
    { method: 'GET', headers: proxyHeaders(creds) },
    settings
  );
  if (response.status === 404) return { text: null };
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobItem {
  id: string;
  state: string;
  user: string;
  startedAt?: string;
  endedAt?: string;
  queryType?: string;
  requestType?: string;
  datasetPathList?: string[];
  acceleration?: boolean;
  description?: string;
  rowCount?: number;
  outputRecordCount?: number;
  resourceSchedulingInfo?: {
    resourceSchedulingStart?: string;
    resourceSchedulingEnd?: string;
    queueName?: string;
    queueId?: string;
  };
  durationDetails?: Array<{ phase: string; duration: number }>;
}

export interface JobsResponse {
  data: JobItem[];
  total?: number;
}

export async function fetchJobs(
  creds: DremioCredentials,
  limit = 200
): Promise<JobsResponse> {
  const qs = `sort=START_TIME&order=DESCENDING&limit=${limit}&offset=0`;
  if (creds.direct) {
    const resp = await fetch(`${creds.url}/api/v3/jobs?${qs}`, {
      headers: directAuthHeader(creds.token),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status}: ${text}`);
    }
    return resp.json();
  }
  return proxyRequest(`dremio/jobs?${qs}`, {
    method: 'GET',
    headers: proxyHeaders(creds),
  });
}

export async function promoteToParquet(
  creds: DremioCredentials,
  item: CatalogItem
): Promise<CatalogItem> {
  const body = {
    entityType: 'dataset',
    id: item.id,
    path: item.path,
    type: 'PHYSICAL_DATASET',
    format: { type: 'Parquet' },
  };
  if (creds.direct) {
    return directRequest(`${creds.url}/api/v3/catalog/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: { ...directAuthHeader(creds.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return proxyRequest(`dremio/catalog/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    headers: proxyHeaders(creds),
    body: JSON.stringify(body),
  });
}

export async function fetchCatalogSearch(
  creds: DremioCredentials,
  q: string
): Promise<CatalogRoot> {
  if (creds.direct) {
    return directRequest(`${creds.url}/api/v3/catalog?search=${encodeURIComponent(q)}`, {
      headers: directAuthHeader(creds.token),
    });
  }
  return proxyRequest(`dremio/catalog/search?q=${encodeURIComponent(q)}`, {
    method: 'GET',
    headers: proxyHeaders(creds),
  });
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

export function buildSqlPath(path: string[]): string {
  return path.map(p => `"${p}"`).join('.');
}

export function isDataset(item: CatalogItem): boolean {
  return item.entityType === 'DATASET' || item.type === 'DATASET';
}

export function isFile(item: CatalogItem): boolean {
  return item.entityType === 'FILE' || item.type === 'FILE';
}

export function isContainer(item: CatalogItem): boolean {
  return (
    item.entityType === 'CONTAINER' ||
    item.type === 'CONTAINER' ||
    item.containerType != null
  );
}

export function itemIcon(item: CatalogItem): string {
  const sub = item.containerType ?? item.type;
  switch (sub) {
    case 'HOME':             return '🏠';
    case 'SPACE':            return '📦';
    case 'SOURCE':           return '🗄️';
    case 'FOLDER':           return '📁';
    case 'VIRTUAL_DATASET':  return '👁️';
    case 'PHYSICAL_DATASET': return '🗃️';
    default:                 return '📄';
  }
}
