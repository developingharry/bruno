import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { IconChevronDown, IconSettings, IconServer, IconCheck, IconKey } from '@tabler/icons';
import toast from 'react-hot-toast';
import Dropdown from 'components/Dropdown';
import { ENTITIES, getMissingRequirements } from 'utils/cyclr/registry';
import { getReferencedEntities } from 'utils/cyclr/prepare-request';
import {
  getCyclrContext,
  getContextPartnerId,
  hasPartnerCredentials,
  loadCyclrConfig,
  loadCyclrContext,
  selectCyclrEntity,
  selectCyclrStack
} from 'providers/ReduxStore/slices/cyclr';
import EntityPicker from '../EntityPicker';
import ConnectionsModal from '../ConnectionsModal';
import PartnerCredentialsModal from '../PartnerCredentialsModal';
import StyledWrapper from './StyledWrapper';

const ENTITY_ORDER = Object.keys(ENTITIES);

const EntityChip = ({ collectionUid, entityKey, selection, missing, onSelected }) => {
  const dispatch = useDispatch();
  const entity = ENTITIES[entityKey];
  const disabled = missing.length > 0;
  const title = disabled
    ? `Select ${missing.map((m) => ENTITIES[m].label).join(', ')} first`
    : selection
      ? `${entity.label}: ${selection.label} (${selection.id})`
      : `Choose a ${entity.label.toLowerCase()}`;

  return (
    <EntityPicker
      collectionUid={collectionUid}
      entityKey={entityKey}
      selectedId={selection?.id}
      disabled={disabled}
      onSelect={async (item) => {
        await dispatch(selectCyclrEntity(collectionUid, entityKey, item));
        onSelected?.(item);
      }}
      renderTrigger={({ open, toggle }) => (
        <button
          type="button"
          className={`chip ${selection ? 'has-value' : entityKey === 'partner' ? 'needs-value' : ''} ${open ? 'open' : ''}`}
          onClick={toggle}
          disabled={disabled}
          title={title}
          data-testid={`cyclr-chip-${entityKey}`}
        >
          <span className="chip-label">{entity.label}</span>
          <span className="chip-value">{selection ? selection.label : '—'}</span>
          <IconChevronDown size={12} strokeWidth={2} />
        </button>
      )}
    />
  );
};

