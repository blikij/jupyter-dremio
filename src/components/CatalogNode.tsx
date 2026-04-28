import * as React from 'react';
import { useState, useCallback } from 'react';
import {
  DremioCredentials,
  CatalogItem,
  ColumnField,
  fetchCatalogItem,
  deleteCatalogItem,
  promoteToParquet,
  isContainer,
  isDataset,
  isFile,
  buildSqlPath,
  itemIcon,
} from '../api';
import { ContextMenu } from './ContextMenu';

interface Props {
  item: CatalogItem;
  creds: DremioCredentials;
  depth: number;
  selected: string | null;
  onSelect: (item: CatalogItem) => void;
  onOpenWiki: (item: CatalogItem) => void;
  onDeleteItem: (id: string) => void;
}

function IconTable(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <rect x="1" y="1" width="14" height="14" rx="1.5"/>
      <line x1="1" y1="5" x2="15" y2="5"/>
      <line x1="1" y1="9" x2="15" y2="9"/>
      <line x1="1" y1="13" x2="15" y2="13"/>
      <line x1="5" y1="1" x2="5" y2="15"/>
    </svg>
  );
}

function IconView(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <ellipse cx="8" cy="8" rx="7" ry="4.5"/>
      <circle cx="8" cy="8" r="2"/>
    </svg>
  );
}

const TYPE_BADGE: Record<string, string> = {
  VARCHAR: 'abc', NVARCHAR: 'abc', CHAR: 'abc', TEXT: 'abc',
  INTEGER: '123', INT: '123', BIGINT: '123', SMALLINT: '123', TINYINT: '123',
  FLOAT: '1.5', DOUBLE: '1.5', DECIMAL: '1.5', NUMERIC: '1.5',
  BOOLEAN: 'T/F', BIT: 'T/F',
  DATE: 'dt', TIME: 'dt',
  TIMESTAMP: 'ts', DATETIME: 'ts',
  BINARY: 'bin', VARBINARY: 'bin',
};

function typeBadge(typeName: string): string {
  return TYPE_BADGE[typeName.toUpperCase()] ?? typeName.toLowerCase().slice(0, 3);
}

function getDeleteLabel(item: CatalogItem, resolvedType?: string | null): string | null {
  // Collect every field that might carry the entity sub-type. Dremio returns
  // these in different fields depending on version and whether the item came
  // from a listing (children[]) or a full detail fetch.
  const candidates = [
    item.containerType,
    item.datasetType,
    resolvedType,   // from the full-detail fetch when the node is expanded
    item.type,
    item.entityType,
  ];
  if (candidates.includes('FOLDER'))           return 'Delete folder';
  if (candidates.includes('VIRTUAL_DATASET'))  return 'Delete view';
  if (candidates.includes('PHYSICAL_DATASET')) return 'Delete table';
  // Type is "DATASET" but sub-type unknown (common in listing responses)
  if (candidates.includes('DATASET'))          return 'Delete dataset';
  return null;
}

function nodeIcon(item: CatalogItem): JSX.Element | string {
  const sub = item.containerType ?? item.datasetType ?? item.type;
  if (sub === 'PHYSICAL_DATASET') return <IconTable />;
  if (sub === 'VIRTUAL_DATASET') return <IconView />;
  return itemIcon(item);
}

