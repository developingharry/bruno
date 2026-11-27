import React from 'react';
import styled from 'styled-components';
import { useDispatch, useSelector } from 'react-redux';
import { IconListSearch } from '@tabler/icons';
import { ENTITIES, VAR_TO_ENTITY, getMissingRequirements, resolvePathParamEntity } from 'utils/cyclr/registry';
import { getCyclrContext, selectCyclrEntity } from 'providers/ReduxStore/slices/cyclr';
import EntityPicker from '../EntityPicker';

const Wrapper = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  max-width: 45%;

  .resolved {
    font-size: 0.6875rem;
    color: ${(props) => props.theme.dropdown.mutedText};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pick-btn {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem;
    border-radius: ${(props) => props.theme.border.radius.sm};
    color: ${(props) => props.theme.dropdown.iconColor};
    &:hover:not(:disabled) {
      background: ${(props) => props.theme.dropdown.hoverBg};
      color: ${(props) => props.theme.dropdown.color};
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
`;

const VAR_ONLY_RE = /^\s*\{\{\s*(cyclr_\w+)\s*\}\}\s*$/;

/** Resolve which entity a path param refers to: an explicit `{{cyclr_*}}` value wins over the URL shape. */
export const getPathParamEntity = (url, paramName, value) => {
  const m = String(value || '').match(VAR_ONLY_RE);
  if (m && VAR_TO_ENTITY[m[1]]) return VAR_TO_ENTITY[m[1]];
  return resolvePathParamEntity(url, paramName);
};

/**
 * Sits next to a path param value. Picking an item updates the shared Cyclr context
 * (so the next request inherits it) and points the param at the context variable.
 */
const PathParamPicker = ({ collection, item, paramName, value, onValueChange }) => {
  const dispatch = useDispatch();
  const ctx = useSelector((state) => getCyclrContext(state, collection.uid));
  const url = item.draft ? item.draft.request?.url : item.request?.url;
  const entityKey = getPathParamEntity(url, paramName, value);
  if (!entityKey) return null;

  const entity = ENTITIES[entityKey];
  const varRef = `{{${entity.var}}}`;
  const usesVar = String(value || '').trim() === varRef;
  const selection = ctx.selections?.[entityKey];
  const missing = getMissingRequirements(entityKey, ctx.selections);
  const disabled = !ctx.stackId || missing.length > 0;
  const title = !ctx.stackId
    ? 'Choose a Cyclr stack first'
    : missing.length
      ? `Select ${missing.map((m) => ENTITIES[m].label).join(', ')} first`
      : `Pick a ${entity.label.toLowerCase()}`;

  return (
    <Wrapper>
      {usesVar && selection && (
        <span className="resolved" title={`${selection.label} (${selection.id})`}>
          {selection.label}
        </span>
      )}
      <EntityPicker
        collectionUid={collection.uid}
        entityKey={entityKey}
        selectedId={usesVar ? selection?.id : undefined}
        disabled={disabled}
        placement="bottom-end"
        onSelect={(picked) => {
          dispatch(selectCyclrEntity(collection.uid, entityKey, picked));
          if (picked && !usesVar) onValueChange(varRef);
        }}
        renderTrigger={({ toggle }) => (
          <button type="button" className="pick-btn" onClick={toggle} disabled={disabled} title={title} data-testid={`cyclr-param-picker-${paramName}`}>
            <IconListSearch size={15} strokeWidth={1.75} />
          </button>
        )}
      />
    </Wrapper>
  );
};

export default PathParamPicker;