const StackMenu = ({ collectionUid, ctx, stacks, onManage }) => {
  const dispatch = useDispatch();
  const dropdownRef = useRef(null);
  const current = stacks.find((s) => s.id === ctx.stackId);

  const choose = (stackId) => {
    dropdownRef.current?.hide();
    if (stackId !== ctx.stackId) dispatch(selectCyclrStack(collectionUid, stackId));
  };

  return (
    <Dropdown
      onCreate={(ref) => (dropdownRef.current = ref)}
      placement="bottom-start"
      appendTo={() => document.body}
      icon={(
        <button type="button" className={`chip ${current ? 'has-value' : 'needs-value'}`} data-testid="cyclr-stack" title={current?.baseUrl || 'Choose a stack'}>
          <IconServer size={14} strokeWidth={1.75} />
          <span className="chip-label">Stack</span>
          <span className="chip-value">{current ? current.name : 'Choose'}</span>
          <IconChevronDown size={12} strokeWidth={2} />
        </button>
      )}
    >
      {stacks.map((stack) => (
        <div key={stack.id} className="dropdown-item" onClick={() => choose(stack.id)}>
          <span className="flex-1">
            {stack.name}
            <span className="ml-2 opacity-60">{stack.baseUrl ? stack.baseUrl.replace(/^https?:\/\//, '') : 'no base URL set'}</span>
          </span>
          {stack.id === ctx.stackId && <IconCheck size={14} strokeWidth={2} />}
        </div>
      ))}
      <div className="dropdown-separator" />
      <div
        className="dropdown-item"
        onClick={() => {
          dropdownRef.current?.hide();
          onManage();
        }}
      >
        <IconSettings size={14} strokeWidth={1.75} />
        <span>Cyclr settings…</span>
      </div>
    </Dropdown>
  );
};

/**
 * Shown above the URL bar for Cyclr collections: Stack, then Partner (listed via the stack's
 * admin webhook), then pickers for just the entities the open request uses (and their parents).
 */
const CyclrContextBar = ({ collection, item }) => {
  const dispatch = useDispatch();
  const config = useSelector((state) => state.cyclr.config);
  const ctx = useSelector((state) => getCyclrContext(state, collection.uid));
  const partnerId = getContextPartnerId(ctx);
  const hasCreds = useSelector((state) => hasPartnerCredentials(state, ctx.stackId, partnerId));
  const [showManage, setShowManage] = useState(false);
  const [credsFor, setCredsFor] = useState(null); // { id, label } of the partner being edited

  useEffect(() => {
    if (!config.loaded) {
      dispatch(loadCyclrConfig()).catch((err) => toast.error(err.message));
    }
  }, [config.loaded, dispatch]);

  useEffect(() => {
    if (config.loaded && !ctx.loaded) {
      dispatch(loadCyclrContext(collection.uid)).catch((err) => toast.error(err.message));
    }
  }, [config.loaded, ctx.loaded, collection.uid, dispatch]);

  const referenced = useMemo(() => (item ? getReferencedEntities(item, { includeHeaders: true }) : []), [item]);

  // Only what this request uses, plus everything those depend on (e.g. a step needs a cycle,
  // which needs an account). Selections for hidden chips are kept for other requests.
  const visible = useMemo(() => {
    const keys = new Set();
    const add = (key) => {
      if (!ENTITIES[key] || keys.has(key)) return;
      keys.add(key);
      for (const req of ENTITIES[key].requires || []) add(req);
    };
    referenced.forEach(add);
    return ENTITY_ORDER.filter((k) => keys.has(k) && !ENTITIES[k].static && k !== 'partner');
  }, [referenced]);

  const partnerSelection = ctx.selections?.partner;

  return (
    <StyledWrapper data-testid="cyclr-context-bar">
      <StackMenu collectionUid={collection.uid} ctx={ctx} stacks={config.stacks} onManage={() => setShowManage(true)} />

      {ctx.stackId && (
        <>
          <EntityChip
            collectionUid={collection.uid}
            entityKey="partner"
            selection={partnerSelection}
            missing={[]}
            onSelected={(picked) => {
              // First time with this partner: ask for its API credentials straight away.
              if (picked && !config.credentials.some((c) => c.stackId === ctx.stackId && String(c.partnerId) === String(picked.id))) {
                setCredsFor({ id: picked.id, label: picked.label });
              }
            }}
          />
          {partnerSelection && (
            <button
              type="button"
              className={`icon-chip ${hasCreds ? '' : 'warn'}`}
              title={hasCreds ? 'Edit this partner\'s API credentials' : 'Add this partner\'s API credentials'}
              onClick={() => setCredsFor({ id: partnerSelection.id, label: partnerSelection.label })}
              data-testid="cyclr-partner-credentials"
            >
              <IconKey size={14} strokeWidth={1.75} />
              {!hasCreds && <span>Add credentials</span>}
            </button>
          )}
        </>
      )}

      {ctx.stackId && partnerSelection && hasCreds && (
        <>
          <span className="divider" />
          {visible.map((key) => (
            <EntityChip
              key={key}
              collectionUid={collection.uid}
              entityKey={key}
              selection={ctx.selections?.[key]}
              missing={getMissingRequirements(key, ctx.selections)}
            />
          ))}
        </>
      )}

      {showManage && <ConnectionsModal onClose={() => setShowManage(false)} />}
      {credsFor && (
        <PartnerCredentialsModal stackId={ctx.stackId} partner={credsFor} onClose={() => setCredsFor(null)} />
      )}
    </StyledWrapper>
  );
};

export default CyclrContextBar;