export function CatalogNode({
  item,
  creds,
  depth,
  selected,
  onSelect,
  onOpenWiki,
  onDeleteItem,
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<CatalogItem[]>([]);
  const [fields, setFields] = useState<ColumnField[]>([]);
  // Sub-type resolved from the full-detail fetch (may not be in listing items)
  const [detailType, setDetailType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const displayName = item.path[item.path.length - 1] ?? item.id;
  const container = isContainer(item);
  const dataset = isDataset(item);
  const file = isFile(item);
  const expandable = container || dataset;
  const isSelected = selected === item.id;
  const sqlPath = buildSqlPath(item.path);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchCatalogItem(creds, item.id);
      // Capture the specific sub-type from the full detail response so the
      // delete label can be resolved even when the listing item only carries
      // the generic "DATASET" / "CONTAINER" type.
      const resolved = detail.datasetType ?? detail.containerType ?? detail.type ?? null;
      if (resolved) setDetailType(resolved as string);
      if (dataset) {
        setFields(detail.fields ?? []);
      } else {
        setChildren(detail.children ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [creds, item.id, dataset]);

  const handleToggle = async () => {
    if (!expandable) return;
    const needsLoad = dataset ? fields.length === 0 : children.length === 0;
    if (!expanded && needsLoad) {
      await loadChildren();
    }
    setExpanded(prev => !prev);
  };

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await loadChildren();
    setExpanded(true);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(item);
    void handleToggle();
  };

  const handleDragStart = (e: React.DragEvent) => {
    let text: string;
    if (dataset) {
      // Build a clean alias from the table name (spaces → underscores).
      const alias = displayName.replace(/\s+/g, '_');
      const cols = fields.length > 0
        ? fields.map(f => `    "${f.name}"`).join(',\n')
        : '    *';
      text =
        `SELECT\n${cols}\nFROM ${sqlPath} AS ${alias}\nLIMIT 100`;
    } else {
      text = sqlPath;
    }
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const copyPathToClipboard = () => {
    void navigator.clipboard.writeText(sqlPath);
  };

  const deleteLabel = getDeleteLabel(item, detailType);

  const handleDelete = async () => {
    if (!deleteLabel) return;
    if (!window.confirm(`${deleteLabel} "${displayName}"? This cannot be undone.`)) return;
    try {
      await deleteCatalogItem(creds, item.id);
      onDeleteItem(item.id);
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handlePromote = async () => {
    if (!window.confirm(`Register "${displayName}" as a Parquet physical dataset?`)) return;
    try {
      await promoteToParquet(creds, item);
    } catch (e) {
      alert(`Promote failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className={`dremio-node${isSelected ? ' dremio-node--selected' : ''}`}>
      <div
        className="dremio-node-row"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        title={dataset ? `Drag to insert SELECT statement` : `Drag to insert: ${sqlPath}`}
      >
        {expandable && (
          <span className={`dremio-chevron${expanded ? ' dremio-chevron--open' : ''}`}>
            ›
          </span>
        )}
        {!expandable && <span className="dremio-chevron dremio-chevron--leaf" />}
        <span className="dremio-node-icon">{nodeIcon(item)}</span>
        <span className="dremio-node-label">{displayName}</span>
        {container && (
          <button className="dremio-refresh-btn" onClick={handleRefresh} title="Refresh">
            ↺
          </button>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              icon: '📄',
              label: 'Open wiki',
              onClick: () => onOpenWiki(item),
            },
            {
              icon: '📋',
              label: 'Copy path to clipboard',
              onClick: copyPathToClipboard,
            },
            ...(file ? [{
              icon: '🗂️',
              label: 'Register as Parquet table',
              onClick: () => { void handlePromote(); },
              separator: true,
            }] : []),
            ...(deleteLabel ? [{
              icon: '🗑️',
              label: deleteLabel,
              onClick: () => { void handleDelete(); },
              separator: !file,
              danger: true,
            }] : []),
          ]}
        />
      )}

      {error && (
        <div className="dremio-node-error" style={{ paddingLeft: `${depth * 14 + 24}px` }}>
          {error}
        </div>
      )}
      {loading && (
        <div className="dremio-node-loading" style={{ paddingLeft: `${depth * 14 + 24}px` }}>
          Loading…
        </div>
      )}

      {expanded && dataset && fields.length > 0 && (
        <div className="dremio-node-fields">
          {fields.map(f => (
            <div
              key={f.name}
              className="dremio-field-row"
              style={{ paddingLeft: `${(depth + 1) * 14 + 6}px` }}
            >
              <span className="dremio-field-name">{f.name}</span>
              <span className={`dremio-field-badge dremio-field-badge--${typeBadge(f.type.name)}`}>
                {typeBadge(f.type.name)}
              </span>
            </div>
          ))}
        </div>
      )}

      {expanded && dataset && !loading && fields.length === 0 && !error && (
        <div className="dremio-node-empty" style={{ paddingLeft: `${depth * 14 + 24}px` }}>
          No columns
        </div>
      )}

      {expanded && container && children.length > 0 && (
        <div className="dremio-node-children">
          {children.map(child => (
            <CatalogNode
              key={child.id}
              item={child}
              creds={creds}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onOpenWiki={onOpenWiki}
              onDeleteItem={id => setChildren(prev => prev.filter(c => c.id !== id))}
            />
          ))}
        </div>
      )}
      {expanded && container && !loading && children.length === 0 && !error && (
        <div className="dremio-node-empty" style={{ paddingLeft: `${depth * 14 + 24}px` }}>
          Empty
        </div>
      )}
    </div>
  );
}
