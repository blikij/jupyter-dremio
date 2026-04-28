import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { LoginForm } from './LoginForm';
import { Toolbar } from './Toolbar';
import { CatalogNode } from './CatalogNode';
import {
  DremioCredentials,
  CatalogItem,
  login,
  ssoLogin,
  ssoLogout,
  fetchRootCatalog,
  fetchWiki,
  fetchCatalogSearch,
  createFolder,
  detectServerExtension,
} from '../api';

type Mode = 'detecting' | 'proxy' | 'direct';

interface Props {
  onShowWiki: (name: string, markdown: string) => void;
  onShowJobs: (creds: DremioCredentials) => void;
  onNewNotebook: (creds: DremioCredentials) => void;
}

export function DremioPanel({ onShowWiki, onShowJobs, onNewNotebook }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>('detecting');
  const [creds, setCreds] = useState<DremioCredentials | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [rootItems, setRootItems] = useState<CatalogItem[]>([]);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    detectServerExtension().then(hasProxy => {
      setMode(hasProxy ? 'proxy' : 'direct');
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!creds || !debouncedQuery.trim()) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    fetchCatalogSearch(creds, debouncedQuery.trim())
      .then(data => setSearchResults(data.data ?? []))
      .catch(e => setSearchError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSearchLoading(false));
  }, [creds, debouncedQuery]);

  const selected = selectedItem?.id ?? null;

  const loadRoot = useCallback(async (c: DremioCredentials) => {
    setRootLoading(true);
    setRootError(null);
    try {
      const data = await fetchRootCatalog(c);
      setRootItems(data.data ?? []);
    } catch (e) {
      setRootError(e instanceof Error ? e.message : String(e));
    } finally {
      setRootLoading(false);
    }
  }, []);

  const handleLogin = async (url: string, username: string, password: string) => {
    setLoginError(null);
    try {
      const direct = mode === 'direct';
      const resp = await login(url, username, password, direct);
      const c: DremioCredentials = { url, token: resp.token, direct, username: resp.userName, password };
      setCreds(c);
      await loadRoot(c);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSsoLogin = async (url: string) => {
    setLoginError(null);
    try {
      const resp = await ssoLogin(url);
      const c: DremioCredentials = { url, token: resp.token, direct: false, username: resp.userName };
      setCreds(c);
      await loadRoot(c);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleLogout = () => {
    if (creds?.token.startsWith('__sso__')) {
      ssoLogout(creds.url).catch(() => undefined);
    }
    setCreds(null);
    setRootItems([]);
    setSelectedItem(null);
    setLoginError(null);
  };

  const handleRefreshRoot = useCallback(() => {
    if (creds) loadRoot(creds);
  }, [creds, loadRoot]);

  const handleCreateFolder = useCallback(async () => {
    if (!creds || !selectedItem) return;
    if (selectedItem.containerType !== 'SPACE' && selectedItem.containerType !== 'FOLDER') {
      alert('Please select a folder or space first.');
      return;
    }
    const folderName = window.prompt('Folder name:');
    if (!folderName?.trim()) return;
    try {
      await createFolder(creds, [...selectedItem.path, folderName.trim()]);
    } catch (e) {
      alert(`Create folder failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [creds, selectedItem]);

  const handleOpenWiki = useCallback(
    async (item: CatalogItem) => {
      if (!creds) return;
      const name = item.path[item.path.length - 1] ?? item.id;
      try {
        const wiki = await fetchWiki(creds, item.id);
        onShowWiki(name, wiki.text ?? '');
      } catch {
        onShowWiki(name, '_Wiki could not be loaded for this item._');
      }
    },
    [creds, onShowWiki]
  );

  if (mode === 'detecting') {
    return <div className="dremio-detecting">Connecting…</div>;
  }

  if (!creds) {
    return (
      <LoginForm
        onLogin={handleLogin}
        onSsoLogin={handleSsoLogin}
        error={loginError}
        direct={mode === 'direct'}
      />
    );
  }

  const isSearching = debouncedQuery.trim().length > 0;

  return (
    <div className="dremio-panel">
      <Toolbar
        creds={creds}
        selected={selected}
        selectedItem={selectedItem}
        onRefreshRoot={handleRefreshRoot}
        onLogout={handleLogout}
        onCreateFolder={() => { void handleCreateFolder(); }}
        onShowJobs={() => onShowJobs(creds)}
        onNewNotebook={() => onNewNotebook(creds)}
      />
      <div className="dremio-search-bar">
        <input
          className="dremio-search-input"
          type="search"
          placeholder="Search catalog…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          aria-label="Search Dremio catalog"
        />
        {searchQuery && (
          <button
            className="dremio-search-clear"
            onClick={() => setSearchQuery('')}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>
      <div className="dremio-catalog-tree">
        {isSearching ? (
          <>
            <div className="dremio-search-root-label">Search Results</div>
            {searchLoading && (
              <div className="dremio-root-loading">Searching…</div>
            )}
            {searchError && (
              <div className="dremio-root-error">{searchError}</div>
            )}
            {!searchLoading && !searchError && searchResults.length === 0 && (
              <div className="dremio-root-empty">No results for "{debouncedQuery}".</div>
            )}
            {!searchLoading && searchResults.map(item => (
              <CatalogNode
                key={item.id}
                item={item}
                creds={creds}
                depth={0}
                selected={selected}
                onSelect={setSelectedItem}
                onOpenWiki={handleOpenWiki}
                onDeleteItem={id => setSearchResults(prev => prev.filter(i => i.id !== id))}
              />
            ))}
          </>
        ) : (
          <>
            {rootLoading && (
              <div className="dremio-root-loading">Loading catalog…</div>
            )}
            {rootError && (
              <div className="dremio-root-error">{rootError}</div>
            )}
            {!rootLoading &&
              rootItems.map(item => (
                <CatalogNode
                  key={item.id}
                  item={item}
                  creds={creds}
                  depth={0}
                  selected={selected}
                  onSelect={setSelectedItem}
                  onOpenWiki={handleOpenWiki}
                  onDeleteItem={id => {
                    setRootItems(prev => prev.filter(i => i.id !== id));
                    if (selectedItem?.id === id) setSelectedItem(null);
                  }}
                />
              ))}
            {!rootLoading && !rootError && rootItems.length === 0 && (
              <div className="dremio-root-empty">No catalog items found.</div>
            )}
          </>
        )}
      </div>
      <div className="dremio-panel-footer">
        <span title={creds.url}>⚡ {new URL(creds.url).hostname}</span>
        {creds.direct && (
          <span
            className="dremio-mode-badge"
            title="Requests go directly from your browser to Dremio"
          >
            direct
          </span>
        )}
      </div>
    </div>
  );
}

