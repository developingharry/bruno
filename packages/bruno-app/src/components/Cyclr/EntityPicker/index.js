import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { IconRefresh, IconSearch, IconCheck, IconX, IconAlertTriangle } from '@tabler/icons';
import Dropdown from 'components/Dropdown';
import { ENTITIES } from 'utils/cyclr/registry';
import { useCyclrList } from '../useCyclrList';
import StyledWrapper from './StyledWrapper';

const ROW_HEIGHT = 44;
const MAX_LIST_HEIGHT = 320;

const formatAge = (ts) => {
  if (!ts) return '';
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
};

const filterItems = (items, query) => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  return items.filter((it) => terms.every((t) => it.hay.includes(t)));
};

/** The popover body. Mounted only while open, so nothing is fetched for closed pickers. */
const PickerPanel = ({ collectionUid, entityKey, selectedId, onSelect, onClose }) => {
  const entity = ENTITIES[entityKey];
  const list = useCyclrList({ collectionUid, entityKey, enabled: true });
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const virtuosoRef = useRef(null);

  const filtered = useMemo(() => filterItems(list.items, deferredQuery), [list.items, deferredQuery]);
  const trimmed = query.trim();
  const showCustom = !!trimmed && !filtered.some((it) => it.id === trimmed);
  const rowCount = filtered.length + (showCustom ? 1 : 0);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Start on the current selection when the list first arrives.
  const didInitActive = useRef(false);
  useEffect(() => {
    if (didInitActive.current || !list.items.length) return;
    didInitActive.current = true;
    const idx = list.items.findIndex((it) => it.id === selectedId);
    if (idx > 0) {
      setActive(idx);
      setTimeout(() => virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' }), 0);
    }
  }, [list.items, selectedId]);

  useEffect(() => {
    if (didInitActive.current) setActive(0);
  }, [deferredQuery]);

  const choose = (index) => {
    if (index < filtered.length) onSelect(filtered[index]);
    else if (showCustom) onSelect({ id: trimmed, label: trimmed, sub: 'Entered manually', meta: {} });
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rowCount) return;
      const next = e.key === 'ArrowDown' ? Math.min(active + 1, rowCount - 1) : Math.max(active - 1, 0);
      setActive(next);
      virtuosoRef.current?.scrollIntoView({ index: next });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const blockedMessage = !list.stackId && !list.spec.static
    ? 'Choose a stack first'
    : list.spec.error && !list.spec.static
      ? list.spec.error
      : null;

  const renderStatus = () => {
    if (blockedMessage) return null;
    if (list.error) {
      return (
        <span className="status-error flex items-center gap-1" title={list.error}>
          <IconAlertTriangle size={12} strokeWidth={2} /> {list.error}
        </span>
      );
    }
    if (list.spec.static) return <span>{list.items.length} options</span>;
    const count = list.items.length.toLocaleString();
    if (list.loading) {
      const of = list.total ? ` of ${list.total.toLocaleString()}` : '';
      return <span>{list.items.length ? `Loading… ${count}${of}` : 'Loading…'}</span>;
    }
    const filteredNote = deferredQuery.trim() ? `${filtered.length.toLocaleString()} of ` : '';
    const truncatedNote = list.truncated ? ' (most recent only - type an ID to use another)' : '';
    return (
      <span>
        {filteredNote}{count} {count === '1' ? 'item' : 'items'}{truncatedNote}
        {list.fetchedAt ? ` · ${formatAge(list.fetchedAt)}` : ''}
      </span>
    );
  };

  return (
    <StyledWrapper onKeyDown={onKeyDown}>
      <div className="picker-header">
        <div className="picker-title">{entity.label}</div>
        {!list.spec.static && !blockedMessage && (
          <button
            type="button"
            className="icon-btn"
            title="Refresh from Cyclr"
            onClick={() => list.refresh()}
            disabled={list.loading}
          >
            <IconRefresh size={14} strokeWidth={1.75} className={list.loading ? 'spin' : ''} />
          </button>
        )}
      </div>

      {blockedMessage ? (
        <div className="picker-empty">{blockedMessage}</div>
      ) : (
        <>
          <div className="search-box">
            <IconSearch size={14} strokeWidth={1.75} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${entity.label.toLowerCase()}s by name or ID`}
              spellCheck={false}
              data-testid="cyclr-picker-search"
            />
            {query && (
              <button type="button" className="icon-btn" onClick={() => setQuery('')} title="Clear search">
                <IconX size={12} strokeWidth={2} />
              </button>
            )}
          </div>

          <div className="picker-status">{renderStatus()}</div>

          {rowCount === 0 ? (
            <div className="picker-empty">
              {list.loading ? 'Fetching from Cyclr…' : list.error ? 'Could not load the list.' : 'Nothing here.'}
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              style={{ height: Math.min(MAX_LIST_HEIGHT, rowCount * ROW_HEIGHT) }}
              totalCount={rowCount}
              fixedItemHeight={ROW_HEIGHT}
              increaseViewportBy={200}
              itemContent={(index) => {
                const isCustom = index >= filtered.length;
                const it = isCustom ? null : filtered[index];
                const selected = !isCustom && it.id === selectedId;
                return (
                  <div
                    className={`picker-row ${index === active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(index)}
                    data-testid="cyclr-picker-row"
                  >
                    <div className="row-main">
                      {isCustom ? (
                        <span className="row-label">Use “{trimmed}” as the ID</span>
                      ) : (
                        <>
                          <span className="row-label" title={it.label}>{it.label}</span>
                          <span className="row-sub" title={`${it.id}${it.sub ? ` · ${it.sub}` : ''}`}>
                            <span className="row-id">{it.id}</span>
                            {it.sub ? ` · ${it.sub}` : ''}
                          </span>
                        </>
                      )}
                    </div>
                    {selected && <IconCheck size={14} strokeWidth={2} className="row-check" />}
                  </div>
                );
              }}
            />
          )}
        </>
      )}

      {selectedId && (
        <div className="picker-footer">
          <button type="button" className="text-btn" onClick={() => onSelect(null)}>
            Clear {entity.label.toLowerCase()}
          </button>
        </div>
      )}
    </StyledWrapper>
  );
};

/**
 * A searchable, virtualised dropdown for a Cyclr entity.
 * `renderTrigger({ open, toggle })` renders the element that opens it.
 */
const EntityPicker = ({ collectionUid, entityKey, selectedId, onSelect, renderTrigger, placement = 'bottom-start', disabled }) => {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const toggle = () => !disabled && setOpen((o) => !o);

  return (
    <Dropdown
      visible={open}
      onClickOutside={close}
      placement={placement}
      appendTo={() => document.body}
      noPadding
      icon={<span className="inline-flex">{renderTrigger({ open, toggle })}</span>}
    >
      {open ? (
        <PickerPanel
          collectionUid={collectionUid}
          entityKey={entityKey}
          selectedId={selectedId}
          onClose={close}
          onSelect={(item) => {
            close();
            onSelect(item);
          }}
        />
      ) : (
        <span />
      )}
    </Dropdown>
  );
};

export default EntityPicker;
